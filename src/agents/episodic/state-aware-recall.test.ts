import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { Episode } from "./types.js";
import { EpisodeStore, generateEpisodeId } from "./episode-store.js";
import { KnowledgeGraph } from "./knowledge-graph.js";
import { recallEpisodic } from "./state-aware-recall.js";

function makeTempDb(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "recall-test-"));
  return path.join(dir, "memory.db");
}

function makeEpisode(overrides?: Partial<Episode>): Episode {
  return {
    id: generateEpisodeId(),
    sessionId: "test-session",
    summary: "Default test episode",
    embedding: [0.1, 0.2, 0.3, 0.4, 0.5],
    fsmState: "executing",
    contextDepth: 2,
    goals: ["Test goal"],
    toolsUsed: ["read"],
    outcome: "success",
    fitness: 0.8,
    durationMs: 1500,
    tokenUsage: 500,
    createdAt: Date.now(),
    ...overrides,
  };
}

const mockEmbeddingProvider = {
  id: "test",
  model: "test-model",
  embedQuery: vi.fn().mockResolvedValue([0.1, 0.2, 0.3, 0.4, 0.5]),
  embedBatch: vi.fn().mockResolvedValue([[0.1, 0.2, 0.3, 0.4, 0.5]]),
};

describe("recallEpisodic", () => {
  let dbPath: string;
  let store: EpisodeStore;
  let graphDb: DatabaseSync;
  let graph: KnowledgeGraph;

  beforeEach(() => {
    dbPath = makeTempDb();
    store = new EpisodeStore(dbPath);
    graphDb = new DatabaseSync(dbPath);
    graphDb.exec("PRAGMA journal_mode=WAL");
    graphDb.exec("PRAGMA busy_timeout=5000");
    graph = new KnowledgeGraph(graphDb);
    vi.clearAllMocks();
  });

  afterEach(() => {
    store.close();
    graphDb.close();
    try {
      fs.rmSync(path.dirname(dbPath), { recursive: true, force: true });
    } catch {
      // cleanup best-effort
    }
  });

  it("returns empty results from empty store", async () => {
    const results = await recallEpisodic({
      store,
      graph,
      embeddingProvider: mockEmbeddingProvider,
      query: "test query",
    });
    expect(results).toEqual([]);
  });

  it("retrieves episodes by vector similarity", async () => {
    store.insertEpisode(
      makeEpisode({
        summary: "Read a config file",
        embedding: [0.1, 0.2, 0.3, 0.4, 0.5],
      }),
    );
    store.insertEpisode(
      makeEpisode({
        summary: "Sent a message to user",
        embedding: [0.9, 0.8, 0.7, 0.6, 0.5],
      }),
    );

    const results = await recallEpisodic({
      store,
      graph,
      embeddingProvider: mockEmbeddingProvider,
      query: "read config",
      limit: 5,
    });

    expect(results.length).toBe(2);
    // First result should be the one matching our mock embedding
    expect(results[0].relevance).toBeGreaterThanOrEqual(results[1].relevance);
  });

  it("boosts episodes matching current FSM state", async () => {
    store.insertEpisode(
      makeEpisode({
        summary: "Planning phase episode",
        fsmState: "planning",
        embedding: [0.1, 0.2, 0.3, 0.4, 0.5],
      }),
    );
    store.insertEpisode(
      makeEpisode({
        summary: "Executing phase episode",
        fsmState: "executing",
        embedding: [0.1, 0.2, 0.3, 0.4, 0.5],
      }),
    );

    const results = await recallEpisodic({
      store,
      graph,
      embeddingProvider: mockEmbeddingProvider,
      query: "test",
      fsmState: "executing",
    });

    expect(results.length).toBe(2);
    // The executing episode should be ranked higher due to state boost
    const executingResult = results.find((r) => r.episode.fsmState === "executing");
    const planningResult = results.find((r) => r.episode.fsmState === "planning");
    expect(executingResult?.relevance).toBeGreaterThan(planningResult?.relevance ?? 0);
  });

  it("boosts episodes with overlapping goals", async () => {
    store.insertEpisode(
      makeEpisode({
        summary: "Working on auth",
        goals: ["Implement authentication"],
        embedding: [0.1, 0.2, 0.3, 0.4, 0.5],
      }),
    );
    store.insertEpisode(
      makeEpisode({
        summary: "Working on UI",
        goals: ["Build dashboard"],
        embedding: [0.1, 0.2, 0.3, 0.4, 0.5],
      }),
    );

    const results = await recallEpisodic({
      store,
      graph,
      embeddingProvider: mockEmbeddingProvider,
      query: "test",
      activeGoals: ["Implement authentication"],
    });

    expect(results.length).toBe(2);
    const authResult = results.find((r) => r.episode.goals.includes("Implement authentication"));
    const uiResult = results.find((r) => r.episode.goals.includes("Build dashboard"));
    expect(authResult?.relevance).toBeGreaterThan(uiResult?.relevance ?? 0);
  });

  it("includes rationale in results", async () => {
    store.insertEpisode(
      makeEpisode({
        summary: "Episode with state match",
        fsmState: "executing",
        embedding: [0.1, 0.2, 0.3, 0.4, 0.5],
      }),
    );

    const results = await recallEpisodic({
      store,
      graph,
      embeddingProvider: mockEmbeddingProvider,
      query: "test",
      fsmState: "executing",
    });

    expect(results.length).toBe(1);
    expect(results[0].rationale).toContain("same FSM state");
  });

  it("handles embedding failure gracefully", async () => {
    mockEmbeddingProvider.embedQuery.mockRejectedValueOnce(new Error("API down"));

    store.insertEpisode(makeEpisode({ summary: "Some episode" }));

    // Should still return results via keyword fallback or empty
    const results = await recallEpisodic({
      store,
      graph,
      embeddingProvider: mockEmbeddingProvider,
      query: "episode",
    });
    // May return empty or recent fallback — either is acceptable
    expect(Array.isArray(results)).toBe(true);
  });
});
