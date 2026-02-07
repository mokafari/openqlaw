/**
 * Tensor Pattern Store
 *
 * SQLite-backed action pattern store with vector search via sqlite-vec.
 * Each agent gets its own DB at ~/.openclaw/agents/<agentId>/tensor/patterns.db
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { ActionPattern, TensorConfig } from "./types.js";
import { cosineSimilarity } from "../../memory/internal.js";
import { loadSqliteVecExtension } from "../../memory/sqlite-vec.js";
import { DEFAULT_TENSOR_CONFIG } from "./types.js";

const SCHEMA_VERSION = 1;

/**
 * Persistent pattern store backed by SQLite + sqlite-vec.
 *
 * Stores action patterns and supports vector similarity search
 * for the System 1 fast-path recall engine.
 */
export class PatternStore {
  private db: DatabaseSync;
  private vecReady = false;
  private config: TensorConfig;

  constructor(
    private readonly dbPath: string,
    config?: Partial<TensorConfig>,
  ) {
    this.config = { ...DEFAULT_TENSOR_CONFIG, ...config };

    // Ensure parent directory exists
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
        CREATE VIRTUAL TABLE IF NOT EXISTS action_patterns_vec
        USING vec0(embedding float[1536])
      `);
    }
    return this.vecReady;
  }

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS action_patterns (
        id TEXT PRIMARY KEY,
        context_text TEXT NOT NULL,
        context_embedding BLOB,
        action_summary TEXT NOT NULL,
        action_tool_calls TEXT NOT NULL,
        outcome_success INTEGER NOT NULL,
        outcome_duration_ms INTEGER NOT NULL,
        outcome_tokens_saved INTEGER,
        fitness REAL NOT NULL DEFAULT 0,
        usage_count INTEGER NOT NULL DEFAULT 0,
        last_used_at INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        fsm_state TEXT,
        genotype_id TEXT
      )
    `);
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_patterns_fitness ON action_patterns(fitness)
    `);
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_patterns_last_used ON action_patterns(last_used_at)
    `);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS tensor_meta (key TEXT PRIMARY KEY, value TEXT)
    `);
    // Store schema version
    this.db.exec(
      `INSERT OR REPLACE INTO tensor_meta (key, value) VALUES ('schema_version', '${SCHEMA_VERSION}')`,
    );
  }

  /** Insert a new action pattern. Enforces maxPatterns by pruning lowest-fitness entries. */
  insertPattern(pattern: ActionPattern): void {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO action_patterns
        (id, context_text, context_embedding, action_summary, action_tool_calls,
         outcome_success, outcome_duration_ms, outcome_tokens_saved,
         fitness, usage_count, last_used_at, created_at, fsm_state, genotype_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const embeddingBlob = Buffer.from(new Float32Array(pattern.contextEmbedding).buffer);

    stmt.run(
      pattern.id,
      pattern.contextText,
      embeddingBlob,
      pattern.actionSummary,
      JSON.stringify(pattern.actionToolCalls),
      pattern.outcome.success ? 1 : 0,
      pattern.outcome.durationMs,
      pattern.outcome.tokensSaved ?? null,
      pattern.fitness,
      pattern.usageCount,
      pattern.lastUsedAt,
      pattern.createdAt,
      pattern.fsmState ?? null,
      pattern.genotypeId ?? null,
    );

    // Insert into vec table if available
    if (this.vecReady) {
      try {
        const vecStmt = this.db.prepare(
          `INSERT OR REPLACE INTO action_patterns_vec (rowid, embedding) VALUES (?, ?)`,
        );
        // sqlite-vec expects a JSON array for the embedding
        vecStmt.run(this.rowIdForPattern(pattern.id), JSON.stringify(pattern.contextEmbedding));
      } catch {
        // Non-fatal: vec insert failure doesn't block pattern storage
      }
    }

    // Enforce max patterns
    this.enforceMaxPatterns();
  }

  /**
   * Search patterns by vector similarity.
   * Uses sqlite-vec when available, otherwise falls back to brute-force cosine.
   */
  searchByVector(
    embedding: number[],
    limit: number = 5,
    minFitness?: number,
  ): Array<ActionPattern & { similarity: number }> {
    const floor = minFitness ?? this.config.minFitnessForRecall;

    // Brute-force path: load all qualifying patterns and compute cosine similarity
    const rows = this.db
      .prepare(`SELECT * FROM action_patterns WHERE fitness >= ? ORDER BY fitness DESC LIMIT 500`)
      .all(floor) as PatternRow[];

    const results: Array<ActionPattern & { similarity: number }> = [];
    for (const row of rows) {
      const stored = this.parseEmbedding(row.context_embedding);
      if (stored.length === 0) {
        continue;
      }
      const sim = cosineSimilarity(embedding, stored);
      if (sim > 0) {
        results.push({ ...this.rowToPattern(row), similarity: sim });
      }
    }

    results.sort((a, b) => b.similarity - a.similarity);
    return results.slice(0, limit);
  }

  /** Increment usage count and update lastUsedAt for a pattern. */
  touchPattern(id: string): void {
    this.db
      .prepare(
        `UPDATE action_patterns SET usage_count = usage_count + 1, last_used_at = ? WHERE id = ?`,
      )
      .run(Date.now(), id);
  }

  /** Update the fitness score for a pattern. */
  updateFitness(id: string, fitness: number): void {
    this.db.prepare(`UPDATE action_patterns SET fitness = ? WHERE id = ?`).run(fitness, id);
  }

  /** Delete patterns older than ttlDays that haven't been used. */
  pruneExpired(ttlDays?: number): number {
    const ttl = ttlDays ?? this.config.patternTtlDays;
    const cutoff = Date.now() - ttl * 24 * 60 * 60 * 1000;
    const result = this.db
      .prepare(`DELETE FROM action_patterns WHERE last_used_at < ?`)
      .run(cutoff);
    return Number(result.changes);
  }

  /** Get pattern by ID. */
  getPattern(id: string): ActionPattern | undefined {
    const row = this.db.prepare(`SELECT * FROM action_patterns WHERE id = ?`).get(id) as
      | PatternRow
      | undefined;
    return row ? this.rowToPattern(row) : undefined;
  }

  /** Get aggregate stats about the store. */
  getStats(): { totalPatterns: number; avgFitness: number; avgUsage: number } {
    const row = this.db
      .prepare(
        `SELECT COUNT(*) as total, COALESCE(AVG(fitness), 0) as avg_fitness, COALESCE(AVG(usage_count), 0) as avg_usage FROM action_patterns`,
      )
      .get() as { total: number; avg_fitness: number; avg_usage: number };
    return {
      totalPatterns: row.total,
      avgFitness: row.avg_fitness,
      avgUsage: row.avg_usage,
    };
  }

  /** Close the database connection. */
  close(): void {
    this.db.close();
  }

  // --- private helpers ---

  private enforceMaxPatterns(): void {
    const count = (
      this.db.prepare(`SELECT COUNT(*) as cnt FROM action_patterns`).get() as { cnt: number }
    ).cnt;
    if (count > this.config.maxPatterns) {
      const excess = count - this.config.maxPatterns;
      this.db.exec(
        `DELETE FROM action_patterns WHERE id IN (
          SELECT id FROM action_patterns ORDER BY fitness ASC, last_used_at ASC LIMIT ${excess}
        )`,
      );
    }
  }

  private rowIdForPattern(id: string): number {
    // Deterministic numeric rowid from pattern id hash
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

  private rowToPattern(row: PatternRow): ActionPattern {
    return {
      id: row.id,
      contextText: row.context_text,
      contextEmbedding: this.parseEmbedding(row.context_embedding),
      actionSummary: row.action_summary,
      actionToolCalls: JSON.parse(row.action_tool_calls),
      outcome: {
        success: row.outcome_success === 1,
        durationMs: row.outcome_duration_ms,
        tokensSaved: row.outcome_tokens_saved ?? undefined,
      },
      fitness: row.fitness,
      usageCount: row.usage_count,
      lastUsedAt: row.last_used_at,
      createdAt: row.created_at,
      fsmState: row.fsm_state ?? undefined,
      genotypeId: row.genotype_id ?? undefined,
    };
  }
}

/** Generate a unique pattern ID. */
export function generatePatternId(): string {
  return crypto.randomUUID();
}

// -- internal row type --

type PatternRow = {
  id: string;
  context_text: string;
  context_embedding: Buffer;
  action_summary: string;
  action_tool_calls: string;
  outcome_success: number;
  outcome_duration_ms: number;
  outcome_tokens_saved: number | null;
  fitness: number;
  usage_count: number;
  last_used_at: number;
  created_at: number;
  fsm_state: string | null;
  genotype_id: string | null;
};
