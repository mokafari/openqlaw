/**
 * Episodic Recall Tool
 *
 * Exposes state-aware episodic memory recall as an agent tool.
 * Lazy-initializes EpisodeStore + KnowledgeGraph from agentDir.
 */

import { Type } from "@sinclair/typebox";
import path from "node:path";
import type { OpenClawConfig } from "../../config/config.js";
import type { AnyAgentTool } from "./common.js";
import { jsonResult, readStringParam } from "./common.js";

const EpisodicRecallSchema = Type.Object({
  query: Type.String(),
});

export function createEpisodicRecallTool(options: {
  config?: OpenClawConfig;
  agentDir?: string;
  agentSessionKey?: string;
}): AnyAgentTool | null {
  const episodicCfg = options.config?.tools?.evolution?.episodic;
  if (!episodicCfg?.enabled) {
    return null;
  }
  if (!options.agentDir?.trim()) {
    return null;
  }

  return {
    label: "Episodic Memory",
    name: "episodic_recall",
    description:
      "Search episodic memory for relevant past experiences, decisions, and patterns. " +
      "Uses current agent state and goals for context-aware retrieval. " +
      "Returns structured episodes with summaries, tools used, outcomes, and graph-expanded context.",
    parameters: EpisodicRecallSchema,
    execute: async (_toolCallId, params) => {
      const query = readStringParam(params, "query", { required: true });

      try {
        // Lazy imports to avoid loading sqlite when disabled
        const { EpisodeStore } = await import("../episodic/episode-store.js");
        const { KnowledgeGraph } = await import("../episodic/knowledge-graph.js");
        const { recallEpisodic } = await import("../episodic/state-aware-recall.js");
        const { createEmbeddingProvider } = await import("../../memory/embeddings.js");
        const { DEFAULT_EPISODIC_CONFIG } = await import("../episodic/types.js");
        const { loadConfig } = await import("../../config/config.js");

        const cfg = options.config ?? loadConfig();
        const resolvedCfg = { ...DEFAULT_EPISODIC_CONFIG, ...episodicCfg };

        const dbPath = path.join(options.agentDir!, "episodic", "memory.db");
        const store = new EpisodeStore(dbPath, resolvedCfg);
        await store.initVec().catch(() => {});

        const graph = new KnowledgeGraph(
          // Access the DB from the store — share the same DB connection
          // KnowledgeGraph takes a DatabaseSync, but we create a separate store instance
          // Actually, KnowledgeGraph needs its own DB reference.
          // Re-open from same path; WAL mode handles concurrent readers.
          new (await import("node:sqlite")).DatabaseSync(dbPath),
          resolvedCfg,
        );

        const embResult = await createEmbeddingProvider({
          config: cfg,
          agentDir: options.agentDir,
          provider: "auto",
          model: "text-embedding-3-small",
          fallback: "local",
        });

        // Resolve current goals from session store (FSM state not available at tool time)
        let activeGoals: string[] = [];
        try {
          const { loadSessionStore, resolveStorePath } = await import("../../config/sessions.js");
          const { resolveAgentIdFromSessionKey } = await import("../../routing/session-key.js");
          const { resolveInternalSessionKey, resolveMainSessionAlias } =
            await import("../tools/sessions-helpers.js");

          if (options.agentSessionKey) {
            const agentId = resolveAgentIdFromSessionKey(options.agentSessionKey);
            const storePath = resolveStorePath(undefined, { agentId });
            const sessionStore = loadSessionStore(storePath);
            const { alias, mainKey } = resolveMainSessionAlias(cfg);
            const internalKey = resolveInternalSessionKey({
              key: options.agentSessionKey,
              alias,
              mainKey,
            });
            const sessionEntry = sessionStore[internalKey];
            if (sessionEntry?.goalStack?.goals) {
              activeGoals = sessionEntry.goalStack.goals
                .filter((g: { description?: string }) => g.description)
                .map((g: { description: string }) => g.description);
            }
          }
        } catch {
          // Non-fatal: proceed without state context
        }

        const results = await recallEpisodic({
          store,
          graph,
          embeddingProvider: embResult.provider,
          query,
          activeGoals,
          limit: 10,
        });

        // Close the store after query
        store.close();

        // Format results
        const formatted = results.map((r) => ({
          summary: r.episode.summary.slice(0, 500),
          outcome: r.episode.outcome,
          fitness: Number(r.episode.fitness.toFixed(3)),
          toolsUsed: r.episode.toolsUsed,
          fsmState: r.episode.fsmState,
          goals: r.episode.goals.slice(0, 3),
          relevance: Number(r.relevance.toFixed(3)),
          rationale: r.rationale,
          age: formatAge(r.episode.createdAt),
        }));

        return jsonResult({
          results: formatted,
          totalEpisodes: results.length,
        });
      } catch (err) {
        return jsonResult({
          error: `Episodic recall failed: ${err instanceof Error ? err.message : String(err)}`,
          results: [],
        });
      }
    },
  };
}

function formatAge(createdAt: number): string {
  const ageMs = Date.now() - createdAt;
  const hours = Math.floor(ageMs / (1000 * 60 * 60));
  if (hours < 1) {
    return "< 1 hour ago";
  }
  if (hours < 24) {
    return `${hours}h ago`;
  }
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
