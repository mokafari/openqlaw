import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { EmbeddingProvider } from "../../memory/embeddings.js";
import type { TensorConfig } from "./types.js";
import { recallPattern } from "./pattern-recall.js";
import { PatternStore, generatePatternId } from "./pattern-store.js";
import { DEFAULT_TENSOR_CONFIG } from "./types.js";

function makeTempDb(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tensor-recall-test-"));
  return path.join(dir, "patterns.db");
}

function makeEmbeddingProvider(embedding: number[]): EmbeddingProvider {
  return {
    id: "test",
    model: "test-model",
    embedQuery: vi.fn().mockResolvedValue(embedding),
    embedBatch: vi.fn().mockResolvedValue([embedding]),
  };
}

describe("recallPattern", () => {
  let dbPath: string;
  let store: PatternStore;
  const config: TensorConfig = { ...DEFAULT_TENSOR_CONFIG, enabled: true };

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

  it("returns no match when store is empty", async () => {
    const provider = makeEmbeddingProvider([1, 0, 0]);
    const result = await recallPattern({
      store,
      embeddingProvider: provider,
      prompt: "test",
      config,
    });
    expect(result.matched).toBe(false);
    expect(result.shouldBypass).toBe(false);
  });

  it("returns no match when disabled", async () => {
    const provider = makeEmbeddingProvider([1, 0, 0]);
    const result = await recallPattern({
      store,
      embeddingProvider: provider,
      prompt: "test",
      config: { ...config, enabled: false },
    });
    expect(result.matched).toBe(false);
    expect(result.rationale).toContain("disabled");
  });

  it("finds a matching pattern with high confidence", async () => {
    const embedding = [1, 0, 0, 0, 0];
    store.insertPattern({
      id: generatePatternId(),
      contextEmbedding: embedding,
      contextText: "test prompt",
      actionSummary: "test action",
      actionToolCalls: [{ name: "read_file", params: {} }],
      outcome: { success: true, durationMs: 500 },
      fitness: 0.95,
      usageCount: 3,
      lastUsedAt: Date.now(),
      createdAt: Date.now(),
    });

    const provider = makeEmbeddingProvider(embedding);
    const result = await recallPattern({
      store,
      embeddingProvider: provider,
      prompt: "test",
      config,
    });

    expect(result.matched).toBe(true);
    expect(result.similarity).toBeCloseTo(1.0, 1);
    expect(result.confidence).toBeGreaterThan(0.8);
    expect(result.shouldBypass).toBe(true);
  });

  it("does not bypass on first encounter (usageCount === 0)", async () => {
    const embedding = [1, 0, 0, 0, 0];
    store.insertPattern({
      id: generatePatternId(),
      contextEmbedding: embedding,
      contextText: "test prompt",
      actionSummary: "test action",
      actionToolCalls: [{ name: "read_file", params: {} }],
      outcome: { success: true, durationMs: 500 },
      fitness: 0.95,
      usageCount: 0, // first encounter
      lastUsedAt: Date.now(),
      createdAt: Date.now(),
    });

    const provider = makeEmbeddingProvider(embedding);
    const result = await recallPattern({
      store,
      embeddingProvider: provider,
      prompt: "test",
      config,
    });

    expect(result.matched).toBe(true);
    expect(result.shouldBypass).toBe(false);
  });

  it("does not match low-fitness patterns", async () => {
    const embedding = [1, 0, 0, 0, 0];
    store.insertPattern({
      id: generatePatternId(),
      contextEmbedding: embedding,
      contextText: "test prompt",
      actionSummary: "test action",
      actionToolCalls: [{ name: "read_file", params: {} }],
      outcome: { success: true, durationMs: 500 },
      fitness: 0.3, // below threshold
      usageCount: 5,
      lastUsedAt: Date.now(),
      createdAt: Date.now(),
    });

    const provider = makeEmbeddingProvider(embedding);
    const result = await recallPattern({
      store,
      embeddingProvider: provider,
      prompt: "test",
      config: { ...config, minFitnessForRecall: 0.7 },
    });

    expect(result.matched).toBe(false);
  });
});
