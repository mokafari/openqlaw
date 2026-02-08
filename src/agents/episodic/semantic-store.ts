/**
 * Semantic Store
 *
 * SQLite-backed storage for semantic facts and concept clusters.
 * Provides vector search, concept queries, and fact management.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type {
  SemanticFact,
  ConceptCluster,
  SemanticConfig,
  SemanticQueryResult,
} from "./semantic-types.js";
import { cosineSimilarity } from "../../memory/internal.js";
import { loadSqliteVecExtension } from "../../memory/sqlite-vec.js";
import { DEFAULT_SEMANTIC_CONFIG } from "./semantic-types.js";

const SCHEMA_VERSION = 1;

type SemanticFactRow = {
  id: string;
  type: string;
  statement: string;
  confidence: number;
  evidence_count: number;
  evidence_episode_ids: string;
  concept: string;
  sub_concepts: string;
  embedding: Buffer | null;
  created_at: number;
  last_updated: number;
  metadata: string | null;
};

type ConceptClusterRow = {
  id: string;
  name: string;
  fact_ids: string;
  relationships: string;
  embedding: Buffer | null;
  created_at: number;
  last_updated: number;
};

export class SemanticStore {
  private db: DatabaseSync;
  private vecReady = false;
  private config: SemanticConfig;

  constructor(
    private readonly dbPath: string,
    config?: Partial<SemanticConfig>,
  ) {
    this.config = { ...DEFAULT_SEMANTIC_CONFIG, ...config };

    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    this.db = new DatabaseSync(dbPath);
    this.db.exec("PRAGMA journal_mode=WAL");
    this.db.exec("PRAGMA busy_timeout=5000");
    this.initSchema();
  }

  /** Attempt to load sqlite-vec for vector search */
  async initVec(): Promise<boolean> {
    const result = await loadSqliteVecExtension({ db: this.db });
    if (result.ok) {
      this.vecReady = true;
      this.db.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS semantic_facts_vec
        USING vec0(embedding float[1536])
      `);
      this.db.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS concept_clusters_vec
        USING vec0(embedding float[1536])
      `);
    }
    return this.vecReady;
  }

  private initSchema(): void {
    // Semantic facts table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS semantic_facts (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        statement TEXT NOT NULL,
        confidence REAL NOT NULL,
        evidence_count INTEGER NOT NULL,
        evidence_episode_ids TEXT NOT NULL,
        concept TEXT NOT NULL,
        sub_concepts TEXT NOT NULL,
        embedding BLOB,
        created_at INTEGER NOT NULL,
        last_updated INTEGER NOT NULL,
        metadata TEXT
      )
    `);
    this.db.exec(
      `CREATE INDEX IF NOT EXISTS idx_semantic_facts_concept ON semantic_facts(concept)`,
    );
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_semantic_facts_type ON semantic_facts(type)`);
    this.db.exec(
      `CREATE INDEX IF NOT EXISTS idx_semantic_facts_confidence ON semantic_facts(confidence)`,
    );
    this.db.exec(
      `CREATE INDEX IF NOT EXISTS idx_semantic_facts_created ON semantic_facts(created_at)`,
    );

    // Concept clusters table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS concept_clusters (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        fact_ids TEXT NOT NULL,
        relationships TEXT NOT NULL,
        embedding BLOB,
        created_at INTEGER NOT NULL,
        last_updated INTEGER NOT NULL
      )
    `);
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_concept_clusters_name ON concept_clusters(name)`);

    // FTS for semantic facts
    try {
      this.db.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS semantic_facts_fts
        USING fts5(statement, content=semantic_facts, content_rowid=rowid)
      `);
    } catch {
      // FTS5 may not be available
    }

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS semantic_meta (key TEXT PRIMARY KEY, value TEXT)
    `);
    this.db.exec(
      `INSERT OR REPLACE INTO semantic_meta (key, value) VALUES ('schema_version', '${SCHEMA_VERSION}')`,
    );
  }

  /** Store a semantic fact */
  storeFact(fact: SemanticFact): void {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO semantic_facts
        (id, type, statement, confidence, evidence_count, evidence_episode_ids,
         concept, sub_concepts, embedding, created_at, last_updated, metadata)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const embeddingBlob =
      fact.embedding.length > 0 ? Buffer.from(new Float32Array(fact.embedding).buffer) : null;

    stmt.run(
      fact.id,
      fact.type,
      fact.statement,
      fact.confidence,
      fact.evidenceCount,
      JSON.stringify(fact.evidenceEpisodeIds),
      fact.concept,
      JSON.stringify(fact.subConcepts),
      embeddingBlob,
      fact.createdAt,
      fact.lastUpdated,
      fact.metadata ? JSON.stringify(fact.metadata) : null,
    );

    // Insert into vector table if available
    if (this.vecReady && fact.embedding.length > 0) {
      try {
        const vecStmt = this.db.prepare(
          `INSERT OR REPLACE INTO semantic_facts_vec (rowid, embedding) VALUES (?, ?)`,
        );
        vecStmt.run(this.rowIdForFact(fact.id), JSON.stringify(fact.embedding));
      } catch {
        // Non-fatal: vec insert failure doesn't block storage
      }
    }

    this.enforceMaxFacts();
  }

  /** Store a concept cluster */
  storeConcept(concept: ConceptCluster): void {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO concept_clusters
        (id, name, fact_ids, relationships, embedding, created_at, last_updated)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    const embeddingBlob =
      concept.embedding.length > 0 ? Buffer.from(new Float32Array(concept.embedding).buffer) : null;

    stmt.run(
      concept.id,
      concept.name,
      JSON.stringify(concept.factIds),
      JSON.stringify(concept.relationships),
      embeddingBlob,
      concept.createdAt,
      concept.lastUpdated,
    );

    // Insert into vector table if available
    if (this.vecReady && concept.embedding.length > 0) {
      try {
        const vecStmt = this.db.prepare(
          `INSERT OR REPLACE INTO concept_clusters_vec (rowid, embedding) VALUES (?, ?)`,
        );
        vecStmt.run(this.rowIdForConcept(concept.id), JSON.stringify(concept.embedding));
      } catch {
        // Non-fatal
      }
    }
  }

  /** Search facts by vector similarity */
  searchFactsByVector(
    embedding: number[],
    limit: number = 10,
    filters?: { concept?: string; type?: string; minConfidence?: number },
  ): Array<SemanticFact & { similarity: number }> {
    let query = `SELECT * FROM semantic_facts WHERE 1=1`;
    const params: (string | number | null)[] = [];

    if (filters?.concept) {
      query += ` AND (concept = ? OR sub_concepts LIKE ?)`;
      params.push(filters.concept, `%"${filters.concept}"%`);
    }
    if (filters?.type) {
      query += ` AND type = ?`;
      params.push(filters.type);
    }
    if (filters?.minConfidence !== undefined) {
      query += ` AND confidence >= ?`;
      params.push(filters.minConfidence);
    }
    query += ` ORDER BY confidence DESC LIMIT 200`;

    const rows = this.db.prepare(query).all(...params) as SemanticFactRow[];
    const results: Array<SemanticFact & { similarity: number }> = [];

    for (const row of rows) {
      const stored = this.parseEmbedding(row.embedding);
      if (stored.length === 0) {
        continue;
      }
      const sim = cosineSimilarity(embedding, stored);
      if (sim > 0) {
        results.push({ ...this.rowToFact(row), similarity: sim });
      }
    }

    results.sort((a, b) => b.similarity - a.similarity);
    return results.slice(0, limit);
  }

  /** Search facts by keyword */
  searchFactsByKeyword(
    keywords: string[],
    limit: number = 10,
  ): Array<SemanticFact & { textScore: number }> {
    const keywordPattern = keywords.map((k) => `"${k}"`).join(" AND ");

    try {
      const rows = this.db
        .prepare(
          `SELECT f.*, rank FROM semantic_facts_fts fts
           JOIN semantic_facts f ON f.rowid = fts.rowid
           WHERE semantic_facts_fts MATCH ?
           ORDER BY rank
           LIMIT ?`,
        )
        .all(keywordPattern, limit) as Array<SemanticFactRow & { rank: number }>;

      return rows.map((row) => ({
        ...this.rowToFact(row),
        textScore: Math.max(0, 1 / (Math.abs(row.rank) + 1)),
      }));
    } catch {
      return [];
    }
  }

  /** Get facts by concept */
  getFactsByConcept(concept: string, limit: number = 20): SemanticFact[] {
    const rows = this.db
      .prepare(`
        SELECT * FROM semantic_facts 
        WHERE concept = ? OR sub_concepts LIKE ?
        ORDER BY confidence DESC, evidence_count DESC
        LIMIT ?
      `)
      .all(concept, `%"${concept}"%`, limit) as SemanticFactRow[];

    return rows.map((r) => this.rowToFact(r));
  }

  /** Get concept cluster by name */
  getConcept(name: string): ConceptCluster | undefined {
    const row = this.db.prepare(`SELECT * FROM concept_clusters WHERE name = ?`).get(name) as
      | ConceptClusterRow
      | undefined;

    return row ? this.rowToConcept(row) : undefined;
  }

  /** Get all concepts */
  getAllConcepts(): ConceptCluster[] {
    const rows = this.db
      .prepare(`SELECT * FROM concept_clusters ORDER BY name`)
      .all() as ConceptClusterRow[];

    return rows.map((r) => this.rowToConcept(r));
  }

  /** Query semantic facts with hybrid search */
  async queryFacts(
    query: string,
    options?: {
      limit?: number;
      concepts?: string[];
      types?: string[];
      minConfidence?: number;
      embeddingProvider?: { embed: (text: string) => Promise<number[]> };
    },
  ): Promise<SemanticQueryResult[]> {
    const limit = options?.limit ?? 10;
    const results: SemanticQueryResult[] = [];

    // Vector search if embedding provider available
    if (options?.embeddingProvider) {
      try {
        const embedding = await options.embeddingProvider.embed(query);
        const vectorResults = this.searchFactsByVector(embedding, limit, {
          concept: options.concepts?.[0],
          type: options.types?.[0],
          minConfidence: options.minConfidence,
        });

        vectorResults.forEach((fact) => {
          results.push({
            fact,
            relevance: fact.similarity,
            explanation: `Vector similarity: ${(fact.similarity * 100).toFixed(1)}%`,
          });
        });
      } catch (error) {
        console.warn("Vector search failed:", error);
      }
    }

    // Keyword search
    const keywords = this.extractKeywords(query);
    if (keywords.length > 0) {
      const keywordResults = this.searchFactsByKeyword(keywords, limit);

      keywordResults.forEach((fact) => {
        // Avoid duplicates from vector search
        if (!results.some((r) => r.fact.id === fact.id)) {
          results.push({
            fact,
            relevance: fact.textScore,
            explanation: `Keyword match: ${keywords.join(", ")}`,
          });
        }
      });
    }

    // Concept-based search
    if (options?.concepts) {
      options.concepts.forEach((concept) => {
        const conceptFacts = this.getFactsByConcept(concept, limit);
        conceptFacts.forEach((fact) => {
          if (!results.some((r) => r.fact.id === fact.id)) {
            results.push({
              fact,
              relevance: fact.confidence,
              explanation: `Concept match: ${concept}`,
            });
          }
        });
      });
    }

    // Sort by relevance and limit
    results.sort((a, b) => b.relevance - a.relevance);
    return results.slice(0, limit);
  }

  /** Get statistics */
  getStats(): {
    totalFacts: number;
    totalConcepts: number;
    avgConfidence: number;
    typeDistribution: Record<string, number>;
    conceptDistribution: Record<string, number>;
  } {
    const factRow = this.db
      .prepare(
        `SELECT COUNT(*) as total, COALESCE(AVG(confidence), 0) as avg_confidence FROM semantic_facts`,
      )
      .get() as { total: number; avg_confidence: number };

    const conceptRow = this.db.prepare(`SELECT COUNT(*) as total FROM concept_clusters`).get() as {
      total: number;
    };

    const types = this.db
      .prepare(`SELECT type, COUNT(*) as cnt FROM semantic_facts GROUP BY type`)
      .all() as Array<{ type: string; cnt: number }>;

    const concepts = this.db
      .prepare(`SELECT concept, COUNT(*) as cnt FROM semantic_facts GROUP BY concept`)
      .all() as Array<{ concept: string; cnt: number }>;

    const typeDistribution: Record<string, number> = {};
    types.forEach((t) => {
      typeDistribution[t.type] = t.cnt;
    });

    const conceptDistribution: Record<string, number> = {};
    concepts.forEach((c) => {
      conceptDistribution[c.concept] = c.cnt;
    });

    return {
      totalFacts: factRow.total,
      totalConcepts: conceptRow.total,
      avgConfidence: factRow.avg_confidence,
      typeDistribution,
      conceptDistribution,
    };
  }

  /** Delete facts older than TTL */
  pruneExpired(ttlDays?: number): number {
    const ttl = ttlDays ?? this.config.factTtlDays;
    const cutoff = Date.now() - ttl * 24 * 60 * 60 * 1000;
    const result = this.db.prepare(`DELETE FROM semantic_facts WHERE created_at < ?`).run(cutoff);
    return Number(result.changes);
  }

  /** Delete facts with low confidence */
  pruneLowConfidence(threshold?: number): number {
    const minConfidence = threshold ?? this.config.minConfidenceThreshold;
    const result = this.db
      .prepare(`DELETE FROM semantic_facts WHERE confidence < ?`)
      .run(minConfidence);
    return Number(result.changes);
  }

  /** Close database connection */
  close(): void {
    this.db.close();
  }

  // --- Private helpers ---

  private enforceMaxFacts(): void {
    const count = (
      this.db.prepare(`SELECT COUNT(*) as cnt FROM semantic_facts`).get() as {
        cnt: number;
      }
    ).cnt;

    if (count > this.config.maxFacts) {
      const excess = count - this.config.maxFacts;
      this.db.exec(
        `DELETE FROM semantic_facts WHERE id IN (
          SELECT id FROM semantic_facts 
          ORDER BY confidence ASC, evidence_count ASC, created_at ASC 
          LIMIT ${excess}
        )`,
      );
    }
  }

  private rowIdForFact(id: string): number {
    const hash = crypto.createHash("md5").update(id).digest();
    return Math.abs(hash.readInt32LE(0));
  }

  private rowIdForConcept(id: string): number {
    const hash = crypto.createHash("md5").update(`concept-${id}`).digest();
    return Math.abs(hash.readInt32LE(0));
  }

  private parseEmbedding(blob: Buffer | null): number[] {
    if (!blob || blob.length === 0) {
      return [];
    }
    const floats = new Float32Array(blob.buffer, blob.byteOffset, blob.byteLength / 4);
    return Array.from(floats);
  }

  private rowToFact(row: SemanticFactRow): SemanticFact {
    return {
      id: row.id,
      type: row.type as SemanticFact["type"],
      statement: row.statement,
      confidence: row.confidence,
      evidenceCount: row.evidence_count,
      evidenceEpisodeIds: JSON.parse(row.evidence_episode_ids),
      concept: row.concept,
      subConcepts: JSON.parse(row.sub_concepts),
      embedding: this.parseEmbedding(row.embedding),
      createdAt: row.created_at,
      lastUpdated: row.last_updated,
      metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
    };
  }

  private rowToConcept(row: ConceptClusterRow): ConceptCluster {
    return {
      id: row.id,
      name: row.name,
      factIds: JSON.parse(row.fact_ids),
      relationships: JSON.parse(row.relationships),
      embedding: this.parseEmbedding(row.embedding),
      createdAt: row.created_at,
      lastUpdated: row.last_updated,
    };
  }

  private extractKeywords(query: string): string[] {
    return query
      .toLowerCase()
      .split(/\s+/)
      .filter((word) => word.length > 2)
      .filter(
        (word) =>
          !["the", "and", "or", "but", "in", "on", "at", "to", "for", "of", "with", "by"].includes(
            word,
          ),
      );
  }
}
