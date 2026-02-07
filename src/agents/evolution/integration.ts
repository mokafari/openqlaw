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

/**
 * Check telemetry after agent run and trigger diagnostic state if error rates are high.
 * This should be called after logAgentRunTelemetry to enable automatic self-improvement.
 */
export async function checkTelemetryAndTriggerDiagnostic(params?: {
  statsDir?: string;
  workspaceDir?: string;
  fsmStateManager?: {
    transitionTo: (state: string, metadata?: Record<string, unknown>) => Promise<boolean>;
  };
  autoMutate?: boolean;
}): Promise<{
  triggered: boolean;
  hotspots: Array<{ toolName: string; errorRate: number }>;
  diagnosticState?: string;
}> {
  try {
    const { getGlobalTelemetryMonitor } = await import("./telemetry-monitor.js");
    const monitor = getGlobalTelemetryMonitor({
      statsDir: params?.statsDir,
      workspaceDir: params?.workspaceDir,
      autoMutate: params?.autoMutate ?? false,
    });

    // Check current telemetry state
    const result = await monitor.check();

    if (!result.shouldTriggerDiagnostic) {
      return { triggered: false, hotspots: [] };
    }

    logDebug(
      `[evolution] High tool error rate detected: ${result.hotspots.length} hotspot(s). Triggering diagnostic state.`,
    );

    // Transition to diagnostic state if FSM manager provided
    let diagnosticState: string | undefined;
    if (params?.fsmStateManager) {
      const transitioned = await params.fsmStateManager.transitionTo("diagnostic", {
        hotspots: result.hotspots,
        triggeredAt: Date.now(),
        reason: "high_tool_error_rate",
      });
      if (transitioned) {
        diagnosticState = "diagnostic";
        logDebug(`[evolution] Transitioned to diagnostic state due to high error rates`);
      }
    }

    // Optionally trigger automatic mutation cycle
    if (result.shouldTriggerMutation && params?.autoMutate) {
      logDebug(`[evolution] Auto-mutation enabled, triggering mutation cycle...`);
      monitor.triggerMutationCycle().catch((err) => {
        logDebug(`[evolution] Auto-mutation cycle failed: ${String(err)}`);
      });
    }

    return {
      triggered: true,
      hotspots: result.hotspots.map((h) => ({ toolName: h.toolName, errorRate: h.errorRate })),
      diagnosticState,
    };
  } catch (err) {
    // Don't fail agent runs if telemetry check fails
    logDebug(`[evolution] Failed to check telemetry: ${String(err)}`);
    return { triggered: false, hotspots: [] };
  }
}
