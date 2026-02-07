/**
 * Daily Learning Journal Generator
 *
 * Automatically generates daily learning journal entries from telemetry and patterns.
 */

import { promises as fs } from "node:fs";
import { join } from "node:path";
import { resolveStateDir } from "../../config/paths.js";
import { log } from "../pi-embedded-runner/logger.js";
import { MetaLearningSystem, type LearningJournalEntry } from "./meta-learning.js";
import { readSessionStats, getAggregatedStats } from "./telemetry.js";

/**
 * Generate a learning journal entry for a specific date.
 */
export async function generateDailyJournalEntry(
  date: string = new Date().toISOString().split("T")[0],
): Promise<LearningJournalEntry> {
  log.info(`[daily-journal] Generating journal entry for ${date}`);

  const metaLearning = new MetaLearningSystem();

  // 1. Read session stats for the day
  const allStats = await readSessionStats({ limit: 500 });
  const dayStats = allStats.filter((s) => {
    const statDate = new Date(s.timestamp).toISOString().split("T")[0];
    return statDate === date;
  });

  // 2. Analyze successes and failures
  const successfulSessions = dayStats.filter((s) => s.success);
  const failedSessions = dayStats.filter((s) => !s.success);

  // 3. Extract what worked
  const whatWorked: string[] = [];

  if (successfulSessions.length > 0) {
    const avgDuration =
      successfulSessions.reduce((sum, s) => sum + s.durationMs, 0) / successfulSessions.length;
    whatWorked.push(
      `Completed ${successfulSessions.length} tasks successfully (avg ${Math.round(avgDuration / 1000)}s)`,
    );
  }

  // Find tools with 100% success rate
  const toolSuccessMap = new Map<string, { success: number; total: number }>();
  for (const stat of dayStats) {
    if (stat.toolErrors) {
      for (const [tool, info] of Object.entries(stat.toolErrors)) {
        const current = toolSuccessMap.get(tool) ?? { success: 0, total: 0 };
        current.total += info.count;
        toolSuccessMap.set(tool, current);
      }
    }
  }

  const reliableTools = Array.from(toolSuccessMap.entries())
    .filter(([, stats]) => stats.total > 0 && stats.success === stats.total)
    .map(([tool]) => tool);

  if (reliableTools.length > 0) {
    whatWorked.push(`Reliable tool usage: ${reliableTools.slice(0, 5).join(", ")}`);
  }

  // Check for efficient sessions (low token usage, high success)
  const efficientSessions = successfulSessions.filter(
    (s) => s.tokenUsage.total < 5000 && s.durationMs < 30000,
  );
  if (efficientSessions.length > 0) {
    whatWorked.push(`${efficientSessions.length} efficient completions (< 5k tokens, < 30s)`);
  }

  // 4. Extract what failed
  const whatFailed: string[] = [];

  if (failedSessions.length > 0) {
    whatFailed.push(
      `${failedSessions.length} task${failedSessions.length > 1 ? "s" : ""} failed or aborted`,
    );

    // Collect unique error patterns
    const errorPatterns = new Map<string, number>();
    for (const session of failedSessions) {
      if (session.error) {
        const pattern = extractErrorPattern(session.error);
        errorPatterns.set(pattern, (errorPatterns.get(pattern) ?? 0) + 1);
      }
    }

    for (const [pattern, count] of Array.from(errorPatterns.entries()).slice(0, 3)) {
      whatFailed.push(`${pattern} (${count}x)`);
    }
  }

  // Find problematic tools
  const problematicTools = Array.from(toolSuccessMap.entries())
    .filter(([, stats]) => stats.total > 2 && stats.success < stats.total * 0.5)
    .map(([tool]) => tool);

  if (problematicTools.length > 0) {
    whatFailed.push(`Tool issues: ${problematicTools.slice(0, 3).join(", ")}`);
  }

  // 5. Detect patterns
  const patterns: string[] = [];

  // Time-based patterns
  const hourDistribution = new Map<number, number>();
  for (const stat of dayStats) {
    const hour = new Date(stat.timestamp).getHours();
    hourDistribution.set(hour, (hourDistribution.get(hour) ?? 0) + 1);
  }

  const peakHour = Array.from(hourDistribution.entries()).sort(([, a], [, b]) => b - a)[0];
  if (peakHour) {
    patterns.push(`Peak activity at ${peakHour[0]}:00 (${peakHour[1]} sessions)`);
  }

  // Token usage patterns
  const avgTokens =
    dayStats.reduce((sum, s) => sum + s.tokenUsage.total, 0) / (dayStats.length || 1);
  if (avgTokens > 10000) {
    patterns.push(`High token usage day (avg ${Math.round(avgTokens)} tokens/session)`);
  } else if (avgTokens < 3000 && dayStats.length > 5) {
    patterns.push(`Efficient token day (avg ${Math.round(avgTokens)} tokens/session)`);
  }

  // Success rate pattern
  const successRate = dayStats.length > 0 ? successfulSessions.length / dayStats.length : 0;
  if (successRate >= 0.9 && dayStats.length >= 5) {
    patterns.push(`High success rate: ${Math.round(successRate * 100)}%`);
  } else if (successRate < 0.7 && dayStats.length >= 5) {
    patterns.push(`Low success rate: ${Math.round(successRate * 100)}% - investigate failures`);
  }

  // 6. Generate insights
  const insights: string[] = [];

  // Compare to historical
  const historicalPatterns = await metaLearning.analyzePatterns();

  if (historicalPatterns.recurringFailures.length > 0) {
    const todayFailures = whatFailed.filter((f) =>
      historicalPatterns.recurringFailures.some((rf) => f.includes(rf) || rf.includes(f)),
    );
    if (todayFailures.length > 0) {
      insights.push(`Recurring failure pattern detected: ${todayFailures[0]}`);
    }
  }

  if (historicalPatterns.successfulStrategies.length > 0 && whatWorked.length > 0) {
    insights.push(
      `Continuing successful patterns: ${historicalPatterns.successfulStrategies.slice(0, 2).join(", ")}`,
    );
  }

  // Session-specific insights
  if (dayStats.length > 20) {
    insights.push(`Busy day with ${dayStats.length} sessions - consider batching similar tasks`);
  }

  if (failedSessions.length > successfulSessions.length && dayStats.length >= 5) {
    insights.push(`More failures than successes - might need intervention or config review`);
  }

  // 7. Strategy changes
  const strategyChanges: string[] = [];

  if (successRate < 0.7 && dayStats.length >= 5) {
    strategyChanges.push("Consider reducing task complexity or improving error handling");
  }

  if (avgTokens > 15000) {
    strategyChanges.push("Optimize prompts to reduce token usage");
  }

  if (problematicTools.length > 0) {
    strategyChanges.push(`Review usage patterns for: ${problematicTools.join(", ")}`);
  }

  // 8. Create and save the entry
  const entry: LearningJournalEntry = {
    date,
    whatWorked: whatWorked.length > 0 ? whatWorked : ["No notable successes recorded"],
    whatFailed: whatFailed.length > 0 ? whatFailed : ["No failures recorded"],
    patterns: patterns.length > 0 ? patterns : ["Insufficient data for pattern detection"],
    insights: insights.length > 0 ? insights : ["Continue monitoring for emerging patterns"],
    strategyChanges: strategyChanges.length > 0 ? strategyChanges : ["Maintain current approach"],
  };

  await metaLearning.addJournalEntry(entry);

  log.info(
    `[daily-journal] Generated journal entry for ${date} with ${whatWorked.length} successes, ${whatFailed.length} failures`,
  );

  return entry;
}

/**
 * Extract a simplified error pattern from an error message.
 */
function extractErrorPattern(error: string): string {
  // Remove specific details like paths, IDs, numbers
  let pattern = error
    .replace(/\/[\w\/\-\.]+/g, "[PATH]")
    .replace(/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/gi, "[UUID]")
    .replace(/\d+/g, "[N]")
    .slice(0, 100);

  // Common error types
  if (pattern.includes("timeout")) return "Timeout error";
  if (pattern.includes("ENOENT")) return "File not found";
  if (pattern.includes("EACCES")) return "Permission denied";
  if (pattern.includes("context_overflow")) return "Context overflow";
  if (pattern.includes("rate_limit")) return "Rate limit";
  if (pattern.includes("network") || pattern.includes("ECONNREFUSED")) return "Network error";

  return pattern.slice(0, 50) + (pattern.length > 50 ? "..." : "");
}

/**
 * Run daily journal generation (meant to be called from cron).
 */
export async function runDailyJournalCron(): Promise<void> {
  log.info("[daily-journal] Starting daily journal generation...");

  try {
    // Generate for yesterday (end-of-day summary)
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const dateStr = yesterday.toISOString().split("T")[0];

    await generateDailyJournalEntry(dateStr);

    log.info("[daily-journal] Daily journal generation completed");
  } catch (err) {
    log.error(
      `[daily-journal] Generation failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    throw err;
  }
}
