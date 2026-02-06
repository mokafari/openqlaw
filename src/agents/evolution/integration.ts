import type { EmbeddedPiRunMeta, EmbeddedPiAgentMeta } from "../pi-embedded-runner/types.js";
import type { ToolErrorInfo } from "./telemetry.js";
import { logDebug } from "../../logger.js";
import { loadGenotype, applyGenotypeToSystemPrompt } from "./genotype.js";
import { logSessionStats } from "./telemetry.js";

/**
 * Log telemetry after an agent run completes.
 * This should be called from the agent runner after collecting all run metadata.
 */
export async function logAgentRunTelemetry(params: {
  sessionId: string;
  sessionKey?: string;
  meta: EmbeddedPiRunMeta;
  agentMeta?: EmbeddedPiAgentMeta;
  toolMetas: Array<{ toolName: string; meta?: string }>;
  toolErrors?: Array<{ toolName: string; error: string; timestamp: number }>;
  statsDir?: string;
}): Promise<void> {
  try {
    // Load current genotype if available
    let genotype;
    try {
      genotype = await loadGenotype();
    } catch {
      // No genotype configured yet, skip telemetry
      return;
    }

    // Aggregate tool errors by tool name
    const toolErrors: Record<string, ToolErrorInfo> = {};
    if (params.toolErrors) {
      for (const error of params.toolErrors) {
        if (!toolErrors[error.toolName]) {
          toolErrors[error.toolName] = {
            count: 0,
            errors: [],
          };
        }
        toolErrors[error.toolName].count += 1;
        toolErrors[error.toolName].errors.push(error.error);
        toolErrors[error.toolName].lastError = error.error;
        toolErrors[error.toolName].lastErrorTimestamp = error.timestamp;
      }
    }

    await logSessionStats({
      sessionId: params.sessionId,
      sessionKey: params.sessionKey,
      meta: params.meta,
      agentMeta: params.agentMeta,
      toolCallCount: params.toolMetas.length,
      generation: genotype.generation,
      genotypeId: genotype.genotypeId,
      statsDir: params.statsDir,
      toolErrors: Object.keys(toolErrors).length > 0 ? toolErrors : undefined,
    });
  } catch (err) {
    // Don't fail agent runs if telemetry fails
    logDebug(`[evolution] Failed to log telemetry: ${String(err)}`);
  }
}

/**
 * Apply current genotype to system prompt.
 * Call this when building the system prompt to inject evolution-guided behavior.
 */
export async function applyCurrentGenotypeToPrompt(basePrompt: string): Promise<string> {
  try {
    const genotype = await loadGenotype();
    return applyGenotypeToSystemPrompt(genotype, basePrompt);
  } catch {
    // No genotype configured, return base prompt unchanged
    return basePrompt;
  }
}
