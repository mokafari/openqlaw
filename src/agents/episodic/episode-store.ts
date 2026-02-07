/**
 * Episode Store
 *
 * SQLite-backed episode CRUD with vector search via sqlite-vec
 * and full-text search via FTS5. Each agent gets its own DB at
 * ~/.openclaw/agents/<agentId>/episodic/memory.db
 *
 * Follows the same pattern as tensor/pattern-store.ts.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { Episode, EpisodicMemoryConfig } from "./types.js";
import { buildFtsQuery, bm25RankToScore } from "../../memory/hybrid.js";
import { cosineSimilarity } from "../../memory/internal.js";
import { loadSqliteVecExtension } from "../../memory/sqlite-vec.js";
import { DEFAULT_EPISODIC_CONFIG } from "./types.js";

const SCHEMA_VERSION = 1;

type EpisodeRow = {
  id: string;
  session_id: string;
  summary: string;
  embedding: Buffer | null;
  fsm_state: string | null;
  context_depth: number | null;
  goals: string | null;
  tools_used: string | null;
  outcome: string;
  fitness: number;
  duration_ms: number | null;
  token_usage: number | null;
  created_at: number;
  genotype_id: string | null;
  metadata: string | null;
};

export class EpisodeStore {
  private db: DatabaseSync;
  private vecReady = false;
  private ftsReady = false;
  private config: EpisodicMemoryConfig;

  constructor(
    private readonly dbPath: string,
    config?: Partial<EpisodicMemoryConfig>,
  ) {
    this.config = { ...DEFAULT_EPISODIC_CONFIG, ...config };

    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    this.db = new DatabaseSync(dbPath);
    this.db.exec("PRAGMA journal_mode=WAL");
    this.db.exec("PRAGMA busy_timeout=5000");
    this.initSchema();
  }

  /** Attempt to load sqlite-vec for vector search. Falls back to brute-force cosine. */
  async initVec(): Promise<boolean> {
    const result = await loadSqliteVecExtension({ db: this.db });
    if (result.ok) {
      this.vecReady = true;
      this.db.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS episodes_vec
        USING vec0(embedding float[1536])
      `);
    }
    return this.vecReady;
  }

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS episodes (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        summary TEXT NOT NULL,
        embedding BLOB,
        fsm_state TEXT,
        context_depth INTEGER,
        goals TEXT,
        tools_used TEXT,
        outcome TEXT NOT NULL,
        fitness REAL NOT NULL,
        duration_ms INTEGER,
        token_usage INTEGER,
        created_at INTEGER NOT NULL,
        genotype_id TEXT,
        metadata TEXT
      )
    `);
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_episodes_created ON episodes(created_at)`);
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_episodes_fsm_state ON episodes(fsm_state)`);
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_episodes_fitness ON episodes(fitness)`);

    // FTS5 for full-text search on summaries
    try {
      this.db.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS episodes_fts
        USING fts5(summary, content=episodes, content_rowid=rowid)
      `);
      this.ftsReady = true;
    } catch {
      // FTS5 may not be available
    }

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS episodic_meta (key TEXT PRIMARY KEY, value TEXT)
    `);
    this.db.exec(
      `INSERT OR REPLACE INTO episodic_meta (key, value) VALUES ('schema_version', '${SCHEMA_VERSION}')`,
    );
  }

  /** Insert a new episode. */
  insertEpisode(episode: Episode): void {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO episodes
        (id, session_id, summary, embedding, fsm_state, context_depth,
         goals, tools_used, outcome, fitness, duration_ms, token_usage,
         created_at, genotype_id, metadata)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const embeddingBlob =
      episode.embedding.length > 0 ? Buffer.from(new Float32Array(episode.embedding).buffer) : null;

    stmt.run(
      episode.id,
      episode.sessionId,
      episode.summary,
      embeddingBlob,
      episode.fsmState ?? null,
      episode.contextDepth ?? null,
      JSON.stringify(episode.goals),
      JSON.stringify(episode.toolsUsed),
      episode.outcome,
      episode.fitness,
      episode.durationMs ?? null,
      episode.tokenUsage ?? null,
      episode.createdAt,
      episode.genotypeId ?? null,
      episode.metadata ? JSON.stringify(episode.metadata) : null,
    );

    // Insert into vec table if available
    if (this.vecReady && episode.embedding.length > 0) {
      try {
        const vecStmt = this.db.prepare(
          `INSERT OR REPLACE INTO episodes_vec (rowid, embedding) VALUES (?, ?)`,
        );
        vecStmt.run(this.rowIdForEpisode(episode.id), JSON.stringify(episode.embedding));
      } catch {
        // Non-fatal: vec insert failure doesn't block storage
      }
    }

    // Sync FTS index
    if (this.ftsReady) {
      try {
        this.db.exec(`INSERT INTO episodes_fts(episodes_fts) VALUES('rebuild')`);
      } catch {
        // Non-fatal
      }
    }

    this.enforceMaxEpisodes();
  }

  /**
   * Search episodes by vector similarity.
   * Uses brute-force cosine (same approach as pattern-store).
   */
  searchByVector(
    embedding: number[],
    limit: number = 10,
    filters?: { fsmState?: string; minFitness?: number },
  ): Array<Episode & { similarity: number }> {
    let query = `SELECT * FROM episodes WHERE 1=1`;
    const params: (string | number | null)[] = [];

    if (filters?.fsmState) {
      query += ` AND fsm_state = ?`;
      params.push(filters.fsmState);
    }
    if (filters?.minFitness !== undefined) {
      query += ` AND fitness >= ?`;
      params.push(filters.minFitness);
    }
    query += ` ORDER BY fitness DESC LIMIT 500`;

    const rows = this.db.prepare(query).all(...params) as EpisodeRow[];
    const results: Array<Episode & { similarity: number }> = [];

    for (const row of rows) {
      const stored = this.parseEmbedding(row.embedding);
      if (stored.length === 0) {
        continue;
      }
      const sim = cosineSimilarity(embedding, stored);
      if (sim > 0) {
        results.push({ ...this.rowToEpisode(row), similarity: sim });
      }
    }

    results.sort((a, b) => b.similarity - a.similarity);
    return results.slice(0, limit);
  }

  /** Search episodes by FTS keyword match. */
  searchByKeyword(query: string, limit: number = 10): Array<Episode & { textScore: number }> {
    if (!this.ftsReady) {
      return [];
    }

    const ftsQuery = buildFtsQuery(query);
    if (!ftsQuery) {
      return [];
    }

    try {
      const rows = this.db
        .prepare(
          `SELECT e.*, rank FROM episodes_fts f
           JOIN episodes e ON e.rowid = f.rowid
           WHERE episodes_fts MATCH ?
           ORDER BY rank
           LIMIT ?`,
        )
        .all(ftsQuery, limit) as Array<EpisodeRow & { rank: number }>;

      return rows.map((row) => ({
        ...this.rowToEpisode(row),
        textScore: bm25RankToScore(row.rank),
      }));
    } catch {
      return [];
    }
  }

  /** Get recent episodes ordered by creation time. */
  getRecentEpisodes(limit: number = 20, since?: number): Episode[] {
    let query = `SELECT * FROM episodes`;
    const params: (string | number | null)[] = [];

    if (since !== undefined) {
      query += ` WHERE created_at >= ?`;
      params.push(since);
    }
    query += ` ORDER BY created_at DESC LIMIT ?`;
    params.push(limit);

    const rows = this.db.prepare(query).all(...params) as EpisodeRow[];
    return rows.map((r) => this.rowToEpisode(r));
  }

  /** Get episodes filtered by FSM state. */
  getEpisodesByState(fsmState: string, limit: number = 20): Episode[] {
    const rows = this.db
      .prepare(`SELECT * FROM episodes WHERE fsm_state = ? ORDER BY created_at DESC LIMIT ?`)
      .all(fsmState, limit) as EpisodeRow[];
    return rows.map((r) => this.rowToEpisode(r));
  }

  /** Delete episodes older than ttlDays. */
  pruneExpired(ttlDays?: number): number {
    const ttl = ttlDays ?? this.config.episodeTtlDays;
    const cutoff = Date.now() - ttl * 24 * 60 * 60 * 1000;
    const result = this.db.prepare(`DELETE FROM episodes WHERE created_at < ?`).run(cutoff);
    return Number(result.changes);
  }

  /** Get aggregate stats. */
  getStats(): {
    totalEpisodes: number;
    avgFitness: number;
    outcomeDistribution: Record<string, number>;
  } {
    const row = this.db
      .prepare(`SELECT COUNT(*) as total, COALESCE(AVG(fitness), 0) as avg_fitness FROM episodes`)
      .get() as { total: number; avg_fitness: number };

    const outcomes = this.db
      .prepare(`SELECT outcome, COUNT(*) as cnt FROM episodes GROUP BY outcome`)
      .all() as Array<{ outcome: string; cnt: number }>;

    const outcomeDistribution: Record<string, number> = {};
    for (const o of outcomes) {
      outcomeDistribution[o.outcome] = o.cnt;
    }

    return {
      totalEpisodes: row.total,
      avgFitness: row.avg_fitness,
      outcomeDistribution,
    };
  }

  /** Get episode by ID. */
  getEpisode(id: string): Episode | undefined {
    const row = this.db.prepare(`SELECT * FROM episodes WHERE id = ?`).get(id) as
      | EpisodeRow
      | undefined;
    return row ? this.rowToEpisode(row) : undefined;
  }

  /** Close the database connection. */
  close(): void {
    this.db.close();
  }

  // --- private helpers ---

  private enforceMaxEpisodes(): void {
    const count = (
      this.db.prepare(`SELECT COUNT(*) as cnt FROM episodes`).get() as {
        cnt: number;
      }
    ).cnt;
    if (count > this.config.maxEpisodes) {
      const excess = count - this.config.maxEpisodes;
      this.db.exec(
        `DELETE FROM episodes WHERE id IN (
          SELECT id FROM episodes ORDER BY fitness ASC, created_at ASC LIMIT ${excess}
        )`,
      );
    }
  }

  private rowIdForEpisode(id: string): number {
    const hash = crypto.createHash("md5").update(id).digest();
    return Math.abs(hash.readInt32LE(0));
  }

  private parseEmbedding(blob: Buffer | null): number[] {
    if (!blob || blob.length === 0) {
      return [];
    }
    const floats = new Float32Array(blob.buffer, blob.byteOffset, blob.byteLength / 4);
    return Array.from(floats);
  }

  private rowToEpisode(row: EpisodeRow): Episode {
    return {
      id: row.id,
      sessionId: row.session_id,
      summary: row.summary,
      embedding: this.parseEmbedding(row.embedding),
      fsmState: row.fsm_state ?? "idle",
      contextDepth: (row.context_depth ?? 0) as 0 | 1 | 2 | 3,
      goals: row.goals ? JSON.parse(row.goals) : [],
      toolsUsed: row.tools_used ? JSON.parse(row.tools_used) : [],
      outcome: row.outcome as Episode["outcome"],
      fitness: row.fitness,
      durationMs: row.duration_ms ?? 0,
      tokenUsage: row.token_usage ?? 0,
      createdAt: row.created_at,
      genotypeId: row.genotype_id ?? undefined,
      metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
    };
  }
}

/** Generate a unique episode ID. */
export function generateEpisodeId(): string {
  return crypto.randomUUID();
}
