import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { Episode } from "./types.js";
import { EpisodeStore, generateEpisodeId } from "./episode-store.js";

function makeTempDb(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "episodic-test-"));
  return path.join(dir, "memory.db");
}

function makeEpisode(overrides?: Partial<Episode>): Episode {
  return {
    id: generateEpisodeId(),
    sessionId: "test-session",
    summary: "User asked to read a file and edit it",
    embedding: [0.1, 0.2, 0.3, 0.4, 0.5],
    fsmState: "executing",
    contextDepth: 2,
    goals: ["Read file", "Edit file"],
    toolsUsed: ["read", "edit"],
    outcome: "success",
    fitness: 0.8,
    durationMs: 1500,
    tokenUsage: 500,
    createdAt: Date.now(),
    ...overrides,
  };
}

describe("EpisodeStore", () => {
  let dbPath: string;
  let store: EpisodeStore;

  beforeEach(() => {
    dbPath = makeTempDb();
    store = new EpisodeStore(dbPath);
  });

  afterEach(() => {
    store.close();
    try {
      fs.rmSync(path.dirname(dbPath), { recursive: true, force: true });
    } catch {
      // cleanup best-effort
    }
  });

  it("inserts and retrieves an episode", () => {
    const episode = makeEpisode();
    store.insertEpisode(episode);

    const retrieved = store.getEpisode(episode.id);
    expect(retrieved).toBeDefined();
    expect(retrieved?.id).toBe(episode.id);
    expect(retrieved?.summary).toBe(episode.summary);
    expect(retrieved?.fitness).toBe(0.8);
    expect(retrieved?.outcome).toBe("success");
    expect(retrieved?.toolsUsed).toEqual(["read", "edit"]);
    expect(retrieved?.goals).toEqual(["Read file", "Edit file"]);
  });

  it("searches by vector similarity", () => {
    // Insert episodes with different embeddings
    store.insertEpisode(makeEpisode({ embedding: [1, 0, 0, 0, 0], summary: "alpha" }));
    store.insertEpisode(makeEpisode({ embedding: [0, 1, 0, 0, 0], summary: "beta" }));
    store.insertEpisode(makeEpisode({ embedding: [0.9, 0.1, 0, 0, 0], summary: "gamma" }));

    const results = store.searchByVector([1, 0, 0, 0, 0], 2);
    expect(results.length).toBe(2);
    // Most similar should be first
    expect(results[0].summary).toBe("alpha");
    expect(results[0].similarity).toBeGreaterThan(results[1].similarity);
  });

  it("filters by FSM state", () => {
    store.insertEpisode(makeEpisode({ fsmState: "planning" }));
    store.insertEpisode(makeEpisode({ fsmState: "executing" }));
    store.insertEpisode(makeEpisode({ fsmState: "planning" }));

    const planningEpisodes = store.getEpisodesByState("planning");
    expect(planningEpisodes.length).toBe(2);
    expect(planningEpisodes.every((e) => e.fsmState === "planning")).toBe(true);
  });

  it("returns recent episodes in order", () => {
    const older = makeEpisode({ createdAt: Date.now() - 10000, summary: "old" });
    const newer = makeEpisode({ createdAt: Date.now(), summary: "new" });
    store.insertEpisode(older);
    store.insertEpisode(newer);

    const recent = store.getRecentEpisodes(10);
    expect(recent.length).toBe(2);
    expect(recent[0].summary).toBe("new");
    expect(recent[1].summary).toBe("old");
  });

  it("prunes expired episodes", () => {
    const old = makeEpisode({ createdAt: Date.now() - 200 * 24 * 60 * 60 * 1000 });
    const recent = makeEpisode({ createdAt: Date.now() });
    store.insertEpisode(old);
    store.insertEpisode(recent);

    const pruned = store.pruneExpired(180);
    expect(pruned).toBe(1);

    const remaining = store.getRecentEpisodes(10);
    expect(remaining.length).toBe(1);
    expect(remaining[0].id).toBe(recent.id);
  });

  it("enforces maxEpisodes by removing lowest-fitness", () => {
    const storeSmall = new EpisodeStore(dbPath, { maxEpisodes: 3 });
    storeSmall.insertEpisode(makeEpisode({ fitness: 0.5 }));
    storeSmall.insertEpisode(makeEpisode({ fitness: 0.9 }));
    storeSmall.insertEpisode(makeEpisode({ fitness: 0.3 }));
    storeSmall.insertEpisode(makeEpisode({ fitness: 0.7 }));

    const stats = storeSmall.getStats();
    expect(stats.totalEpisodes).toBe(3);
    storeSmall.close();
  });

  it("returns stats with outcome distribution", () => {
    store.insertEpisode(makeEpisode({ outcome: "success" }));
    store.insertEpisode(makeEpisode({ outcome: "success" }));
    store.insertEpisode(makeEpisode({ outcome: "failure" }));

    const stats = store.getStats();
    expect(stats.totalEpisodes).toBe(3);
    expect(stats.outcomeDistribution.success).toBe(2);
    expect(stats.outcomeDistribution.failure).toBe(1);
  });

  it("handles empty embedding gracefully", () => {
    const episode = makeEpisode({ embedding: [] });
    store.insertEpisode(episode);

    const retrieved = store.getEpisode(episode.id);
    expect(retrieved).toBeDefined();
    expect(retrieved?.embedding).toEqual([]);
  });
});
