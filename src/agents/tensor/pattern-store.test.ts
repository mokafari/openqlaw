import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { ActionPattern } from "./types.js";
import { PatternStore, generatePatternId } from "./pattern-store.js";

function makeTempDb(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tensor-test-"));
  return path.join(dir, "patterns.db");
}

function makePattern(overrides?: Partial<ActionPattern>): ActionPattern {
  return {
    id: generatePatternId(),
    contextEmbedding: [0.1, 0.2, 0.3, 0.4, 0.5],
    contextText: "test prompt",
    actionSummary: "Used read_file (1 call)",
    actionToolCalls: [{ name: "read_file", params: { path: "/tmp/test" } }],
    outcome: { success: true, durationMs: 1000 },
    fitness: 0.8,
    usageCount: 0,
    lastUsedAt: Date.now(),
    createdAt: Date.now(),
    ...overrides,
  };
}

describe("PatternStore", () => {
  let dbPath: string;
  let store: PatternStore;

  beforeEach(() => {
    dbPath = makeTempDb();
    store = new PatternStore(dbPath);
  });

  afterEach(() => {
    store.close();
    try {
      fs.rmSync(path.dirname(dbPath), { recursive: true, force: true });
    } catch {
      // cleanup best-effort
    }
  });

  it("inserts and retrieves a pattern", () => {
    const pattern = makePattern();
    store.insertPattern(pattern);

    const retrieved = store.getPattern(pattern.id);
    expect(retrieved).toBeDefined();
    expect(retrieved?.id).toBe(pattern.id);
    expect(retrieved?.actionSummary).toBe(pattern.actionSummary);
    expect(retrieved?.fitness).toBe(0.8);
    expect(retrieved?.outcome.success).toBe(true);
  });

  it("searches by vector similarity", () => {
    // Insert patterns with different embeddings
    store.insertPattern(makePattern({ contextEmbedding: [1, 0, 0, 0, 0], fitness: 0.9 }));
    store.insertPattern(makePattern({ contextEmbedding: [0, 1, 0, 0, 0], fitness: 0.8 }));
    store.insertPattern(makePattern({ contextEmbedding: [0.9, 0.1, 0, 0, 0], fitness: 0.85 }));

    // Search with embedding close to [1, 0, 0, 0, 0]
    const results = store.searchByVector([1, 0, 0, 0, 0], 3);
    expect(results.length).toBeGreaterThan(0);
    // The closest match should have the highest similarity
    expect(results[0].similarity).toBeGreaterThanOrEqual(results[results.length - 1].similarity);
  });

  it("respects minFitness in search", () => {
    store.insertPattern(makePattern({ contextEmbedding: [1, 0, 0, 0, 0], fitness: 0.5 }));
    store.insertPattern(makePattern({ contextEmbedding: [1, 0, 0, 0, 0], fitness: 0.9 }));

    const results = store.searchByVector([1, 0, 0, 0, 0], 10, 0.8);
    expect(results.length).toBe(1);
    expect(results[0].fitness).toBeGreaterThanOrEqual(0.8);
  });

  it("touches a pattern (increments usage)", () => {
    const pattern = makePattern({ usageCount: 0 });
    store.insertPattern(pattern);

    store.touchPattern(pattern.id);
    const updated = store.getPattern(pattern.id);
    expect(updated?.usageCount).toBe(1);
  });

  it("updates fitness", () => {
    const pattern = makePattern({ fitness: 0.5 });
    store.insertPattern(pattern);

    store.updateFitness(pattern.id, 0.95);
    expect(store.getPattern(pattern.id)?.fitness).toBe(0.95);
  });

  it("prunes expired patterns", () => {
    const old = makePattern({
      lastUsedAt: Date.now() - 100 * 24 * 60 * 60 * 1000, // 100 days ago
    });
    const recent = makePattern({ lastUsedAt: Date.now() });

    store.insertPattern(old);
    store.insertPattern(recent);

    const pruned = store.pruneExpired(90);
    expect(pruned).toBe(1);
    expect(store.getPattern(old.id)).toBeUndefined();
    expect(store.getPattern(recent.id)).toBeDefined();
  });

  it("enforces maxPatterns", () => {
    const smallStore = new PatternStore(dbPath, { maxPatterns: 3 });
    for (let i = 0; i < 5; i++) {
      smallStore.insertPattern(makePattern({ fitness: i * 0.2 }));
    }

    const stats = smallStore.getStats();
    expect(stats.totalPatterns).toBeLessThanOrEqual(3);
    smallStore.close();
  });

  it("returns stats", () => {
    store.insertPattern(makePattern({ fitness: 0.8 }));
    store.insertPattern(makePattern({ fitness: 0.6 }));

    const stats = store.getStats();
    expect(stats.totalPatterns).toBe(2);
    expect(stats.avgFitness).toBeCloseTo(0.7, 1);
  });
});
