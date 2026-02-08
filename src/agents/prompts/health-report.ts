import { promises as fs } from "fs";
import path from "path";
import {
  generateHealthReport,
  saveHealthReport,
  type PromptHealthReport,
} from "../evolution/prompt-metrics.js";
import { readPromptSessions } from "../evolution/prompt-metrics.js";
import { loadExperimentRegistry } from "./registry.js";

/**
 * Generate and save weekly health report.
 */
export async function generateWeeklyHealthReport(workspaceDir: string): Promise<{
  report: PromptHealthReport;
  filePath: string;
}> {
  const report = await generateHealthReport("week");

  // Enhance with A/B test results
  const experiments = await loadExperimentRegistry();
  const completedExperiments = Object.values(experiments).filter(
    (exp) => exp.status === "complete" && exp.results,
  );

  // Add recent A/B test results
  const abTestResults = completedExperiments.map((exp) => {
    const results = exp.results!;
    const improvement = results.improvement;
    const significance = results.pValue;

    let recommendation: string;
    if (significance < 0.01) {
      recommendation = `Deploy ${results.winnerPromptId} immediately - highly significant improvement`;
    } else if (significance < 0.05) {
      recommendation = `Deploy ${results.winnerPromptId} - statistically significant improvement`;
    } else {
      recommendation = `No significant difference - continue with current prompt`;
    }

    return {
      experimentId: exp.id,
      name: exp.name,
      winner: results.winnerPromptId,
      improvement,
      significance,
      recommendation,
    };
  });

  report.abTestResults = abTestResults;

  // Calculate trends by comparing with previous period
  const trendingMetrics = await calculateTrends();
  report.trendingMetrics = trendingMetrics;

  const filePath = await saveHealthReport(report, workspaceDir);

  return { report, filePath };
}

/**
 * Calculate trending metrics by comparing current period with previous period.
 */
async function calculateTrends(): Promise<PromptHealthReport["trendingMetrics"]> {
  const now = Date.now();
  const oneWeek = 7 * 24 * 60 * 60 * 1000;

  // Current week
  const currentWeekSessions = await readPromptSessions({
    since: now - oneWeek,
  });

  // Previous week
  const previousWeekSessions = await readPromptSessions({
    since: now - 2 * oneWeek,
    limit: 10000, // Large limit to get all sessions in range
  }).then((sessions) => sessions.filter((s) => s.timestamp < now - oneWeek));

  const calculateMetrics = (sessions: typeof currentWeekSessions) => {
    if (sessions.length === 0) {
      return { successRate: 0, tokenEfficiency: 1, errorRate: 0 };
    }

    const successCount = sessions.filter((s) => s.success).length;
    const successRate = successCount / sessions.length;
    const avgTokenEfficiency =
      sessions.reduce((sum, s) => sum + s.tokenEfficiency, 0) / sessions.length;
    const avgErrorRate = sessions.reduce((sum, s) => sum + s.errorRate, 0) / sessions.length;

    return { successRate, tokenEfficiency: avgTokenEfficiency, errorRate: avgErrorRate };
  };

  const currentMetrics = calculateMetrics(currentWeekSessions);
  const previousMetrics = calculateMetrics(previousWeekSessions);

  // Calculate percentage changes
  const successRateTrend =
    previousMetrics.successRate > 0
      ? ((currentMetrics.successRate - previousMetrics.successRate) / previousMetrics.successRate) *
        100
      : 0;

  const tokenEfficiencyTrend =
    previousMetrics.tokenEfficiency > 0
      ? ((currentMetrics.tokenEfficiency - previousMetrics.tokenEfficiency) /
          previousMetrics.tokenEfficiency) *
        100
      : 0;

  const errorRateTrend =
    previousMetrics.errorRate > 0
      ? ((currentMetrics.errorRate - previousMetrics.errorRate) / previousMetrics.errorRate) * 100
      : 0;

  return {
    successRateTrend,
    tokenEfficiencyTrend,
    errorRateTrend,
  };
}

/**
 * Generate health report for a specific prompt.
 */
export async function generatePromptHealthReport(params: {
  promptName: string;
  promptId?: string;
  period?: "day" | "week" | "month";
  workspaceDir: string;
}): Promise<{ filePath: string; content: string }> {
  const period = params.period || "week";

  // Import the metrics function
  const { getMetricsForPrompt } = await import("../evolution/prompt-metrics.js");

  const metrics = await getMetricsForPrompt({
    promptName: params.promptName,
    promptId: params.promptId,
    period,
  });

  if (!metrics) {
    throw new Error(`No metrics found for prompt ${params.promptName}`);
  }

  const content = formatSinglePromptReport(metrics);

  const memoryDir = path.join(params.workspaceDir, "memory");
  await fs.mkdir(memoryDir, { recursive: true });

  const fileName = `prompt-${params.promptName}-${period}-${new Date().toISOString().split("T")[0]}.md`;
  const filePath = path.join(memoryDir, fileName);

  await fs.writeFile(filePath, content, "utf-8");

  return { filePath, content };
}

/**
 * Format metrics for a single prompt as markdown.
 */
function formatSinglePromptReport(
  metrics: import("../evolution/prompt-metrics.js").PromptMetrics,
): string {
  const lines: string[] = [
    `# Prompt Health Report: ${metrics.promptName}`,
    "",
    `**Prompt ID:** ${metrics.promptId}`,
    `**Period:** ${metrics.period}`,
    `**Sample Size:** ${metrics.sampleSize} sessions`,
    `**Generated:** ${new Date(metrics.timestamp).toLocaleString()}`,
    "",
    "## Summary Metrics",
    "",
    `| Metric | Value | Status |`,
    `|--------|-------|--------|`,
    `| Success Rate | ${(metrics.successRate * 100).toFixed(1)}% | ${getStatusIcon(metrics.successRate, "successRate")} |`,
    `| Token Efficiency | ${metrics.tokenEfficiency.toFixed(2)}x | ${getStatusIcon(metrics.tokenEfficiency, "tokenEfficiency")} |`,
    `| Error Rate | ${(metrics.errorRate * 100).toFixed(1)}% | ${getStatusIcon(metrics.errorRate, "errorRate")} |`,
    `| Alignment Score | ${(metrics.alignmentScore * 100).toFixed(1)}% | ${getStatusIcon(metrics.alignmentScore, "alignmentScore")} |`,
    "",
  ];

  if (metrics.commonErrors.length > 0) {
    lines.push(
      "## Common Errors",
      "",
      "| Error | Count | Severity |",
      "|-------|-------|----------|",
    );

    for (const error of metrics.commonErrors.slice(0, 10)) {
      const severityIcon =
        error.severity === "high" ? "🔴" : error.severity === "medium" ? "🟡" : "🟢";
      lines.push(`| ${error.error} | ${error.count} | ${severityIcon} ${error.severity} |`);
    }

    lines.push("");
  }

  lines.push(
    "## Performance Distribution",
    "",
    "### Token Usage",
    `- P50: ${metrics.tokenDistribution.p50.toLocaleString()} tokens`,
    `- P90: ${metrics.tokenDistribution.p90.toLocaleString()} tokens`,
    `- P95: ${metrics.tokenDistribution.p95.toLocaleString()} tokens`,
    `- P99: ${metrics.tokenDistribution.p99.toLocaleString()} tokens`,
    "",
    "### Duration",
    `- P50: ${(metrics.durationDistribution.p50 / 1000).toFixed(1)}s`,
    `- P90: ${(metrics.durationDistribution.p90 / 1000).toFixed(1)}s`,
    `- P95: ${(metrics.durationDistribution.p95 / 1000).toFixed(1)}s`,
    `- P99: ${(metrics.durationDistribution.p99 / 1000).toFixed(1)}s`,
    "",
  );

  // Add recommendations based on metrics
  const recommendations = generateRecommendations(metrics);
  if (recommendations.length > 0) {
    lines.push("## Recommendations", "", ...recommendations.map((rec) => `- ${rec}`), "");
  }

  return lines.join("\n");
}

/**
 * Get status icon based on metric value and type.
 */
function getStatusIcon(value: number, metricType: string): string {
  switch (metricType) {
    case "successRate":
      if (value >= 0.95) return "🟢 Excellent";
      if (value >= 0.9) return "🟡 Good";
      return "🔴 Needs Work";

    case "tokenEfficiency":
      if (value <= 0.9) return "🟢 Efficient";
      if (value <= 1.1) return "🟡 Average";
      return "🔴 Inefficient";

    case "errorRate":
      if (value <= 0.03) return "🟢 Low";
      if (value <= 0.05) return "🟡 Moderate";
      return "🔴 High";

    case "alignmentScore":
      if (value >= 0.9) return "🟢 Aligned";
      if (value >= 0.7) return "🟡 Mostly Aligned";
      return "🔴 Misaligned";

    default:
      return "";
  }
}

/**
 * Generate recommendations based on metrics.
 */
function generateRecommendations(
  metrics: import("../evolution/prompt-metrics.js").PromptMetrics,
): string[] {
  const recommendations: string[] = [];

  if (metrics.successRate < 0.9) {
    recommendations.push(
      `Low success rate (${(metrics.successRate * 100).toFixed(1)}%) - Consider revising prompt clarity and adding examples`,
    );
  }

  if (metrics.tokenEfficiency > 1.2) {
    recommendations.push(
      `High token usage (${metrics.tokenEfficiency.toFixed(2)}x baseline) - Prompt may be too verbose or causing excessive output`,
    );
  }

  if (metrics.errorRate > 0.05) {
    recommendations.push(
      `High error rate (${(metrics.errorRate * 100).toFixed(1)}%) - Review common error patterns and add preventive instructions`,
    );
  }

  if (metrics.alignmentScore < 0.8) {
    recommendations.push(
      `Low alignment score (${(metrics.alignmentScore * 100).toFixed(1)}%) - Prompt may need better task specification and examples`,
    );
  }

  // Analyze common errors for specific recommendations
  const criticalErrors = metrics.commonErrors.filter((e) => e.severity === "high");
  if (criticalErrors.length > 0) {
    recommendations.push(
      `Critical errors detected: ${criticalErrors.map((e) => e.error).join(", ")} - Address these immediately`,
    );
  }

  const highFrequencyErrors = metrics.commonErrors.filter(
    (e) => e.count > metrics.sampleSize * 0.1,
  );
  if (highFrequencyErrors.length > 0) {
    recommendations.push(
      `Frequent errors (>10% of sessions): Consider adding specific guidance to prevent these patterns`,
    );
  }

  return recommendations;
}

/**
 * Generate a comprehensive dashboard summary.
 */
export async function generateDashboardSummary(workspaceDir: string): Promise<{
  filePath: string;
  summary: {
    totalPrompts: number;
    healthyPrompts: number;
    criticalIssues: number;
    activeExperiments: number;
    overallHealth: "healthy" | "warning" | "critical";
  };
}> {
  const report = await generateHealthReport("week");

  const healthyPrompts = report.leaderboard.filter((p) => p.status === "🟢 Good").length;
  const criticalIssues = report.criticalIssues.filter((i) => i.severity === "critical").length;

  const experiments = await loadExperimentRegistry();
  const activeExperiments = Object.values(experiments).filter((e) => e.status === "active").length;

  // Determine overall health
  let overallHealth: "healthy" | "warning" | "critical";
  if (criticalIssues > 0) {
    overallHealth = "critical";
  } else if (
    report.summary.overallSuccessRate < 0.9 ||
    report.leaderboard.filter((p) => p.status === "🔴 Needs Work").length > 0
  ) {
    overallHealth = "warning";
  } else {
    overallHealth = "healthy";
  }

  const summary = {
    totalPrompts: report.summary.totalPrompts,
    healthyPrompts,
    criticalIssues,
    activeExperiments,
    overallHealth,
  };

  // Create dashboard markdown
  const dashboardContent = [
    `# Prompt Health Dashboard`,
    "",
    `**Last Updated:** ${new Date().toLocaleString()}`,
    "",
    `## Overall Health: ${overallHealth === "healthy" ? "🟢 Healthy" : overallHealth === "warning" ? "🟡 Warning" : "🔴 Critical"}`,
    "",
    `| Metric | Value |`,
    `|--------|-------|`,
    `| Total Prompts | ${summary.totalPrompts} |`,
    `| Healthy Prompts | ${summary.healthyPrompts} |`,
    `| Critical Issues | ${summary.criticalIssues} |`,
    `| Active A/B Tests | ${summary.activeExperiments} |`,
    `| Overall Success Rate | ${(report.summary.overallSuccessRate * 100).toFixed(1)}% |`,
    "",
    `## Quick Actions`,
    "",
  ];

  if (criticalIssues > 0) {
    dashboardContent.push(`- 🚨 **Address ${criticalIssues} critical issues immediately**`);
  }

  if (activeExperiments > 0) {
    dashboardContent.push(`- 🧪 **Monitor ${activeExperiments} active A/B tests**`);
  }

  const needsWorkPrompts = report.leaderboard.filter((p) => p.status === "🔴 Needs Work").length;
  if (needsWorkPrompts > 0) {
    dashboardContent.push(`- 🔧 **Review ${needsWorkPrompts} prompts that need work**`);
  }

  dashboardContent.push(
    "",
    `## Recent Health Report`,
    "",
    `See full report: [Latest Weekly Report](./memory/prompt-health-${new Date().getFullYear()}-W${Math.ceil((Date.now() - new Date(new Date().getFullYear(), 0, 1).getTime()) / (7 * 24 * 60 * 60 * 1000))}.md)`,
  );

  const memoryDir = path.join(workspaceDir, "memory");
  await fs.mkdir(memoryDir, { recursive: true });

  const fileName = "prompt-dashboard.md";
  const filePath = path.join(memoryDir, fileName);

  await fs.writeFile(filePath, dashboardContent.join("\n"), "utf-8");

  return { filePath, summary };
}
