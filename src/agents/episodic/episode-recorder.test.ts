import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { recordEpisode } from "./episode-recorder.js";
import { EpisodeStore } from "./episode-store.js";
import { KnowledgeGraph } from "./knowledge-graph.js";
import { DEFAULT_EPISODIC_CONFIG } from "./types.js";

function makeTempDb(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "episodic-rec-test-"));
  return path.join(dir, "memory.db");
}

const mockEmbeddingProvider = {
  id: "test",
  model: "test-model",
  embedQuery: vi.fn().mockResolvedValue([0.1, 0.2, 0.3, 0.4, 0.5]),
  embedBatch: vi.fn().mockResolvedValue([[0.1, 0.2, 0.3, 0.4, 0.5]]),
};

describe("recordEpisode", () => {
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

  it("records an episode with entities and relations", async () => {
    await recordEpisode({
      store,
      graph,
      embeddingProvider: mockEmbeddingProvider,
      config: DEFAULT_EPISODIC_CONFIG,
      sessionId: "test-session",
      prompt: "Read src/index.ts and fix the bug",
      toolMetas: [
        { toolName: "read", meta: '{"path":"src/index.ts"}' },
        { toolName: "edit", meta: '{"path":"src/index.ts"}' },
      ],
      success: true,
      aborted: false,
      durationMs: 2000,
      tokenUsage: 1000,
      fsmState: "executing",
      contextDepth: 2,
      activeGoals: ["Fix bug"],
      fitness: 0.8,
    });

    // Episode should be stored
    const episodes = store.getRecentEpisodes(10);
    expect(episodes.length).toBe(1);
    expect(episodes[0].outcome).toBe("success");
    expect(episodes[0].toolsUsed).toContain("read");
    expect(episodes[0].toolsUsed).toContain("edit");

    // Entities should be extracted
    const readEntity = graph.getEntity("read");
    expect(readEntity).toBeDefined();
    expect(readEntity?.entityType).toBe("tool");

    const editEntity = graph.getEntity("edit");
    expect(editEntity).toBeDefined();

    // File entity should be extracted from the prompt
    const fileEntity = graph.getEntity("src/index.ts");
    expect(fileEntity).toBeDefined();
    expect(fileEntity?.entityType).toBe("file");
  });

  it("skips recording when fitness is too low", async () => {
    await recordEpisode({
      store,
      graph,
      embeddingProvider: mockEmbeddingProvider,
      config: DEFAULT_EPISODIC_CONFIG,
      sessionId: "test-session",
      prompt: "test",
      toolMetas: [],
      success: false,
      aborted: false,
      durationMs: 100,
      tokenUsage: 10,
      fsmState: "idle",
      contextDepth: 0,
      activeGoals: [],
      fitness: 0.05, // Below 0.1 threshold
    });

    const episodes = store.getRecentEpisodes(10);
    expect(episodes.length).toBe(0);
  });

  it("records aborted episodes as partial outcome", async () => {
    await recordEpisode({
      store,
      graph,
      embeddingProvider: mockEmbeddingProvider,
      config: DEFAULT_EPISODIC_CONFIG,
      sessionId: "test-session",
      prompt: "Long running task",
      toolMetas: [{ toolName: "exec" }],
      success: false,
      aborted: true,
      durationMs: 5000,
      tokenUsage: 2000,
      fsmState: "executing",
      contextDepth: 1,
      activeGoals: [],
      fitness: 0.4,
    });

    const episodes = store.getRecentEpisodes(10);
    expect(episodes.length).toBe(1);
    expect(episodes[0].outcome).toBe("partial");
  });

  it("creates tool sequence relations", async () => {
    await recordEpisode({
      store,
      graph,
      embeddingProvider: mockEmbeddingProvider,
      config: DEFAULT_EPISODIC_CONFIG,
      sessionId: "test-session",
      prompt: "Read and then edit",
      toolMetas: [{ toolName: "read" }, { toolName: "edit" }, { toolName: "exec" }],
      success: true,
      aborted: false,
      durationMs: 3000,
      tokenUsage: 1500,
      fsmState: "executing",
      contextDepth: 2,
      activeGoals: [],
      fitness: 0.7,
    });

    // Check sequential tool relations
    const relations = graph.getRelationsBetween("read", "edit");
    expect(relations.length).toBeGreaterThanOrEqual(1);
    expect(relations.some((r) => r.relationType === "followed_by")).toBe(true);
  });

  it("handles embedding failure gracefully", async () => {
    mockEmbeddingProvider.embedQuery.mockRejectedValueOnce(new Error("API down"));

    await recordEpisode({
      store,
      graph,
      embeddingProvider: mockEmbeddingProvider,
      config: DEFAULT_EPISODIC_CONFIG,
      sessionId: "test-session",
      prompt: "test prompt",
      toolMetas: [{ toolName: "read" }],
      success: true,
      aborted: false,
      durationMs: 1000,
      tokenUsage: 500,
      fsmState: "executing",
      contextDepth: 0,
      activeGoals: [],
      fitness: 0.6,
    });

    // Episode should still be stored (with empty embedding)
    const episodes = store.getRecentEpisodes(10);
    expect(episodes.length).toBe(1);
    expect(episodes[0].embedding).toEqual([]);
  });
});
