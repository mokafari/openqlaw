/**
 * Tensor Pattern Recall
 *
 * Searches the pattern store for matching action patterns and
 * calculates multi-signal confidence for System 1 bypass decisions.
 *
 * Confidence formula (3 weighted signals):
 *   - Cosine similarity (0.5) — vector distance
 *   - Historical fitness (0.3) — pattern quality
 *   - Recency (0.2) — exponential decay on last use
 */

import type { EmbeddingProvider } from "../../memory/embeddings.js";
import type { ActionPattern, PatternRecallResult, TensorConfig } from "./types.js";
import { log } from "./logger.js";
import { PatternStore } from "./pattern-store.js";

const WEIGHT_SIMILARITY = 0.5;
const WEIGHT_FITNESS = 0.3;
const WEIGHT_RECENCY = 0.2;
const RECENCY_HALF_LIFE_DAYS = 30;

/**
 * Recall the best matching pattern for a given prompt.
 */
export async function recallPattern(params: {
  store: PatternStore;
  embeddingProvider: EmbeddingProvider;
  prompt: string;
  config: TensorConfig;
}): Promise<PatternRecallResult> {
  const { store, embeddingProvider, prompt, config } = params;

  const noMatch: PatternRecallResult = {
    matched: false,
    similarity: 0,
    confidence: 0,
    shouldBypass: false,
    rationale: "No matching pattern found",
  };

  if (!config.enabled) {
    return { ...noMatch, rationale: "Tensor recall disabled" };
  }

  // Embed the incoming prompt
  let embedding: number[];
  try {
    embedding = await embeddingProvider.embedQuery(prompt.slice(0, 2000));
  } catch (err) {
    log.debug(`Recall embedding failed: ${err}`);
    return { ...noMatch, rationale: `Embedding failed: ${err}` };
  }

  // Search for top matches
  const matches = store.searchByVector(embedding, 5, config.minFitnessForRecall);
  if (matches.length === 0) {
    return noMatch;
  }

  const best = matches[0];
  const confidence = calculateConfidence(best, best.similarity);
  const shouldBypass = confidence >= config.bypassThreshold && best.usageCount >= 1; // Never bypass on first encounter

  const rationale = shouldBypass
    ? `System 1 bypass: confidence=${confidence.toFixed(3)} (sim=${best.similarity.toFixed(3)}, fitness=${best.fitness.toFixed(3)}, uses=${best.usageCount})`
    : `System 2 path: confidence=${confidence.toFixed(3)} < threshold=${config.bypassThreshold} or usageCount=${best.usageCount} < 1`;

  log.debug(rationale);

  return {
    matched: true,
    pattern: best,
    similarity: best.similarity,
    confidence,
    shouldBypass,
    rationale,
  };
}

/**
 * Calculate composite confidence from three signals.
 */
function calculateConfidence(pattern: ActionPattern, similarity: number): number {
  const daysSinceLastUse = (Date.now() - pattern.lastUsedAt) / (24 * 60 * 60 * 1000);
  const recency = Math.exp(-daysSinceLastUse / RECENCY_HALF_LIFE_DAYS);

  return (
    WEIGHT_SIMILARITY * similarity + WEIGHT_FITNESS * pattern.fitness + WEIGHT_RECENCY * recency
  );
}
