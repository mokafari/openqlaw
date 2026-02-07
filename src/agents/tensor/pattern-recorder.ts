/**
 * Tensor Pattern Recorder
 *
 * Records action patterns after successful agent runs.
 * Extracts context, action sequence, outcome, and fitness
 * from the run result and persists to the PatternStore.
 */

import type { EmbeddingProvider } from "../../memory/embeddings.js";
import type { SessionStats } from "../evolution/telemetry.js";
import type { ActionPattern, SerializedToolCall, TensorConfig } from "./types.js";
import { calculateFitness } from "../evolution/telemetry.js";
import { log } from "./logger.js";
import { PatternStore, generatePatternId } from "./pattern-store.js";

export type RecordPatternParams = {
  prompt: string;
  toolMetas: Array<{ toolName: string; meta?: string }>;
  success: boolean;
  durationMs: number;
  tokenUsage: { input: number; output: number; total: number };
  toolCallCount: number;
  fsmState?: string;
  genotypeId?: string;
};

/**
 * Record an action pattern from a completed agent run.
 *
 * Only records patterns for successful runs where at least one tool was called.
 */
export async function recordPattern(params: {
  store: PatternStore;
  embeddingProvider: EmbeddingProvider;
  runParams: RecordPatternParams;
  config: TensorConfig;
}): Promise<ActionPattern | null> {
  const { store, embeddingProvider, runParams, config } = params;

  if (!config.enabled) {
    return null;
  }

  // Only record successful runs with tool calls
  if (!runParams.success || runParams.toolMetas.length === 0) {
    log.debug("Skipping pattern recording: not successful or no tool calls");
    return null;
  }

  // Build context text (the input prompt, truncated to keep embeddings meaningful)
  const contextText = runParams.prompt.slice(0, 2000);

  // Embed the context
  let contextEmbedding: number[];
  try {
    contextEmbedding = await embeddingProvider.embedQuery(contextText);
  } catch (err) {
    log.debug(`Pattern embedding failed: ${err}`);
    return null;
  }

  // Build serialised tool calls
  const actionToolCalls: SerializedToolCall[] = runParams.toolMetas.map((tm) => ({
    name: tm.toolName,
    params: tm.meta ? tryParseJson(tm.meta) : {},
  }));

  // Build action summary from tool sequence
  const toolNames = [...new Set(runParams.toolMetas.map((t) => t.toolName))];
  const actionSummary = `Used ${toolNames.join(", ")} (${runParams.toolMetas.length} calls)`;

  // Calculate fitness using existing telemetry formula
  const sessionStats: SessionStats = {
    sessionId: generatePatternId(),
    timestamp: Date.now(),
    success: runParams.success,
    aborted: false,
    tokenUsage: runParams.tokenUsage,
    toolCalls: runParams.toolCallCount,
    durationMs: runParams.durationMs,
    model: "unknown",
    provider: "unknown",
  };
  const fitness = calculateFitness(sessionStats);

  // Skip low-fitness patterns
  if (fitness < config.minFitnessForRecall) {
    log.debug(
      `Skipping pattern: fitness ${fitness.toFixed(3)} below threshold ${config.minFitnessForRecall}`,
    );
    return null;
  }

  const now = Date.now();
  const pattern: ActionPattern = {
    id: generatePatternId(),
    contextEmbedding,
    contextText,
    actionSummary,
    actionToolCalls,
    outcome: {
      success: runParams.success,
      durationMs: runParams.durationMs,
      tokensSaved: runParams.tokenUsage.total,
    },
    fitness,
    usageCount: 0,
    lastUsedAt: now,
    createdAt: now,
    fsmState: runParams.fsmState,
    genotypeId: runParams.genotypeId,
  };

  store.insertPattern(pattern);
  log.debug(
    `Recorded pattern ${pattern.id} (fitness=${fitness.toFixed(3)}, tools=${toolNames.join(",")})`,
  );

  return pattern;
}

function tryParseJson(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value);
    if (typeof parsed === "object" && parsed !== null) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // Not JSON, wrap in description
  }
  return { description: value };
}
