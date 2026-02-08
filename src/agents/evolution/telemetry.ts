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
 * Error severity levels for classification.
 */
export type ErrorSeverity = "critical" | "warning" | "info" | "expected";

/**
 * Extended error metadata for better tracking.
 */
export type ErrorMetadata = {
  severity: ErrorSeverity;
  category: string;
  isTransient: boolean;
  suggestedAction?: string;
  relatedPatterns?: string[];
};

/**
 * Pattern definition with metadata for classification.
 */
type ErrorPatternDef = {
  pattern: RegExp;
  severity: ErrorSeverity;
  category: string;
  isTransient: boolean;
  suggestedAction?: string;
};

/**
 * Comprehensive error patterns with severity and metadata.
 * Ordered by specificity (more specific patterns first).
 */
const ERROR_PATTERNS: ErrorPatternDef[] = [
  // === EXPECTED BEHAVIOR (Not bugs) ===
  {
    pattern: /^Command exited with code \d+/i,
    severity: "expected",
    category: "shell",
    isTransient: false,
    suggestedAction: "Check command output for expected non-zero exit",
  },
  {
    pattern: /^Command exited with non-zero status/i,
    severity: "expected",
    category: "shell",
    isTransient: false,
  },
  {
    pattern: /^ENOENT.*(?:\.env|\.git|node_modules|\.cache)/i,
    severity: "expected",
    category: "filesystem",
    isTransient: false,
    suggestedAction: "File intentionally not present",
  },
  {
    pattern: /^not-due$/i,
    severity: "expected",
    category: "cron",
    isTransient: false,
  },
  {
    pattern: /no sessions found|session not found/i,
    severity: "expected",
    category: "session",
    isTransient: false,
  },
  {
    pattern: /already exists|duplicate/i,
    severity: "expected",
    category: "state",
    isTransient: false,
  },
  {
    pattern: /nothing to commit|no changes/i,
    severity: "expected",
    category: "git",
    isTransient: false,
  },
  {
    pattern: /^jq: error/i,
    severity: "expected",
    category: "shell",
    isTransient: false,
    suggestedAction: "Fix jq query or input JSON",
  },
  {
    pattern: /fatal: not a git repository/i,
    severity: "expected",
    category: "git",
    isTransient: false,
    suggestedAction: "Run command inside a git repository",
  },
  {
    pattern: /error: unknown command/i,
    severity: "expected",
    category: "shell",
    isTransient: false,
    suggestedAction: "Check CLI command spelling",
  },
  {
    pattern: /^error: pathspec .* did not match/i,
    severity: "expected",
    category: "git",
    isTransient: false,
  },
  {
    pattern: /node:internal\/modules\/cjs\/loader/i,
    severity: "expected",
    category: "node",
    isTransient: false,
    suggestedAction: "Check module exists and paths are correct",
  },
  {
    pattern: /Cannot find module/i,
    severity: "expected",
    category: "node",
    isTransient: false,
  },
  {
    pattern: /rate limit|too many requests|429/i,
    severity: "expected",
    category: "api",
    isTransient: true,
    suggestedAction: "Retry with exponential backoff",
  },

  // === INFO (Minor issues, low priority) ===
  {
    pattern: /deprecated|will be removed/i,
    severity: "info",
    category: "deprecation",
    isTransient: false,
    suggestedAction: "Update to newer API when convenient",
  },
  {
    pattern: /warning:|warn:/i,
    severity: "info",
    category: "warning",
    isTransient: false,
  },
  {
    pattern: /timeout.*(?:expected|normal)/i,
    severity: "info",
    category: "timeout",
    isTransient: true,
  },

  // === WARNING (Should investigate) ===
  {
    pattern: /ECONNRESET|ECONNREFUSED|ETIMEDOUT/i,
    severity: "warning",
    category: "network",
    isTransient: true,
    suggestedAction: "Check network connectivity, retry operation",
  },
  {
    pattern: /socket hang up|connection reset/i,
    severity: "warning",
    category: "network",
    isTransient: true,
    suggestedAction: "Retry with backoff",
  },
  {
    pattern: /ENOMEM|out of memory/i,
    severity: "warning",
    category: "resource",
    isTransient: true,
    suggestedAction: "Check memory usage, consider cleanup",
  },
  {
    pattern: /ENOSPC|no space left/i,
    severity: "warning",
    category: "resource",
    isTransient: false,
    suggestedAction: "Free disk space",
  },
  {
    pattern: /permission denied|EACCES|EPERM/i,
    severity: "warning",
    category: "permissions",
    isTransient: false,
    suggestedAction: "Check file/directory permissions",
  },
  {
    pattern: /authentication failed|unauthorized|401|403/i,
    severity: "warning",
    category: "auth",
    isTransient: false,
    suggestedAction: "Check credentials and tokens",
  },
  {
    pattern: /not found.*(?:file|module|package)|404/i,
    severity: "warning",
    category: "notfound",
    isTransient: false,
    suggestedAction: "Verify path or resource exists",
  },
  {
    pattern: /parse error|syntax error|unexpected token/i,
    severity: "warning",
    category: "syntax",
    isTransient: false,
    suggestedAction: "Fix syntax in source file",
  },
  {
    pattern: /type error|TS\d{4}:/i,
    severity: "warning",
    category: "typescript",
    isTransient: false,
    suggestedAction: "Fix TypeScript type issues",
  },

  // === CRITICAL (Immediate attention) ===
  {
    pattern: /fatal|panic|crash|segfault/i,
    severity: "critical",
    category: "crash",
    isTransient: false,
    suggestedAction: "Investigate crash immediately, check logs",
  },
  {
    pattern: /unhandled.*rejection|uncaught.*exception/i,
    severity: "critical",
    category: "unhandled",
    isTransient: false,
    suggestedAction: "Add error handling for this case",
  },
  {
    pattern: /stack overflow|maximum call stack/i,
    severity: "critical",
    category: "recursion",
    isTransient: false,
    suggestedAction: "Fix infinite recursion",
  },
  {
    pattern: /deadlock|hung|frozen/i,
    severity: "critical",
    category: "deadlock",
    isTransient: false,
    suggestedAction: "Check for blocking operations",
  },
  {
    pattern: /data corruption|integrity|checksum/i,
    severity: "critical",
    category: "data",
    isTransient: false,
    suggestedAction: "Verify data integrity, restore from backup if needed",
  },
  {
    pattern: /security|vulnerability|exploit/i,
    severity: "critical",
    category: "security",
    isTransient: false,
    suggestedAction: "Address security issue immediately",
  },
];

/**
 * Legacy: Error patterns that are expected behavior (kept for backward compatibility).
 * Use classifyError() for new code.
 */
const EXPECTED_ERROR_PATTERNS = ERROR_PATTERNS.filter((p) => p.severity === "expected").map(
  (p) => p.pattern,
) as unknown as readonly RegExp[];

/**
 * Classify an error message and return its metadata.
 */
export function classifyError(errorMessage: string): ErrorMetadata {
  for (const def of ERROR_PATTERNS) {
    if (def.pattern.test(errorMessage)) {
      return {
        severity: def.severity,
        category: def.category,
        isTransient: def.isTransient,
        suggestedAction: def.suggestedAction,
        relatedPatterns: [def.pattern.source],
      };
    }
  }

  // Default: unknown errors are warnings
  return {
    severity: "warning",
    category: "unknown",
    isTransient: false,
    suggestedAction: "Investigate error message",
  };
}

/**
 * Check if an error is expected (not a bug).
 */
export function isExpectedError(errorMessage: string): boolean {
  const meta = classifyError(errorMessage);
  return meta.severity === "expected";
}

/**
 * Filter errors by severity level.
 */
export function filterErrorsBySeverity(errors: string[], minSeverity: ErrorSeverity): string[] {
  const severityOrder: Record<ErrorSeverity, number> = {
    expected: 0,
    info: 1,
    warning: 2,
    critical: 3,
  };
  const minLevel = severityOrder[minSeverity];

  return errors.filter((err) => {
    const meta = classifyError(err);
    return severityOrder[meta.severity] >= minLevel;
  });
}

/**
 * Get error summary statistics.
 */
export function getErrorSummary(errors: string[]): {
  total: number;
  bySeverity: Record<ErrorSeverity, number>;
  byCategory: Record<string, number>;
  actionableCount: number;
} {
  const bySeverity: Record<ErrorSeverity, number> = {
    critical: 0,
    warning: 0,
    info: 0,
    expected: 0,
  };
  const byCategory: Record<string, number> = {};
  let actionableCount = 0;

  for (const err of errors) {
    const meta = classifyError(err);
    bySeverity[meta.severity]++;
    byCategory[meta.category] = (byCategory[meta.category] ?? 0) + 1;
    if (meta.severity !== "expected" && meta.severity !== "info") {
      actionableCount++;
    }
  }

  return {
    total: errors.length,
    bySeverity,
    byCategory,
    actionableCount,
  };
}

/**
 * Extended tool error stats with severity breakdown.
 */
export type ToolErrorStats = {
  toolName: string;
  errorRate: number;
  totalCalls: number;
  errorCount: number;
  bySeverity: Record<ErrorSeverity, number>;
  topCategories: Array<{ category: string; count: number }>;
};

/**
 * Get tool error rates from telemetry data.
 * Returns tools with error rates above the threshold (default 20%).
 * Now uses enhanced error classification for better false positive filtering.
 */
export async function getToolErrorRates(params?: {
  statsDir?: string;
  threshold?: number; // Error rate threshold (0.0 - 1.0), default 0.2 (20%)
  minCalls?: number; // Minimum tool calls to consider, default 5
  minSeverity?: ErrorSeverity; // Minimum severity to count as error (default: "warning")
  includeDetails?: boolean; // Include severity breakdown (default: false)
}): Promise<ToolErrorStats[]> {
  const threshold = params?.threshold ?? 0.2;
  const minCalls = params?.minCalls ?? 5;
  const minSeverity = params?.minSeverity ?? "warning";
  const includeDetails = params?.includeDetails ?? false;
  const allStats = await readSessionStats({ statsDir: params?.statsDir });

  const severityOrder: Record<ErrorSeverity, number> = {
    expected: 0,
    info: 1,
    warning: 2,
    critical: 3,
  };
  const minLevel = severityOrder[minSeverity];

  // Aggregate tool errors across all sessions with detailed tracking
  const toolStats = new Map<
    string,
    {
      calls: number;
      errors: number;
      bySeverity: Record<ErrorSeverity, number>;
      byCategory: Record<string, number>;
    }
  >();

  for (const stat of allStats) {
    if (stat.toolErrors) {
      for (const [toolName, errorInfo] of Object.entries(stat.toolErrors)) {
        const existing = toolStats.get(toolName) ?? {
          calls: 0,
          errors: 0,
          bySeverity: { critical: 0, warning: 0, info: 0, expected: 0 },
          byCategory: {},
        };
        existing.calls += errorInfo.count;

        // Classify each error and track by severity
        for (const errMsg of errorInfo.errors) {
          const meta = classifyError(errMsg);
          existing.bySeverity[meta.severity]++;
          existing.byCategory[meta.category] = (existing.byCategory[meta.category] ?? 0) + 1;

          // Only count as actionable error if meets minimum severity
          if (severityOrder[meta.severity] >= minLevel) {
            existing.errors++;
          }
        }

        toolStats.set(toolName, existing);
      }
    }
  }

  // Calculate error rates and filter by threshold
  const hotspots: ToolErrorStats[] = [];

  for (const [toolName, stats] of toolStats.entries()) {
    if (stats.calls >= minCalls) {
      const errorRate = stats.errors / stats.calls;
      if (errorRate >= threshold) {
        // Get top categories
        const topCategories = Object.entries(stats.byCategory)
          .map(([category, count]) => ({ category, count }))
          .sort((a, b) => b.count - a.count)
          .slice(0, 3);

        hotspots.push({
          toolName,
          errorRate,
          totalCalls: stats.calls,
          errorCount: stats.errors,
          bySeverity: includeDetails
            ? stats.bySeverity
            : { critical: 0, warning: 0, info: 0, expected: 0 },
          topCategories: includeDetails ? topCategories : [],
        });
      }
    }
  }

  // Sort by error rate descending
  return hotspots.sort((a, b) => b.errorRate - a.errorRate);
}

/**
 * Get session IDs that had errors for a specific tool.
 * Filters by severity to only return actionable errors by default.
 */
export async function getFailingToolSessions(params: {
  toolName: string;
  statsDir?: string;
  limit?: number;
  minSeverity?: ErrorSeverity;
}): Promise<
  Array<{
    sessionId: string;
    sessionKey?: string;
    timestamp: number;
    error: string;
    severity?: ErrorSeverity;
  }>
> {
  const allStats = await readSessionStats({ statsDir: params.statsDir });
  const results: Array<{
    sessionId: string;
    sessionKey?: string;
    timestamp: number;
    error: string;
    severity?: ErrorSeverity;
  }> = [];

  // Default to "warning" to filter out expected/info errors (matching getToolErrorRates behavior)
  const minSeverity = params.minSeverity ?? "warning";
  const severityOrder: Record<ErrorSeverity, number> = {
    expected: 0,
    info: 1,
    warning: 2,
    critical: 3,
  };
  const minLevel = severityOrder[minSeverity];

  for (const stat of allStats) {
    if (stat.toolErrors?.[params.toolName]) {
      const errorInfo = stat.toolErrors[params.toolName];
      for (const error of errorInfo.errors) {
        const meta = classifyError(error);
        // Only include errors that meet minimum severity threshold
        if (severityOrder[meta.severity] >= minLevel) {
          results.push({
            sessionId: stat.sessionId,
            sessionKey: stat.sessionKey,
            timestamp: stat.timestamp,
            error,
            severity: meta.severity,
          });
        }
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
