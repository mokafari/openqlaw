/**
 * Episode Recorder
 *
 * Called after agent runs complete to record a structured episode
 * with entity extraction and knowledge graph wiring.
 */

import type { EmbeddingProvider } from "../../memory/embeddings.js";
import type { EpisodicMemoryConfig } from "./types.js";
import { EpisodeStore, generateEpisodeId } from "./episode-store.js";
import { KnowledgeGraph } from "./knowledge-graph.js";
import { log } from "./logger.js";

export type RecordEpisodeParams = {
  store: EpisodeStore;
  graph: KnowledgeGraph;
  embeddingProvider: EmbeddingProvider;
  config: EpisodicMemoryConfig;
  sessionId: string;
  prompt: string;
  toolMetas: Array<{ toolName: string; meta?: string }>;
  success: boolean;
  aborted: boolean;
  durationMs: number;
  tokenUsage: number;
  fsmState: string;
  contextDepth: 0 | 1 | 2 | 3;
  activeGoals: string[];
  fitness: number;
  genotypeId?: string;
};

/**
 * Record a structured episode from a completed agent run.
 * Inserts the episode, extracts entities, and wires up knowledge graph relations.
 */
export async function recordEpisode(params: RecordEpisodeParams): Promise<void> {
  const {
    store,
    graph,
    embeddingProvider,
    sessionId,
    prompt,
    toolMetas,
    success,
    aborted,
    durationMs,
    tokenUsage,
    fsmState,
    contextDepth,
    activeGoals,
    fitness,
    genotypeId,
    config,
  } = params;

  // Skip recording if fitness is very low
  if (fitness < 0.1) {
    log.debug("Skipping episode recording: fitness below threshold");
    return;
  }

  // Build episode summary from prompt + tool sequence
  const toolSequence = toolMetas.map((t) => t.toolName).join(" → ");
  const promptPreview = prompt.slice(0, 500) + (prompt.length > 500 ? "..." : "");
  const summary = toolSequence ? `${promptPreview}\n\nTools: ${toolSequence}` : promptPreview;

  // Embed the summary
  let embedding: number[] = [];
  try {
    embedding = await embeddingProvider.embedQuery(summary.slice(0, 2000));
  } catch (err) {
    log.debug(
      `Episode embedding failed (non-fatal): ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const toolsUsed = [...new Set(toolMetas.map((t) => t.toolName))];
  const outcome = aborted ? "partial" : success ? "success" : "failure";
  const episodeId = generateEpisodeId();

  // Insert episode
  store.insertEpisode({
    id: episodeId,
    sessionId,
    summary,
    embedding,
    fsmState,
    contextDepth,
    goals: activeGoals,
    toolsUsed,
    outcome,
    fitness,
    durationMs,
    tokenUsage,
    createdAt: Date.now(),
    genotypeId,
  });

  // Extract entities from prompt and tool names
  const entities = graph.extractEntitiesFromText(prompt);

  // Also upsert tool entities
  for (const tool of toolsUsed) {
    entities.push({ name: tool, entityType: "tool" });
  }

  // Deduplicate and upsert all entities
  const seen = new Set<string>();
  for (const ent of entities) {
    const key = `${ent.entityType}:${ent.name}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    graph.upsertEntity(ent.name, ent.entityType);
  }

  // Create relations between entities found in the same episode
  const fileEntities = entities.filter((e) => e.entityType === "file");
  const toolEntities = entities.filter((e) => e.entityType === "tool");

  // Tool→file relations: tools that were used alongside referenced files
  for (const tool of toolEntities) {
    for (const file of fileEntities) {
      graph.addRelation(tool.name, file.name, "uses", 0.6, episodeId);
    }
  }

  // Tool→tool co-occurrence: sequential tool usage
  for (let i = 0; i < toolsUsed.length - 1; i++) {
    graph.addRelation(toolsUsed[i], toolsUsed[i + 1], "followed_by", 0.4, episodeId);
  }

  // Periodic pruning (~1% chance per recording)
  if (Math.random() < 0.01) {
    try {
      const prunedEpisodes = store.pruneExpired(config.episodeTtlDays);
      const prunedOrphans = graph.pruneOrphans();
      if (prunedEpisodes > 0 || prunedOrphans > 0) {
        log.debug(`Pruned ${prunedEpisodes} expired episodes, ${prunedOrphans} orphan entities`);
      }
    } catch {
      // Non-fatal
    }
  }

  log.debug(
    `Recorded episode ${episodeId} (${outcome}, fitness=${fitness.toFixed(3)}, tools=${toolsUsed.length})`,
  );
}
