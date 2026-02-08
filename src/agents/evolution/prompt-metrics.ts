import { promises as fs } from "fs";
import path from "path";
import { resolveStateDir } from "../../config/paths.js";
import { readSessionStats, type SessionStatsEntry } from "./telemetry.js";
import { classifyError } from "./telemetry.js";

export interface PromptSessionOutcome {
  sessionId: string;
  sessionKey?: string;
  timestamp: number;
  promptId: string;
  promptName: string;
  experimentId?: string; // If this was part of an A/B test

  // Primary metrics
  success: boolean;
  tokenUsage: {
    input: number;
    output: number;
    total: number;
  };
  durationMs: number;
  errorCount: number;
  errors: string[];

  // Calculated scores
  tokenEfficiency: number; // 1.0 = baseline, <1.0 is better
  errorRate: number; // 0.0 - 1.0
  alignmentScore: number; // 0.0 - 1.0 (derived from error patterns)

  // Additional context
  toolCalls: number;
  model: string;
  provider: string;
}

export interface PromptMetrics {
  promptId: string;
  promptName: string;
  period: "day" | "week" | "month";
  timestamp: string;

  // Sample size
  sampleSize: number;

  // Primary metrics
  successRate: number; // 0.0 - 1.0
  tokenEfficiency: number; // baseline=1.0, <1.0 better
  errorRate: number; // 0.0 - 1.0
  alignmentScore: number; // 0.0 - 1.0

  // Detailed breakdowns
  commonErrors: Array<{
    error: string;
    count: number;
    severity: "low" | "medium" | "high";
  }>;

  failurePatterns: Array<{
    pattern: string;
    taskType: string;
    frequency: number;
  }>;

  emergentBehaviors: Array<{
    behavior: string;
    valence: "positive" | "negative" | "neutral";
    count: number;
  }>;

  // Performance distribution
  tokenDistribution: {
    p50: number;
    p90: number;
    p95: number;
    p99: number;
  };

  durationDistribution: {
    p50: number;
    p90: number;
    p95: number;
    p99: number;
  };
}

export interface PromptHealthReport {
  generatedAt: string;
  period: { start: string; end: string };
  summary: {
    totalPrompts: number;
    totalSessions: number;
    overallSuccessRate: number;
    averageTokens: number;
  };

  leaderboard: Array<{
    promptName: string;
    promptId: string;
    successRate: number;
    tokenEfficiency: number;
    errorRate: number;
    status: "🟢 Good" | "🟡 Monitor" | "🔴 Needs Work";
  }>;

  criticalIssues: Array<{
    promptName: string;
    promptId: string;
    issue: string;
    severity: "critical" | "warning";
    recommendation: string;
  }>;

  abTestResults: Array<{
    experimentId: string;
    name: string;
    winner: string;
    improvement: number;
    significance: number;
    recommendation: string;
  }>;

  trendingMetrics: {
    successRateTrend: number; // % change from previous period
    tokenEfficiencyTrend: number;
    errorRateTrend: number;
  };
}

/**
 * Get the prompt metrics file path.
 */
export function getPromptMetricsPath(): string {
  return path.join(resolveStateDir(), "evolution", "prompts", "session_outcomes.jsonl");
}

/**
 * Record session outcome for prompt metrics.
 */
export async function recordPromptSession(params: {
  sessionId: string;
  sessionKey?: string;
  promptId: string;
  promptName: string;
  experimentId?: string;
  success: boolean;
  tokenUsage: { input: number; output: number; total: number };
  durationMs: number;
  errors: string[];
  toolCalls: number;
  model: string;
  provider: string;
  baselineTokens?: number; // For calculating efficiency
}): Promise<void> {
  const metricsPath = getPromptMetricsPath();
  await fs.mkdir(path.dirname(metricsPath), { recursive: true });

  // Calculate metrics
  const errorCount = params.errors.length;
  const errorRate = errorCount > 0 ? errorCount / (params.toolCalls || 1) : 0;

  // Token efficiency (1.0 = baseline, <1.0 is better)
  const baselineTokens = params.baselineTokens || 50000; // Default baseline
  const tokenEfficiency = params.tokenUsage.total / baselineTokens;

  // Alignment score based on error severity
  const alignmentScore = calculateAlignmentScore(params.errors);

  const outcome: PromptSessionOutcome = {
    sessionId: params.sessionId,
    sessionKey: params.sessionKey,
    timestamp: Date.now(),
    promptId: params.promptId,
    promptName: params.promptName,
    experimentId: params.experimentId,
    success: params.success,
    tokenUsage: params.tokenUsage,
    durationMs: params.durationMs,
    errorCount,
    errors: params.errors,
    tokenEfficiency,
    errorRate,
    alignmentScore,
    toolCalls: params.toolCalls,
    model: params.model,
    provider: params.provider,
  };

  const line = JSON.stringify(outcome) + "\n";
  await fs.appendFile(metricsPath, line, "utf-8");
}

/**
 * Calculate alignment score based on error patterns.
 */
function calculateAlignmentScore(errors: string[]): number {
  if (errors.length === 0) {
    return 1.0; // Perfect alignment if no errors
  }

  let severityScore = 0;
  const severityWeights = { expected: 0, info: 0.1, warning: 0.5, critical: 1.0 };

  for (const error of errors) {
    const meta = classifyError(error);
    severityScore += severityWeights[meta.severity];
  }

  // Calculate alignment score (higher scores for fewer/less severe errors)
  const avgSeverity = severityScore / errors.length;
  return Math.max(0, 1 - avgSeverity);
}

/**
 * Read prompt session outcomes from disk.
 */
export async function readPromptSessions(params?: {
  promptId?: string;
  promptName?: string;
  limit?: number;
  since?: number; // Timestamp
}): Promise<PromptSessionOutcome[]> {
  const metricsPath = getPromptMetricsPath();

  try {
    const content = await fs.readFile(metricsPath, "utf-8");
    const lines = content.trim().split("\n").filter(Boolean);
    const outcomes: PromptSessionOutcome[] = [];

    for (const line of lines) {
      try {
        const outcome = JSON.parse(line) as PromptSessionOutcome;

        // Apply filters
        if (params?.promptId && outcome.promptId !== params.promptId) continue;
        if (params?.promptName && outcome.promptName !== params.promptName) continue;
        if (params?.since && outcome.timestamp < params.since) continue;

        outcomes.push(outcome);
      } catch {
        // Skip malformed lines
        continue;
      }
    }

    // Sort by timestamp descending
    outcomes.sort((a, b) => b.timestamp - a.timestamp);

    if (params?.limit) {
      return outcomes.slice(0, params.limit);
    }

    return outcomes;
  } catch (err) {
    if ((err as { code?: string }).code === "ENOENT") {
      return [];
    }
    throw err;
  }
}

/**
 * Calculate metrics for a specific prompt.
 */
export async function getMetricsForPrompt(params: {
  promptId?: string;
  promptName?: string;
  period: "day" | "week" | "month";
}): Promise<PromptMetrics | null> {
  const now = Date.now();
  const periodMs = {
    day: 24 * 60 * 60 * 1000,
    week: 7 * 24 * 60 * 60 * 1000,
    month: 30 * 24 * 60 * 60 * 1000,
  };

  const since = now - periodMs[params.period];
  const sessions = await readPromptSessions({
    promptId: params.promptId,
    promptName: params.promptName,
    since,
  });

  if (sessions.length === 0) {
    return null;
  }

  // Calculate primary metrics
  const successCount = sessions.filter((s) => s.success).length;
  const successRate = successCount / sessions.length;

  const avgTokenEfficiency =
    sessions.reduce((sum, s) => sum + s.tokenEfficiency, 0) / sessions.length;
  const avgErrorRate = sessions.reduce((sum, s) => sum + s.errorRate, 0) / sessions.length;
  const avgAlignmentScore =
    sessions.reduce((sum, s) => sum + s.alignmentScore, 0) / sessions.length;

  // Error analysis
  const allErrors = sessions.flatMap((s) => s.errors);
  const errorCounts = new Map<string, number>();

  for (const error of allErrors) {
    errorCounts.set(error, (errorCounts.get(error) || 0) + 1);
  }

  const commonErrors = Array.from(errorCounts.entries())
    .map(([error, count]) => {
      const meta = classifyError(error);
      const severity =
        meta.severity === "critical" ? "high" : meta.severity === "warning" ? "medium" : "low";
      return { error, count, severity: severity as "low" | "medium" | "high" };
    })
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  // Performance distributions
  const tokenTotals = sessions.map((s) => s.tokenUsage.total).sort((a, b) => a - b);
  const durations = sessions.map((s) => s.durationMs).sort((a, b) => a - b);

  const getPercentile = (arr: number[], p: number): number => {
    const index = Math.floor(arr.length * p);
    return arr[Math.min(index, arr.length - 1)];
  };

  const metrics: PromptMetrics = {
    promptId: params.promptId || sessions[0].promptId,
    promptName: params.promptName || sessions[0].promptName,
    period: params.period,
    timestamp: new Date().toISOString(),
    sampleSize: sessions.length,
    successRate,
    tokenEfficiency: avgTokenEfficiency,
    errorRate: avgErrorRate,
    alignmentScore: avgAlignmentScore,
    commonErrors,
    failurePatterns: [], // TODO: Implement pattern detection
    emergentBehaviors: [], // TODO: Implement behavior detection
    tokenDistribution: {
      p50: getPercentile(tokenTotals, 0.5),
      p90: getPercentile(tokenTotals, 0.9),
      p95: getPercentile(tokenTotals, 0.95),
      p99: getPercentile(tokenTotals, 0.99),
    },
    durationDistribution: {
      p50: getPercentile(durations, 0.5),
      p90: getPercentile(durations, 0.9),
      p95: getPercentile(durations, 0.95),
      p99: getPercentile(durations, 0.99),
    },
  };

  return metrics;
}

/**
 * Generate a health report for all prompts.
 */
export async function generateHealthReport(
  period: "week" | "month" = "week",
): Promise<PromptHealthReport> {
  const now = Date.now();
  const periodMs = period === "week" ? 7 * 24 * 60 * 60 * 1000 : 30 * 24 * 60 * 60 * 1000;
  const start = now - periodMs;

  const allSessions = await readPromptSessions({ since: start });

  // Group by prompt
  const promptGroups = new Map<string, PromptSessionOutcome[]>();
  for (const session of allSessions) {
    const key = `${session.promptName}-${session.promptId}`;
    if (!promptGroups.has(key)) {
      promptGroups.set(key, []);
    }
    promptGroups.get(key)!.push(session);
  }

  // Calculate metrics for each prompt
  const leaderboard: PromptHealthReport["leaderboard"] = [];
  const criticalIssues: PromptHealthReport["criticalIssues"] = [];

  for (const [key, sessions] of promptGroups.entries()) {
    const promptName = sessions[0].promptName;
    const promptId = sessions[0].promptId;

    const successCount = sessions.filter((s) => s.success).length;
    const successRate = successCount / sessions.length;
    const avgTokenEfficiency =
      sessions.reduce((sum, s) => sum + s.tokenEfficiency, 0) / sessions.length;
    const avgErrorRate = sessions.reduce((sum, s) => sum + s.errorRate, 0) / sessions.length;

    // Determine status
    let status: "🟢 Good" | "🟡 Monitor" | "🔴 Needs Work";
    if (successRate >= 0.95 && avgErrorRate <= 0.03) {
      status = "🟢 Good";
    } else if (successRate >= 0.9 && avgErrorRate <= 0.05) {
      status = "🟡 Monitor";
    } else {
      status = "🔴 Needs Work";
    }

    leaderboard.push({
      promptName,
      promptId,
      successRate,
      tokenEfficiency: avgTokenEfficiency,
      errorRate: avgErrorRate,
      status,
    });

    // Check for critical issues
    if (avgErrorRate > 0.05) {
      criticalIssues.push({
        promptName,
        promptId,
        issue: `High error rate: ${(avgErrorRate * 100).toFixed(1)}%`,
        severity: avgErrorRate > 0.1 ? "critical" : "warning",
        recommendation: "Review error patterns and refine prompt wording",
      });
    }

    if (successRate < 0.9) {
      criticalIssues.push({
        promptName,
        promptId,
        issue: `Low success rate: ${(successRate * 100).toFixed(1)}%`,
        severity: successRate < 0.8 ? "critical" : "warning",
        recommendation: "Investigate failure patterns and improve prompt clarity",
      });
    }
  }

  // Sort leaderboard by success rate descending
  leaderboard.sort((a, b) => b.successRate - a.successRate);

  // Calculate summary metrics
  const totalSessions = allSessions.length;
  const overallSuccessCount = allSessions.filter((s) => s.success).length;
  const overallSuccessRate = totalSessions > 0 ? overallSuccessCount / totalSessions : 0;
  const averageTokens =
    totalSessions > 0
      ? allSessions.reduce((sum, s) => sum + s.tokenUsage.total, 0) / totalSessions
      : 0;

  const report: PromptHealthReport = {
    generatedAt: new Date().toISOString(),
    period: {
      start: new Date(start).toISOString(),
      end: new Date(now).toISOString(),
    },
    summary: {
      totalPrompts: promptGroups.size,
      totalSessions,
      overallSuccessRate,
      averageTokens,
    },
    leaderboard,
    criticalIssues,
    abTestResults: [], // TODO: Implement A/B test result analysis
    trendingMetrics: {
      successRateTrend: 0, // TODO: Compare with previous period
      tokenEfficiencyTrend: 0,
      errorRateTrend: 0,
    },
  };

  return report;
}

/**
 * Save health report to memory folder.
 */
export async function saveHealthReport(
  report: PromptHealthReport,
  workspaceDir: string,
): Promise<string> {
  const memoryDir = path.join(workspaceDir, "memory");
  await fs.mkdir(memoryDir, { recursive: true });

  // Generate week number (ISO week)
  const date = new Date(report.generatedAt);
  const yearStart = new Date(date.getFullYear(), 0, 1);
  const weekNum = Math.ceil(((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);

  const fileName = `prompt-health-${date.getFullYear()}-W${weekNum.toString().padStart(2, "0")}.md`;
  const filePath = path.join(memoryDir, fileName);

  const markdown = formatHealthReportAsMarkdown(report);
  await fs.writeFile(filePath, markdown, "utf-8");

  return filePath;
}

/**
 * Format health report as markdown.
 */
function formatHealthReportAsMarkdown(report: PromptHealthReport): string {
  const date = new Date(report.generatedAt);
  const weekNum = Math.ceil(
    ((date.getTime() - new Date(date.getFullYear(), 0, 1).getTime()) / 86400000 + 1) / 7,
  );

  const lines: string[] = [
    `## Prompt Health Report — W${weekNum.toString().padStart(2, "0")} ${date.getFullYear()}`,
    "",
    "### Summary",
    `| Metric | Value |`,
    `|--------|-------|`,
    `| Total Prompts | ${report.summary.totalPrompts} |`,
    `| Total Sessions | ${report.summary.totalSessions} |`,
    `| Overall Success Rate | ${(report.summary.overallSuccessRate * 100).toFixed(1)}% |`,
    `| Average Tokens | ${report.summary.averageTokens.toFixed(0)} |`,
    "",
    "### Prompt Leaderboard",
    "| Prompt | Success Rate | Token Efficiency | Error Rate | Status |",
    "|--------|--------------|------------------|------------|---------|",
  ];

  for (const item of report.leaderboard) {
    lines.push(
      `| ${item.promptName} (${item.promptId.substring(0, 8)}) | ${(item.successRate * 100).toFixed(1)}% | ${item.tokenEfficiency.toFixed(2)}x | ${(item.errorRate * 100).toFixed(1)}% | ${item.status} |`,
    );
  }

  if (report.criticalIssues.length > 0) {
    lines.push("", "### Critical Issues", "");

    for (const issue of report.criticalIssues) {
      const icon = issue.severity === "critical" ? "🔴" : "🟡";
      lines.push(
        `**${icon} ${issue.promptName}:** ${issue.issue}`,
        `- ${issue.recommendation}`,
        "",
      );
    }
  }

  if (report.abTestResults.length > 0) {
    lines.push("", "### A/B Test Results", "");

    for (const result of report.abTestResults) {
      lines.push(
        `**${result.name}:** ${result.winner} wins with ${result.improvement.toFixed(1)}% improvement (p=${result.significance.toFixed(3)})`,
        `- ${result.recommendation}`,
        "",
      );
    }
  }

  lines.push(
    "",
    "### Trending Metrics (vs Previous Period)",
    `- Success Rate: ${report.trendingMetrics.successRateTrend >= 0 ? "+" : ""}${report.trendingMetrics.successRateTrend.toFixed(1)}%`,
    `- Token Efficiency: ${report.trendingMetrics.tokenEfficiencyTrend >= 0 ? "+" : ""}${report.trendingMetrics.tokenEfficiencyTrend.toFixed(1)}%`,
    `- Error Rate: ${report.trendingMetrics.errorRateTrend >= 0 ? "+" : ""}${report.trendingMetrics.errorRateTrend.toFixed(1)}%`,
    "",
    `---`,
    `Generated: ${date.toISOString()}`,
    `Period: ${new Date(report.period.start).toLocaleDateString()} - ${new Date(report.period.end).toLocaleDateString()}`,
  );

  return lines.join("\n");
}
