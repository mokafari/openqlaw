import { promises as fs } from "fs";
import path from "path";
import type { EmbeddedPiRunMeta, EmbeddedPiAgentMeta } from "../pi-embedded-runner/types.js";
import { resolveStateDir } from "../../config/paths.js";

export type ToolErrorInfo = {
  count: number;
  errors: string[];
  lastError?: string;
  lastErrorTimestamp?: number;
};

export type RunStats = {
  sessionId: string;
  timestamp: number;
  success: boolean;
  error?: string;
  durationMs: number;
  tokenUsage: { input: number; output: number; total: number };
  toolCalls: number;
  genotypeId?: string;
};

export type SessionStats = {
  sessionId: string;
  sessionKey?: string;
  timestamp: number;
  success: boolean;
  aborted: boolean;
  error?: string;
  tokenUsage: {
    input: number;
    output: number;
    total: number;
    cacheRead?: number;
    cacheWrite?: number;
  };
  toolCalls: number;
  durationMs: number;
  model: string;
  provider: string;
  userSatisfaction?: number; // 0.0 - 1.0, from feedback or sentiment
  fitness?: number; // Calculated fitness score
  toolErrors?: Record<string, ToolErrorInfo>; // Per-tool error tracking
};

export type SessionStatsEntry = SessionStats & {
  generation?: number;
  genotypeId?: string;
};

/**
 * Log session statistics to a JSONL file for evolution analysis.
 */
export async function logSessionStats(params: {
  sessionId: string;
  sessionKey?: string;
  meta: EmbeddedPiRunMeta;
  agentMeta?: EmbeddedPiAgentMeta;
  toolCallCount: number;
  userSatisfaction?: number;
  generation?: number;
  genotypeId?: string;
  statsDir?: string;
  toolErrors?: Record<string, ToolErrorInfo>; // Per-tool error tracking
}): Promise<void> {
  const statsDir = params.statsDir ?? path.join(resolveStateDir(), "evolution", "stats");
  await fs.mkdir(statsDir, { recursive: true });

  const statsFile = path.join(statsDir, "session_stats.jsonl");

  const usage = params.agentMeta?.usage;
  const stats: SessionStatsEntry = {
    sessionId: params.sessionId,
    sessionKey: params.sessionKey,
    timestamp: Date.now(),
    success: !params.meta.aborted && !params.meta.error,
    aborted: params.meta.aborted ?? false,
    error: params.meta.error?.message,
    tokenUsage: {
      input: usage?.input ?? 0,
      output: usage?.output ?? 0,
      total: usage?.total ?? (usage?.input ?? 0) + (usage?.output ?? 0),
      cacheRead: usage?.cacheRead,
      cacheWrite: usage?.cacheWrite,
    },
    toolCalls: params.toolCallCount,
    durationMs: params.meta.durationMs,
    model: params.agentMeta?.model ?? "unknown",
    provider: params.agentMeta?.provider ?? "unknown",
    userSatisfaction: params.userSatisfaction,
    generation: params.generation,
    genotypeId: params.genotypeId,
    toolErrors: params.toolErrors,
  };

  // Calculate fitness if we have user satisfaction
  if (params.userSatisfaction !== undefined) {
    stats.fitness = calculateFitness(stats);
  }

  const line = JSON.stringify(stats) + "\n";
  await fs.appendFile(statsFile, line, "utf-8");
}

/**
 * Calculate fitness score based on success rate, efficiency, and user satisfaction.
 * Formula: Fitness = (W_s * S) + (W_e * E) + (W_u * U)
 * Where:
 * - S = Success rate (0 or 1)
 * - E = Efficiency (normalized token usage and tool calls)
 * - U = User satisfaction (0.0 - 1.0)
 */
export function calculateFitness(
  stats: SessionStats,
  weights?: { success: number; efficiency: number; user: number },
): number {
  const w = weights ?? { success: 0.4, efficiency: 0.3, user: 0.3 };

  // Success rate (0 or 1)
  const S = stats.success ? 1.0 : 0.0;

  // Efficiency: inverse of normalized token usage and tool calls
  // Lower tokens + fewer tool calls = higher efficiency
  // Normalize to 0-1 range (assuming max 1M tokens, 100 tool calls as baseline)
  const maxTokens = 1_000_000;
  const maxToolCalls = 100;
  const tokenEfficiency = Math.max(0, 1 - stats.tokenUsage.total / maxTokens);
  const toolEfficiency = Math.max(0, 1 - stats.toolCalls / maxToolCalls);
  const E = (tokenEfficiency + toolEfficiency) / 2;

  // User satisfaction (0.0 - 1.0)
  const U = stats.userSatisfaction ?? 0.5; // Default to neutral if not provided

  const fitness = w.success * S + w.efficiency * E + w.user * U;
  return Math.max(0, Math.min(1, fitness)); // Clamp to 0-1
}

/**
 * Read session statistics from the stats file.
 */
export async function readSessionStats(params?: {
  statsDir?: string;
  limit?: number;
}): Promise<SessionStatsEntry[]> {
  const statsDir = params?.statsDir ?? path.join(resolveStateDir(), "evolution", "stats");
  const statsFile = path.join(statsDir, "session_stats.jsonl");

  try {
    const content = await fs.readFile(statsFile, "utf-8");
    const lines = content.trim().split("\n").filter(Boolean);
    const stats: SessionStatsEntry[] = [];
    for (const line of lines) {
      try {
        stats.push(JSON.parse(line) as SessionStatsEntry);
      } catch {
        // Skip malformed lines
        continue;
      }
    }

    if (params?.limit) {
      return stats.slice(-params.limit);
    }
    return stats;
  } catch (err) {
    if ((err as { code?: string }).code === "ENOENT") {
      return [];
    }
    throw err;
  }
}

/**
 * Get aggregated statistics for a genotype or generation.
 */
export async function getAggregatedStats(params?: {
  statsDir?: string;
  generation?: number;
  genotypeId?: string;
}): Promise<{
  count: number;
  avgFitness: number;
  avgTokens: number;
  avgToolCalls: number;
  avgDuration: number;
  successRate: number;
}> {
  const allStats = await readSessionStats({ statsDir: params?.statsDir });
  let filtered = allStats;

  if (params?.generation !== undefined) {
    filtered = filtered.filter((s) => s.generation === params.generation);
  }
  if (params?.genotypeId) {
    filtered = filtered.filter((s) => s.genotypeId === params.genotypeId);
  }

  if (filtered.length === 0) {
    return {
      count: 0,
      avgFitness: 0,
      avgTokens: 0,
      avgToolCalls: 0,
      avgDuration: 0,
      successRate: 0,
    };
  }

  const fitnesses = filtered.map((s) => s.fitness ?? 0).filter((f) => f > 0);
  const tokens = filtered.map((s) => s.tokenUsage.total);
  const toolCalls = filtered.map((s) => s.toolCalls);
  const durations = filtered.map((s) => s.durationMs);
  const successes = filtered.filter((s) => s.success);

  // Safe reduce with fallback (defensive programming)
  const sum = (arr: number[]) => (arr.length > 0 ? arr.reduce((a, b) => a + b, 0) : 0);

  return {
    count: filtered.length,
    avgFitness: fitnesses.length > 0 ? sum(fitnesses) / fitnesses.length : 0,
    avgTokens: tokens.length > 0 ? sum(tokens) / tokens.length : 0,
    avgToolCalls: toolCalls.length > 0 ? sum(toolCalls) / toolCalls.length : 0,
    avgDuration: durations.length > 0 ? sum(durations) / durations.length : 0,
    successRate: filtered.length > 0 ? successes.length / filtered.length : 0,
  };
}

/**
 * Error patterns that are expected behavior, not tool bugs.
 * These are filtered from error rate calculations.
 */
const EXPECTED_ERROR_PATTERNS = [
  /^Command exited with code \d+/i, // Non-zero exit codes (fixed pattern)
  /^Command exited with non-zero status/i, // Alternative format (keep for compatibility)
  /^ENOENT.*(?:\.env|\.git|node_modules)/i, // Expected missing files
  /^not-due$/i, // Cron job not ready to run
] as const;

/**
 * Get tool error rates from telemetry data.
 * Returns tools with error rates above the threshold (default 20%).
 */
export async function getToolErrorRates(params?: {
  statsDir?: string;
  threshold?: number; // Error rate threshold (0.0 - 1.0), default 0.2 (20%)
  minCalls?: number; // Minimum tool calls to consider, default 5
}): Promise<
  Array<{ toolName: string; errorRate: number; totalCalls: number; errorCount: number }>
> {
  const threshold = params?.threshold ?? 0.2;
  const minCalls = params?.minCalls ?? 5;
  const allStats = await readSessionStats({ statsDir: params?.statsDir });

  // Aggregate tool errors across all sessions
  const toolStats = new Map<string, { calls: number; errors: number }>();

  for (const stat of allStats) {
    if (stat.toolErrors) {
      for (const [toolName, errorInfo] of Object.entries(stat.toolErrors)) {
        const existing = toolStats.get(toolName) ?? { calls: 0, errors: 0 };
        existing.calls += errorInfo.count;
        // Filter out expected errors that aren't actual bugs
        const actualErrors = errorInfo.errors.filter((errMsg) => {
          return !EXPECTED_ERROR_PATTERNS.some((pattern) => pattern.test(errMsg));
        });
        existing.errors += actualErrors.length;
        toolStats.set(toolName, existing);
      }
    }
  }

  // Calculate error rates and filter by threshold
  const hotspots: Array<{
    toolName: string;
    errorRate: number;
    totalCalls: number;
    errorCount: number;
  }> = [];

  for (const [toolName, stats] of toolStats.entries()) {
    if (stats.calls >= minCalls) {
      const errorRate = stats.errors / stats.calls;
      if (errorRate >= threshold) {
        hotspots.push({
          toolName,
          errorRate,
          totalCalls: stats.calls,
          errorCount: stats.errors,
        });
      }
    }
  }

  // Sort by error rate descending
  return hotspots.sort((a, b) => b.errorRate - a.errorRate);
}

/**
 * Get session IDs that had errors for a specific tool.
 */
export async function getFailingToolSessions(params: {
  toolName: string;
  statsDir?: string;
  limit?: number;
}): Promise<Array<{ sessionId: string; sessionKey?: string; timestamp: number; error: string }>> {
  const allStats = await readSessionStats({ statsDir: params.statsDir });
  const results: Array<{
    sessionId: string;
    sessionKey?: string;
    timestamp: number;
    error: string;
  }> = [];

  for (const stat of allStats) {
    if (stat.toolErrors?.[params.toolName]) {
      const errorInfo = stat.toolErrors[params.toolName];
      for (const error of errorInfo.errors) {
        results.push({
          sessionId: stat.sessionId,
          sessionKey: stat.sessionKey,
          timestamp: stat.timestamp,
          error,
        });
      }
    }
  }

  // Sort by timestamp descending (most recent first)
  results.sort((a, b) => b.timestamp - a.timestamp);

  if (params.limit) {
    return results.slice(0, params.limit);
  }

  return results;
}
