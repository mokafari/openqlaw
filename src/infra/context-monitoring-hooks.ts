/**
 * Context Monitoring Hooks — Phase 2 Monitoring Infrastructure
 *
 * Wires context monitoring into the session lifecycle:
 * - onContextThreshold — Trigger summarization when thresholds exceeded
 * - onSummarizationComplete — Verify token savings
 * - onSessionEnd — Log context efficiency metrics
 *
 * Created: 2026-02-08
 */

import {
  registerInternalHook,
  createInternalHookEvent,
  type InternalHookEvent,
} from "../hooks/internal-hooks.js";
import { createSubsystemLogger } from "../logging/subsystem.js";
import {
  getContextMonitor,
  type ContextAlert,
  type ContextEfficiencyReport,
  CONTEXT_THRESHOLD_WARNING,
} from "./context-monitor.js";
import {
  summarizeContext,
  estimateMessagesTokens,
  type MessageLike,
  type SummarizationStrategy,
} from "./context-summarization.js";

// ────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────

export interface ContextHookConfig {
  enabled: boolean;
  autoSummarize: boolean;
  strategy: SummarizationStrategy;
  threshold: number;
  preserveRecentMessages: number;
}

// ────────────────────────────────────────────────────────────────
// State
// ────────────────────────────────────────────────────────────────

const logger = createSubsystemLogger("context-hooks");

let hookConfig: ContextHookConfig = {
  enabled: true,
  autoSummarize: true,
  strategy: "hybrid",
  threshold: CONTEXT_THRESHOLD_WARNING,
  preserveRecentMessages: 20,
};

let hooksRegistered = false;

// ────────────────────────────────────────────────────────────────
// Hook Handlers
// ────────────────────────────────────────────────────────────────

/**
 * Handle context threshold events
 * Triggered when a session exceeds the token threshold
 */
async function handleContextThreshold(alert: ContextAlert): Promise<void> {
  if (!hookConfig.enabled) return;

  logger.info(
    `Context threshold exceeded: ${alert.sessionKey} at ${alert.tokenCount} tokens ` +
      `(${alert.severity})`,
  );

  // Log the alert for pattern analysis
  const monitor = getContextMonitor();
  const pattern = monitor.getSessionPattern(alert.sessionKey);

  if (pattern) {
    logger.debug(
      `Session pattern: alertCount=${pattern.alertCount}, ` +
        `summarizationCount=${pattern.summarizationCount}`,
    );
  }

  // If auto-summarization is enabled and this is a warning-level alert,
  // we just log and let the caller handle summarization
  // (actual summarization requires access to messages which we don't have here)

  // Emit event for external handlers
  const event = createInternalHookEvent("session", "contextThreshold", alert.sessionKey, {
    alert,
    suggestedAction: alert.suggestedAction,
    pattern,
  });

  // The event can be consumed by other hooks
  event.messages.push(
    `⚠️ Context threshold (${alert.severity}): ${alert.tokenCount.toLocaleString()} tokens`,
  );
}

/**
 * Handle summarization completion
 * Verifies token savings and logs efficiency metrics
 */
async function handleSummarizationComplete(report: ContextEfficiencyReport): Promise<void> {
  if (!hookConfig.enabled) return;

  const savingsPercent = ((report.tokensSaved / report.startTokens) * 100).toFixed(1);

  logger.info(
    `Summarization complete for ${report.sessionKey}: ` +
      `saved ${report.tokensSaved.toLocaleString()} tokens (${savingsPercent}%)`,
  );

  // Check if savings are significant
  if (report.compressionRatio > 0.8) {
    logger.warn(
      `Low compression efficiency (${(report.compressionRatio * 100).toFixed(1)}%). ` +
        `Consider adjusting summarization strategy.`,
    );
  }

  // Log performance
  if (report.summarizationDuration > 5000) {
    logger.warn(`Summarization took ${report.summarizationDuration}ms - consider optimization`);
  }
}

/**
 * Handle session end events
 * Logs context efficiency metrics for analysis
 */
async function handleSessionEnd(event: InternalHookEvent): Promise<void> {
  if (!hookConfig.enabled) return;

  const monitor = getContextMonitor();
  const metrics = monitor.getSessionMetrics(event.sessionKey);
  const pattern = monitor.getSessionPattern(event.sessionKey);

  if (!pattern || metrics.length === 0) {
    return;
  }

  // Calculate session efficiency
  const finalMetrics = metrics[metrics.length - 1];
  const efficiency = {
    peakTokens: pattern.peakTokenCount,
    avgTokens: pattern.avgTokenCount,
    alertCount: pattern.alertCount,
    summarizationCount: pattern.summarizationCount,
    messageCount: metrics.length,
  };

  logger.info(
    `Session ${event.sessionKey} ended: ` +
      `peak=${efficiency.peakTokens.toLocaleString()} tokens, ` +
      `alerts=${efficiency.alertCount}, ` +
      `summarizations=${efficiency.summarizationCount}`,
  );

  // Record final metrics
  monitor.recordSessionEnd(event.sessionKey, finalMetrics?.tokenCount ?? 0);

  // Clear session data to free memory
  monitor.clearSession(event.sessionKey);
}

/**
 * Handle session message events
 * Updates token count and checks thresholds
 */
async function handleSessionMessage(event: InternalHookEvent): Promise<void> {
  if (!hookConfig.enabled) return;

  const context = event.context as {
    messages?: MessageLike[];
    messageCount?: number;
  };

  if (!context.messages && !context.messageCount) {
    return;
  }

  const monitor = getContextMonitor();

  // Estimate token count
  let tokenCount = 0;
  if (context.messages) {
    tokenCount = estimateMessagesTokens(context.messages);
  }

  // Record metrics
  monitor.recordMetrics({
    sessionKey: event.sessionKey,
    tokenCount,
    messageCount: context.messageCount ?? context.messages?.length ?? 0,
  });
}

// ────────────────────────────────────────────────────────────────
// Public API
// ────────────────────────────────────────────────────────────────

/**
 * Register all context monitoring hooks
 */
export function registerContextMonitoringHooks(config?: Partial<ContextHookConfig>): void {
  if (hooksRegistered) {
    logger.debug("Context monitoring hooks already registered");
    return;
  }

  // Apply config
  if (config) {
    hookConfig = { ...hookConfig, ...config };
  }

  const monitor = getContextMonitor();

  // Register event listeners on the context monitor
  monitor.on("threshold", handleContextThreshold);
  monitor.on("summarizationComplete", handleSummarizationComplete);

  // Register internal hooks
  registerInternalHook("session:end", handleSessionEnd);
  registerInternalHook("session:reset", handleSessionEnd);
  registerInternalHook("session:message", handleSessionMessage);

  hooksRegistered = true;
  logger.info("Context monitoring hooks registered");
}

/**
 * Update hook configuration
 */
export function updateContextHookConfig(config: Partial<ContextHookConfig>): void {
  hookConfig = { ...hookConfig, ...config };
  logger.debug(`Context hook config updated: ${JSON.stringify(hookConfig)}`);
}

/**
 * Get current hook configuration
 */
export function getContextHookConfig(): ContextHookConfig {
  return { ...hookConfig };
}

/**
 * Check if hooks are registered
 */
export function isContextMonitoringActive(): boolean {
  return hooksRegistered && hookConfig.enabled;
}

/**
 * Manually trigger summarization for a session
 * (Used when auto-summarization needs to be applied externally)
 */
export function triggerSessionSummarization(
  sessionKey: string,
  messages: MessageLike[],
): MessageLike[] {
  if (!hookConfig.enabled) {
    return messages;
  }

  const result = summarizeContext(messages, hookConfig.strategy, {
    preserveRecentCount: hookConfig.preserveRecentMessages,
  });

  logger.info(
    `Manual summarization for ${sessionKey}: ` +
      `${result.originalTokens} → ${result.resultTokens} tokens`,
  );

  return result.messages;
}

// ────────────────────────────────────────────────────────────────
// Weekly Report Cron Handler
// ────────────────────────────────────────────────────────────────

/**
 * Generate and log weekly context efficiency report
 * Called by cron job
 */
export async function generateWeeklyContextReport(): Promise<string> {
  const monitor = getContextMonitor();
  const report = await monitor.generateWeeklyReport();

  const reportText = `
📊 **Weekly Context Efficiency Report**
Period: ${report.weekStart} to ${report.weekEnd}

**Sessions:**
- Total sessions: ${report.totalSessions}
- Sessions exceeding 80k tokens: ${report.sessionsExceeding80k} (${
    report.totalSessions > 0
      ? ((report.sessionsExceeding80k / report.totalSessions) * 100).toFixed(1)
      : 0
  }%)

**Token Usage:**
- Average tokens per session: ${report.avgTokensPerSession.toLocaleString()}
- Peak tokens: ${report.peakTokens.toLocaleString()}

**Summarization:**
- Total summarizations: ${report.totalSummarizations}
- Average compression ratio: ${(report.avgCompressionRatio * 100).toFixed(1)}%

**Recommendations:**
${report.recommendations.map((r) => `• ${r}`).join("\n")}
`;

  logger.info("Weekly context report generated");
  return reportText.trim();
}
