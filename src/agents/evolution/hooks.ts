import type { AgentMessage } from "@mariozechner/pi-agent-core";
import type { PluginHookAgentEndEvent, PluginHookAgentContext } from "../../plugins/types.js";
import { logDebug } from "../../logger.js";
import { loadGenotype } from "./genotype.js";
import { logSessionStats } from "./telemetry.js";

/**
 * Hook handler for agent_end that logs evolution telemetry.
 * Extracts tool call count from messages and logs stats.
 *
 * Note: This hook has limited access to run metadata. For full telemetry
 * including token usage, use the direct integration in the runner.
 */
export async function evolutionTelemetryHook(
  event: PluginHookAgentEndEvent,
  ctx: PluginHookAgentContext,
): Promise<void> {
  try {
    // Load current genotype if available
    let genotype;
    try {
      genotype = await loadGenotype();
    } catch {
      // No genotype configured yet, skip telemetry
      return;
    }

    // Extract tool call count from messages
    const messages = event.messages as AgentMessage[];
    let toolCallCount = 0;
    let lastAssistantMessage: AgentMessage | undefined;

    for (const msg of messages) {
      if (msg.role === "assistant") {
        // Count tool_use blocks in assistant content
        const content = Array.isArray(msg.content) ? msg.content : [];
        const toolUseBlocks = content.filter((b: { type?: string }) => b.type === "tool_use");
        if (toolUseBlocks.length > 0) {
          toolCallCount += toolUseBlocks.length;
        }
        lastAssistantMessage = msg;
      }
    }

    // Extract usage from last assistant message if available
    const usage = (
      lastAssistantMessage as {
        usage?: {
          input?: number;
          output?: number;
          total?: number;
          cacheRead?: number;
          cacheWrite?: number;
        };
      }
    )?.usage;

    // Log stats (limited - full telemetry should be done in runner)
    await logSessionStats({
      sessionId: ctx.sessionKey ?? "unknown",
      sessionKey: ctx.sessionKey,
      meta: {
        durationMs: event.durationMs ?? 0,
        agentMeta: usage
          ? {
              sessionId: ctx.sessionKey ?? "unknown",
              provider: "unknown",
              model: "unknown",
              usage,
            }
          : undefined,
        aborted: false,
        error: event.error ? { kind: "context_overflow", message: event.error } : undefined,
      },
      agentMeta: usage
        ? {
            sessionId: ctx.sessionKey ?? "unknown",
            provider: "unknown",
            model: "unknown",
            usage,
          }
        : undefined,
      toolCallCount,
      generation: genotype.generation,
      genotypeId: genotype.genotypeId,
    });
  } catch (err) {
    // Don't fail agent runs if telemetry fails
    logDebug(`[evolution] Failed to log telemetry: ${String(err)}`);
  }
}
