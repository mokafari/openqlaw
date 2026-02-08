import type { EmbeddedPiRunMeta, EmbeddedPiAgentMeta } from "../pi-embedded-runner/types.js";
import { logSessionStats } from "../evolution/telemetry.js";
import {
  recordSessionOutcome,
  getSessionPromptInfo,
  storeSessionPromptInfo,
  extractSessionErrors,
  type SessionPromptInfo,
} from "./session-attribution.js";

/**
 * Hook to be called when a session starts (after system prompt is built).
 * Stores the prompt info for later retrieval when session completes.
 */
export async function onSessionStart(params: {
  sessionId: string;
  sessionKey?: string;
  promptInfo: SessionPromptInfo;
}): Promise<void> {
  try {
    await storeSessionPromptInfo(params.sessionId, params.promptInfo);
  } catch (err) {
    console.warn(`Failed to store session prompt info for ${params.sessionId}:`, err);
  }
}

/**
 * Hook to be called when a session completes (success or failure).
 * Records metrics for prompt tuning analysis.
 */
export async function onSessionComplete(params: {
  sessionId: string;
  sessionKey?: string;
  meta: EmbeddedPiRunMeta;
  agentMeta?: EmbeddedPiAgentMeta;
  toolCallCount: number;
  agentOutput?: string;
  toolErrors?: Array<{ tool: string; error: string }>;
  systemErrors?: string[];
  userSatisfaction?: number;
  generation?: number;
  genotypeId?: string;
}): Promise<void> {
  try {
    // First, log to the existing telemetry system
    await logSessionStats({
      sessionId: params.sessionId,
      sessionKey: params.sessionKey,
      meta: params.meta,
      agentMeta: params.agentMeta,
      toolCallCount: params.toolCallCount,
      userSatisfaction: params.userSatisfaction,
      generation: params.generation,
      genotypeId: params.genotypeId,
    });

    // Then, record for prompt-specific metrics
    const promptInfo = await getSessionPromptInfo(params.sessionId);
    if (!promptInfo) {
      console.warn(`No prompt info found for session ${params.sessionId}, skipping prompt metrics`);
      return;
    }

    const success = !params.meta.aborted && !params.meta.error;
    const usage = params.agentMeta?.usage || { input: 0, output: 0, total: 0 };

    // Extract errors from various sources
    const errors = extractSessionErrors({
      agentOutput: params.agentOutput,
      toolErrors: params.toolErrors,
      systemErrors: params.systemErrors,
    });

    // Add error from meta if present
    if (params.meta.error) {
      errors.push(params.meta.error.message || String(params.meta.error));
    }

    await recordSessionOutcome({
      sessionId: params.sessionId,
      sessionKey: params.sessionKey,
      promptInfo,
      success,
      tokenUsage: {
        input: usage.input || 0,
        output: usage.output || 0,
        total: usage.total || (usage.input || 0) + (usage.output || 0),
      },
      durationMs: params.meta.durationMs,
      errors,
      toolCalls: params.toolCallCount,
      model: params.agentMeta?.model || "unknown",
      provider: params.agentMeta?.provider || "unknown",
    });
  } catch (err) {
    console.warn(`Failed to record session completion for ${params.sessionId}:`, err);
  }
}

/**
 * Hook to be called when a session is aborted or fails.
 */
export async function onSessionAbort(params: {
  sessionId: string;
  sessionKey?: string;
  error: string | Error;
  partialMeta?: Partial<EmbeddedPiRunMeta>;
  partialAgentMeta?: Partial<EmbeddedPiAgentMeta>;
  toolCallCount?: number;
}): Promise<void> {
  try {
    const promptInfo = await getSessionPromptInfo(params.sessionId);
    if (!promptInfo) {
      return; // No prompt info available
    }

    const errorMessage = typeof params.error === "string" ? params.error : params.error.message;
    const usage = params.partialAgentMeta?.usage || { input: 0, output: 0, total: 0 };

    await recordSessionOutcome({
      sessionId: params.sessionId,
      sessionKey: params.sessionKey,
      promptInfo,
      success: false,
      tokenUsage: {
        input: usage.input || 0,
        output: usage.output || 0,
        total: usage.total || (usage.input || 0) + (usage.output || 0),
      },
      durationMs: params.partialMeta?.durationMs || 0,
      errors: [errorMessage],
      toolCalls: params.toolCallCount || 0,
      model: params.partialAgentMeta?.model || "unknown",
      provider: params.partialAgentMeta?.provider || "unknown",
    });
  } catch (err) {
    console.warn(`Failed to record session abort for ${params.sessionId}:`, err);
  }
}

/**
 * Hook to be called when user provides feedback on a session.
 */
export async function onUserFeedback(params: {
  sessionId: string;
  rating: number; // 1-5 or 0-1 scale
  feedback?: string;
}): Promise<void> {
  try {
    // For now, just log the feedback
    // This could be enhanced to update existing session records
    console.log(
      `User feedback for session ${params.sessionId}: ${params.rating}/5 - ${params.feedback || "No comment"}`,
    );

    // TODO: Could update session metrics or trigger re-evaluation
  } catch (err) {
    console.warn(`Failed to record user feedback for ${params.sessionId}:`, err);
  }
}

/**
 * Integration hook for existing agent runner code.
 * This should be called from the agent runner when a session completes.
 */
export async function integrateWithAgentRunner(params: {
  sessionId: string;
  sessionKey?: string;
  meta: EmbeddedPiRunMeta;
  agentMeta?: EmbeddedPiAgentMeta;
  toolCallCount: number;
  // Additional context that might be available
  commandBody?: string;
  response?: string;
  errors?: string[];
}): Promise<void> {
  // Extract errors from response text if available
  const extractedErrors = params.response
    ? extractSessionErrors({ agentOutput: params.response })
    : [];

  const allErrors = [...(params.errors || []), ...extractedErrors];

  await onSessionComplete({
    sessionId: params.sessionId,
    sessionKey: params.sessionKey,
    meta: params.meta,
    agentMeta: params.agentMeta,
    toolCallCount: params.toolCallCount,
    agentOutput: params.response,
    systemErrors: allErrors,
  });
}

/**
 * Helper to create session hooks object for dependency injection.
 */
export function createSessionHooks() {
  return {
    onStart: onSessionStart,
    onComplete: onSessionComplete,
    onAbort: onSessionAbort,
    onUserFeedback: onUserFeedback,
    integrate: integrateWithAgentRunner,
  };
}

/**
 * Global session hooks registry.
 * Allows modules to register hooks without circular dependencies.
 */
const sessionHooks = createSessionHooks();

export { sessionHooks };
export default sessionHooks;
