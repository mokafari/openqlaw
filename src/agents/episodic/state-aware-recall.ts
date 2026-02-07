/**
 * State-Aware Recall
 *
 * The key differentiator: retrieval that understands the agent's current state.
 * Memory recall filtered/ranked by FSM state, BSP depth, active goals,
 * and graph-expanded context.
 */

import type { EmbeddingProvider } from "../../memory/embeddings.js";
import type { EpisodeStore } from "./episode-store.js";
import type { KnowledgeGraph } from "./knowledge-graph.js";
import type { Episode, EpisodicRecallResult } from "./types.js";
import { log } from "./logger.js";

export type RecallParams = {
  store: EpisodeStore;
  graph: KnowledgeGraph;
  embeddingProvider: EmbeddingProvider;
  query: string;
  fsmState?: string;
  activeGoals?: string[];
  contextDepth?: 0 | 1 | 2 | 3;
  limit?: number;
};

/**
 * State-aware episodic recall pipeline:
 * 1. Vector search for semantic candidates
 * 2. Keyword search for exact-match candidates
 * 3. State boosting (FSM match)
 * 4. Goal overlap boosting
 * 5. Context depth matching
 * 6. Graph expansion for related episodes
 * 7. Re-rank with weighted combination
 */
export async function recallEpisodic(params: RecallParams): Promise<EpisodicRecallResult[]> {
  const {
    store,
    graph,
    embeddingProvider,
    query,
    fsmState,
    activeGoals = [],
    contextDepth,
    limit = 10,
  } = params;

  // 1. Embed query for vector search
  let queryEmbedding: number[] = [];
  try {
    queryEmbedding = await embeddingProvider.embedQuery(query.slice(0, 2000));
  } catch (err) {
    log.debug(`Recall embedding failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  // 2. Vector search — top candidates
  const vectorCandidates =
    queryEmbedding.length > 0 ? store.searchByVector(queryEmbedding, limit * 3) : [];

  // 3. Keyword search — additional candidates
  const keywordCandidates = store.searchByKeyword(query, limit * 2);

  // Merge candidates by episode ID
  const candidateMap = new Map<string, ScoredEpisode>();

  for (const ep of vectorCandidates) {
    candidateMap.set(ep.id, {
      episode: ep,
      vectorScore: ep.similarity,
      textScore: 0,
      stateBoost: 0,
      goalBoost: 0,
      depthBoost: 0,
      recencyBoost: 0,
      graphBoost: 0,
    });
  }

  for (const ep of keywordCandidates) {
    const existing = candidateMap.get(ep.id);
    if (existing) {
      existing.textScore = ep.textScore;
    } else {
      candidateMap.set(ep.id, {
        episode: ep,
        vectorScore: 0,
        textScore: ep.textScore,
        stateBoost: 0,
        goalBoost: 0,
        depthBoost: 0,
        recencyBoost: 0,
        graphBoost: 0,
      });
    }
  }

  if (candidateMap.size === 0) {
    // Fallback: return most recent episodes
    const recent = store.getRecentEpisodes(limit);
    return recent.map((ep) => ({
      episode: ep,
      relevance: 0.1,
      rationale: "Recent episode (no semantic match)",
    }));
  }

  // 4. Apply state, goal, depth, recency, and graph boosts
  const now = Date.now();
  const maxAge = 180 * 24 * 60 * 60 * 1000; // 180 days

  for (const scored of candidateMap.values()) {
    const ep = scored.episode;

    // State match boost
    if (fsmState && ep.fsmState === fsmState) {
      scored.stateBoost = 1.0;
    }

    // Goal overlap boost
    if (activeGoals.length > 0 && ep.goals.length > 0) {
      const goalSet = new Set(activeGoals.map((g) => g.toLowerCase()));
      const overlap = ep.goals.filter((g) => goalSet.has(g.toLowerCase())).length;
      scored.goalBoost = overlap / Math.max(activeGoals.length, 1);
    }

    // Context depth match boost
    if (contextDepth !== undefined && ep.contextDepth === contextDepth) {
      scored.depthBoost = 1.0;
    } else if (contextDepth !== undefined) {
      // Partial credit for nearby depth levels
      scored.depthBoost = 1.0 - Math.abs(contextDepth - ep.contextDepth) * 0.33;
      scored.depthBoost = Math.max(0, scored.depthBoost);
    }

    // Recency boost (exponential decay)
    const age = now - ep.createdAt;
    scored.recencyBoost = Math.max(0, 1.0 - age / maxAge);

    // Graph expansion boost: check if entities from the query appear in the episode's graph neighborhood
    const queryEntities = graph.extractEntitiesFromText(query);
    let graphScore = 0;
    for (const qEntity of queryEntities) {
      const existing = graph.getEntity(qEntity.name);
      if (!existing) {
        continue;
      }
      // Check if this entity is connected to any entity in the episode
      for (const tool of ep.toolsUsed) {
        const relations = graph.getRelationsBetween(qEntity.name, tool);
        if (relations.length > 0) {
          graphScore += relations.reduce((sum, r) => sum + r.weight, 0);
        }
      }
    }
    scored.graphBoost = Math.min(1.0, graphScore);
  }

  // 5. Re-rank with weighted combination
  const results: EpisodicRecallResult[] = [];

  for (const scored of candidateMap.values()) {
    const relevance =
      0.35 * scored.vectorScore +
      0.15 * scored.textScore +
      0.15 * scored.stateBoost +
      0.15 * scored.goalBoost +
      0.05 * scored.depthBoost +
      0.1 * scored.recencyBoost +
      0.05 * scored.graphBoost;

    const rationale = buildRationale(scored);

    results.push({
      episode: scored.episode,
      relevance,
      rationale,
    });
  }

  // Sort by relevance descending
  results.sort((a, b) => b.relevance - a.relevance);
  return results.slice(0, limit);
}

// --- internal types ---

type ScoredEpisode = {
  episode: Episode;
  vectorScore: number;
  textScore: number;
  stateBoost: number;
  goalBoost: number;
  depthBoost: number;
  recencyBoost: number;
  graphBoost: number;
};

function buildRationale(scored: ScoredEpisode): string {
  const parts: string[] = [];
  if (scored.vectorScore > 0.3) {
    parts.push(`semantic match (${scored.vectorScore.toFixed(2)})`);
  }
  if (scored.textScore > 0.3) {
    parts.push(`keyword match (${scored.textScore.toFixed(2)})`);
  }
  if (scored.stateBoost > 0) {
    parts.push("same FSM state");
  }
  if (scored.goalBoost > 0) {
    parts.push(`goal overlap (${(scored.goalBoost * 100).toFixed(0)}%)`);
  }
  if (scored.depthBoost > 0.5) {
    parts.push("similar context depth");
  }
  if (scored.graphBoost > 0.1) {
    parts.push(`graph connection (${scored.graphBoost.toFixed(2)})`);
  }
  return parts.length > 0 ? parts.join(", ") : "low relevance";
}
