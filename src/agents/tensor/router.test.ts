import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { EmbeddingProvider } from "../../memory/embeddings.js";
import type { TensorConfig } from "./types.js";
import { PatternStore, generatePatternId } from "./pattern-store.js";
import { TensorRouter } from "./router.js";
import { DEFAULT_TENSOR_CONFIG } from "./types.js";

function makeTempDb(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tensor-router-test-"));
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

describe("TensorRouter", () => {
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

  it("routes to system2 when no patterns exist", async () => {
    const provider = makeEmbeddingProvider([1, 0, 0]);
    const router = new TensorRouter({ store, embeddingProvider: provider, config });

    const decision = await router.route({ prompt: "hello" });
    expect(decision.route).toBe("system2");
  });

  it("routes to system2 when forceSystem2 is true", async () => {
    const embedding = [1, 0, 0, 0, 0];
    store.insertPattern({
      id: generatePatternId(),
      contextEmbedding: embedding,
      contextText: "hello",
      actionSummary: "test",
      actionToolCalls: [{ name: "read_file", params: {} }],
      outcome: { success: true, durationMs: 500 },
      fitness: 0.95,
      usageCount: 5,
      lastUsedAt: Date.now(),
      createdAt: Date.now(),
    });

    const provider = makeEmbeddingProvider(embedding);
    const router = new TensorRouter({ store, embeddingProvider: provider, config });

    const decision = await router.route({ prompt: "hello", forceSystem2: true });
    expect(decision.route).toBe("system2");
    expect(decision.rationale).toContain("forced");
  });

  it("routes to system1 with high-confidence pattern match", async () => {
    const embedding = [1, 0, 0, 0, 0];
    store.insertPattern({
      id: generatePatternId(),
      contextEmbedding: embedding,
      contextText: "hello",
      actionSummary: "test",
      actionToolCalls: [{ name: "read_file", params: {} }],
      outcome: { success: true, durationMs: 500 },
      fitness: 0.95,
      usageCount: 3,
      lastUsedAt: Date.now(),
      createdAt: Date.now(),
    });

    const provider = makeEmbeddingProvider(embedding);
    const router = new TensorRouter({ store, embeddingProvider: provider, config });

    const decision = await router.route({ prompt: "hello" });
    expect(decision.route).toBe("system1");
    expect(decision.pattern).toBeDefined();
    expect(decision.confidence).toBeGreaterThan(0.8);
  });
});
