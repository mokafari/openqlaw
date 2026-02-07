/**
 * Knowledge Graph
 *
 * SQLite-backed entity-relationship graph with BFS traversal.
 * Shares a database with EpisodeStore (same DB file).
 *
 * Entities: files, tools, decisions, concepts
 * Relations: references, depends_on, decided_by, uses, related_to
 */

import crypto from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import type { KnowledgeEntity, KnowledgeRelation, EpisodicMemoryConfig } from "./types.js";
import { DEFAULT_EPISODIC_CONFIG } from "./types.js";

/** Known tool names for entity extraction. */
const KNOWN_TOOLS = new Set([
  "read",
  "write",
  "edit",
  "apply_patch",
  "grep",
  "find",
  "ls",
  "exec",
  "memory_search",
  "memory_get",
  "web_search",
  "web_fetch",
  "message",
  "cron",
  "gateway",
  "browser",
  "canvas",
  "tts",
  "goal_push",
  "goal_pop",
  "goal_status",
  "goal_block",
  "goal_unblock",
  "sessions_list",
  "sessions_history",
  "sessions_send",
  "sessions_spawn",
  "session_status",
  "agents_list",
  "nodes",
  "image",
  "create_tool",
  "remove_tool",
  "evolution_propose_patch",
  "evolution_run_dojo_test",
  "evolution_list_patches",
  "meta_learning",
]);

export class KnowledgeGraph {
  private db: DatabaseSync;
  private config: EpisodicMemoryConfig;

  constructor(db: DatabaseSync, config?: Partial<EpisodicMemoryConfig>) {
    this.db = db;
    this.config = { ...DEFAULT_EPISODIC_CONFIG, ...config };
    this.initSchema();
  }

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS entities (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        entity_type TEXT NOT NULL,
        last_mentioned_at INTEGER NOT NULL,
        mention_count INTEGER NOT NULL DEFAULT 1,
        metadata TEXT
      )
    `);
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_entities_type ON entities(entity_type)`);
    this.db.exec(
      `CREATE INDEX IF NOT EXISTS idx_entities_mentions ON entities(mention_count DESC)`,
    );

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS relations (
        id TEXT PRIMARY KEY,
        from_entity_id TEXT NOT NULL REFERENCES entities(id),
        to_entity_id TEXT NOT NULL REFERENCES entities(id),
        relation_type TEXT NOT NULL,
        weight REAL NOT NULL DEFAULT 0.5,
        episode_id TEXT,
        created_at INTEGER NOT NULL,
        UNIQUE(from_entity_id, to_entity_id, relation_type)
      )
    `);
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_relations_from ON relations(from_entity_id)`);
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_relations_to ON relations(to_entity_id)`);
  }

  /** Create or update an entity (increment mention count if exists). */
  upsertEntity(
    name: string,
    entityType: string,
    metadata?: Record<string, unknown>,
  ): KnowledgeEntity {
    const now = Date.now();
    const existing = this.getEntity(name);

    if (existing) {
      this.db
        .prepare(
          `UPDATE entities SET mention_count = mention_count + 1, last_mentioned_at = ? WHERE name = ?`,
        )
        .run(now, name);
      return {
        ...existing,
        mentionCount: existing.mentionCount + 1,
        lastMentionedAt: now,
      };
    }

    const id = crypto.randomUUID();
    this.db
      .prepare(
        `INSERT INTO entities (id, name, entity_type, last_mentioned_at, mention_count, metadata)
         VALUES (?, ?, ?, ?, 1, ?)`,
      )
      .run(id, name, entityType, now, metadata ? JSON.stringify(metadata) : null);

    this.enforceMaxEntities();

    return { id, name, entityType, lastMentionedAt: now, mentionCount: 1, metadata };
  }

  /** Add or update a relation between two entities. */
  addRelation(
    fromEntityName: string,
    toEntityName: string,
    relationType: string,
    weight: number = 0.5,
    episodeId?: string,
  ): KnowledgeRelation | null {
    const from = this.getEntity(fromEntityName);
    const to = this.getEntity(toEntityName);
    if (!from || !to) {
      return null;
    }

    const now = Date.now();

    // Upsert: update weight if relation exists, otherwise insert
    const existing = this.db
      .prepare(
        `SELECT * FROM relations
         WHERE from_entity_id = ? AND to_entity_id = ? AND relation_type = ?`,
      )
      .get(from.id, to.id, relationType) as RelationRow | undefined;

    if (existing) {
      // Exponential moving average for weight
      const newWeight = existing.weight * 0.7 + weight * 0.3;
      this.db
        .prepare(`UPDATE relations SET weight = ?, episode_id = ? WHERE id = ?`)
        .run(newWeight, episodeId ?? existing.episode_id, existing.id);
      return {
        id: existing.id,
        fromEntityId: from.id,
        toEntityId: to.id,
        relationType,
        weight: newWeight,
        episodeId: episodeId ?? existing.episode_id ?? undefined,
        createdAt: existing.created_at,
      };
    }

    const id = crypto.randomUUID();
    this.db
      .prepare(
        `INSERT INTO relations (id, from_entity_id, to_entity_id, relation_type, weight, episode_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(id, from.id, to.id, relationType, weight, episodeId ?? null, now);

    return {
      id,
      fromEntityId: from.id,
      toEntityId: to.id,
      relationType,
      weight,
      episodeId,
      createdAt: now,
    };
  }

  /** Look up an entity by name. */
  getEntity(name: string): KnowledgeEntity | undefined {
    const row = this.db.prepare(`SELECT * FROM entities WHERE name = ?`).get(name) as
      | EntityRow
      | undefined;
    return row ? this.rowToEntity(row) : undefined;
  }

  /**
   * BFS traversal from a starting entity up to the configured depth.
   * Returns all reachable entities with their traversal path and weight.
   */
  getRelatedEntities(
    entityName: string,
    depth?: number,
    relationTypes?: string[],
  ): Array<{ entity: KnowledgeEntity; path: string[]; depth: number; totalWeight: number }> {
    const maxDepth = depth ?? this.config.graphDepth;
    const startEntity = this.getEntity(entityName);
    if (!startEntity) {
      return [];
    }

    const visited = new Set<string>([startEntity.id]);
    const results: Array<{
      entity: KnowledgeEntity;
      path: string[];
      depth: number;
      totalWeight: number;
    }> = [];

    // BFS queue: [entityId, path, currentDepth, accumulatedWeight]
    const queue: Array<[string, string[], number, number]> = [
      [startEntity.id, [entityName], 0, 1.0],
    ];

    while (queue.length > 0) {
      const [currentId, currentPath, currentDepth, currentWeight] = queue.shift()!;

      if (currentDepth >= maxDepth) {
        continue;
      }

      // Get outgoing relations
      let relQuery = `SELECT r.*, e.* FROM relations r
        JOIN entities e ON e.id = r.to_entity_id
        WHERE r.from_entity_id = ?`;
      const params: string[] = [currentId];

      if (relationTypes && relationTypes.length > 0) {
        const placeholders = relationTypes.map(() => "?").join(", ");
        relQuery += ` AND r.relation_type IN (${placeholders})`;
        params.push(...relationTypes);
      }

      const rows = this.db.prepare(relQuery).all(...params) as Array<RelationRow & EntityRow>;

      for (const row of rows) {
        if (visited.has(row.to_entity_id)) {
          continue;
        }
        visited.add(row.to_entity_id);

        const entity = this.rowToEntity(row);
        const newPath = [...currentPath, entity.name];
        const newWeight = currentWeight * row.weight;

        results.push({
          entity,
          path: newPath,
          depth: currentDepth + 1,
          totalWeight: newWeight,
        });

        queue.push([row.to_entity_id, newPath, currentDepth + 1, newWeight]);
      }

      // Also traverse incoming edges (bidirectional traversal)
      let inQuery = `SELECT r.*, e.* FROM relations r
        JOIN entities e ON e.id = r.from_entity_id
        WHERE r.to_entity_id = ?`;
      const inParams: string[] = [currentId];

      if (relationTypes && relationTypes.length > 0) {
        const placeholders = relationTypes.map(() => "?").join(", ");
        inQuery += ` AND r.relation_type IN (${placeholders})`;
        inParams.push(...relationTypes);
      }

      const inRows = this.db.prepare(inQuery).all(...inParams) as Array<RelationRow & EntityRow>;

      for (const row of inRows) {
        if (visited.has(row.from_entity_id)) {
          continue;
        }
        visited.add(row.from_entity_id);

        const entity = this.rowToEntity(row);
        const newPath = [...currentPath, entity.name];
        const newWeight = currentWeight * row.weight;

        results.push({
          entity,
          path: newPath,
          depth: currentDepth + 1,
          totalWeight: newWeight,
        });

        queue.push([row.from_entity_id, newPath, currentDepth + 1, newWeight]);
      }
    }

    return results;
  }

  /** Get direct relations between two entities. */
  getRelationsBetween(entity1: string, entity2: string): KnowledgeRelation[] {
    const e1 = this.getEntity(entity1);
    const e2 = this.getEntity(entity2);
    if (!e1 || !e2) {
      return [];
    }

    const rows = this.db
      .prepare(
        `SELECT * FROM relations
         WHERE (from_entity_id = ? AND to_entity_id = ?)
            OR (from_entity_id = ? AND to_entity_id = ?)`,
      )
      .all(e1.id, e2.id, e2.id, e1.id) as RelationRow[];

    return rows.map((r) => this.rowToRelation(r));
  }

  /** Get entities sorted by connection degree (mention count + relation count). */
  getMostConnected(limit: number = 20): KnowledgeEntity[] {
    const rows = this.db
      .prepare(
        `SELECT e.*, (
           e.mention_count +
           (SELECT COUNT(*) FROM relations r WHERE r.from_entity_id = e.id OR r.to_entity_id = e.id)
         ) as degree
         FROM entities e
         ORDER BY degree DESC
         LIMIT ?`,
      )
      .all(limit) as Array<EntityRow & { degree: number }>;

    return rows.map((r) => this.rowToEntity(r));
  }

  /**
   * Lightweight pattern-based entity extraction from text.
   * No LLM calls — regex-based: files, tools, decisions, concepts.
   */
  extractEntitiesFromText(text: string): Array<{ name: string; entityType: string }> {
    const entities: Array<{ name: string; entityType: string }> = [];
    const seen = new Set<string>();

    const addEntity = (name: string, type: string) => {
      const key = `${type}:${name}`;
      if (!seen.has(key)) {
        seen.add(key);
        entities.push({ name, entityType: type });
      }
    };

    // Files: paths with extensions
    const filePattern =
      /(?:^|\s|["'`(])([a-zA-Z0-9_\-./]+\.(?:ts|js|md|json|py|sh|yaml|yml|toml|sql|css|html|tsx|jsx))\b/g;
    let match;
    while ((match = filePattern.exec(text)) !== null) {
      const filePath = match[1];
      // Skip very short matches and common false positives
      if (filePath.length >= 4 && !filePath.startsWith(".")) {
        addEntity(filePath, "file");
      }
    }

    // Tools: match against known tool names
    for (const tool of KNOWN_TOOLS) {
      if (text.includes(tool)) {
        addEntity(tool, "tool");
      }
    }

    // Decisions: phrases like "decided to", "chose", "will use"
    const decisionPattern =
      /(?:decided to|chose|will use|should use|opted for|switched to)\s+(.{5,60}?)(?:[.!,;]|$)/gi;
    while ((match = decisionPattern.exec(text)) !== null) {
      addEntity(match[1].trim(), "decision");
    }

    return entities;
  }

  /** Remove entities with zero relations and no recent mentions. */
  pruneOrphans(staleMs: number = 30 * 24 * 60 * 60 * 1000): number {
    const cutoff = Date.now() - staleMs;
    const result = this.db
      .prepare(
        `DELETE FROM entities WHERE id NOT IN (
           SELECT from_entity_id FROM relations
           UNION
           SELECT to_entity_id FROM relations
         ) AND last_mentioned_at < ? AND mention_count <= 1`,
      )
      .run(cutoff);
    return Number(result.changes);
  }

  // --- private helpers ---

  private enforceMaxEntities(): void {
    const count = (
      this.db.prepare(`SELECT COUNT(*) as cnt FROM entities`).get() as {
        cnt: number;
      }
    ).cnt;
    if (count > this.config.maxEntities) {
      const excess = count - this.config.maxEntities;
      this.db.exec(
        `DELETE FROM entities WHERE id IN (
          SELECT id FROM entities ORDER BY mention_count ASC, last_mentioned_at ASC LIMIT ${excess}
        )`,
      );
    }
  }

  private rowToEntity(row: EntityRow): KnowledgeEntity {
    return {
      id: row.id,
      name: row.name,
      entityType: row.entity_type,
      lastMentionedAt: row.last_mentioned_at,
      mentionCount: row.mention_count,
      metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
    };
  }

  private rowToRelation(row: RelationRow): KnowledgeRelation {
    return {
      id: row.id,
      fromEntityId: row.from_entity_id,
      toEntityId: row.to_entity_id,
      relationType: row.relation_type,
      weight: row.weight,
      episodeId: row.episode_id ?? undefined,
      createdAt: row.created_at,
    };
  }
}

type EntityRow = {
  id: string;
  name: string;
  entity_type: string;
  last_mentioned_at: number;
  mention_count: number;
  metadata: string | null;
};

type RelationRow = {
  id: string;
  from_entity_id: string;
  to_entity_id: string;
  relation_type: string;
  weight: number;
  episode_id: string | null;
  created_at: number;
};
