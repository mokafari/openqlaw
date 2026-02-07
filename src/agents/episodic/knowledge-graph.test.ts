import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { KnowledgeGraph } from "./knowledge-graph.js";

function makeTempDb(): { dbPath: string; db: DatabaseSync } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kg-test-"));
  const dbPath = path.join(dir, "memory.db");
  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA journal_mode=WAL");
  db.exec("PRAGMA busy_timeout=5000");
  return { dbPath, db };
}

describe("KnowledgeGraph", () => {
  let dbPath: string;
  let db: DatabaseSync;
  let graph: KnowledgeGraph;

  beforeEach(() => {
    const temp = makeTempDb();
    dbPath = temp.dbPath;
    db = temp.db;
    graph = new KnowledgeGraph(db);
  });

  afterEach(() => {
    db.close();
    try {
      fs.rmSync(path.dirname(dbPath), { recursive: true, force: true });
    } catch {
      // cleanup best-effort
    }
  });

  it("upserts an entity and increments mention count", () => {
    const first = graph.upsertEntity("src/index.ts", "file");
    expect(first.mentionCount).toBe(1);

    const second = graph.upsertEntity("src/index.ts", "file");
    expect(second.mentionCount).toBe(2);
  });

  it("looks up entity by name", () => {
    graph.upsertEntity("read", "tool");
    const entity = graph.getEntity("read");
    expect(entity).toBeDefined();
    expect(entity?.entityType).toBe("tool");
  });

  it("creates and queries relations", () => {
    graph.upsertEntity("read", "tool");
    graph.upsertEntity("src/index.ts", "file");

    const relation = graph.addRelation("read", "src/index.ts", "uses", 0.7);
    expect(relation).toBeDefined();
    expect(relation?.relationType).toBe("uses");
    expect(relation?.weight).toBe(0.7);
  });

  it("returns null for relation with missing entity", () => {
    graph.upsertEntity("read", "tool");
    const relation = graph.addRelation("read", "nonexistent", "uses");
    expect(relation).toBeNull();
  });

  it("updates relation weight on duplicate", () => {
    graph.upsertEntity("read", "tool");
    graph.upsertEntity("src/index.ts", "file");

    graph.addRelation("read", "src/index.ts", "uses", 0.5);
    const updated = graph.addRelation("read", "src/index.ts", "uses", 1.0);

    // Exponential moving average: 0.5 * 0.7 + 1.0 * 0.3 = 0.65
    expect(updated?.weight).toBeCloseTo(0.65, 2);
  });

  it("traverses related entities via BFS", () => {
    graph.upsertEntity("A", "concept");
    graph.upsertEntity("B", "concept");
    graph.upsertEntity("C", "concept");
    graph.upsertEntity("D", "concept");

    graph.addRelation("A", "B", "related_to", 0.8);
    graph.addRelation("B", "C", "related_to", 0.6);
    graph.addRelation("C", "D", "related_to", 0.5);

    const related = graph.getRelatedEntities("A", 2);
    const names = related.map((r) => r.entity.name);
    expect(names).toContain("B");
    expect(names).toContain("C");
    // D is at depth 3, which exceeds the depth=2 limit
    expect(names).not.toContain("D");
  });

  it("gets relations between two entities", () => {
    graph.upsertEntity("read", "tool");
    graph.upsertEntity("edit", "tool");

    graph.addRelation("read", "edit", "followed_by", 0.5);

    const relations = graph.getRelationsBetween("read", "edit");
    expect(relations.length).toBe(1);
    expect(relations[0].relationType).toBe("followed_by");
  });

  it("gets most connected entities", () => {
    graph.upsertEntity("hub", "concept");
    graph.upsertEntity("spoke1", "concept");
    graph.upsertEntity("spoke2", "concept");
    graph.upsertEntity("spoke3", "concept");
    graph.upsertEntity("isolated", "concept");

    graph.addRelation("hub", "spoke1", "related_to");
    graph.addRelation("hub", "spoke2", "related_to");
    graph.addRelation("hub", "spoke3", "related_to");

    const connected = graph.getMostConnected(2);
    expect(connected[0].name).toBe("hub");
  });

  it("extracts file entities from text", () => {
    const entities = graph.extractEntitiesFromText(
      "Modified src/agents/tools/memory-tool.ts and checked config.json",
    );
    const files = entities.filter((e) => e.entityType === "file");
    expect(files.length).toBeGreaterThanOrEqual(1);
    expect(files.some((f) => f.name.includes("memory-tool.ts"))).toBe(true);
  });

  it("extracts tool entities from text", () => {
    const entities = graph.extractEntitiesFromText("Used memory_search and web_fetch tools");
    const tools = entities.filter((e) => e.entityType === "tool");
    expect(tools.some((t) => t.name === "memory_search")).toBe(true);
    expect(tools.some((t) => t.name === "web_fetch")).toBe(true);
  });

  it("prunes orphan entities", () => {
    // Entity with no relations and old last mention
    graph.upsertEntity("orphan", "concept");
    // Manually set old timestamp
    db.prepare("UPDATE entities SET last_mentioned_at = ? WHERE name = ?").run(
      Date.now() - 60 * 24 * 60 * 60 * 1000,
      "orphan",
    );

    // Entity with relations (should survive)
    graph.upsertEntity("connected1", "concept");
    graph.upsertEntity("connected2", "concept");
    graph.addRelation("connected1", "connected2", "related_to");

    const pruned = graph.pruneOrphans();
    expect(pruned).toBe(1);
    expect(graph.getEntity("orphan")).toBeUndefined();
    expect(graph.getEntity("connected1")).toBeDefined();
  });
});
