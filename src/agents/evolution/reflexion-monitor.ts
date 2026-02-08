/**
 * Reflexion monitoring for heartbeat integration
 */

import { logDebug } from "../../logger.js";
import { getReflexionSystem } from "./reflexion.js";

export type ReflexionStatusReport = {
  totalEpisodes: number;
  failureRate: number;
  averageHeuristic: number;
  needsReflection: number;
  alert?: {
    severity: "warning" | "critical";
    message: string;
  };
  recentPatterns: string[];
  topFailingTools: Array<{ tool: string; rate: number }>;
};

/**
 * Check reflexion status for heartbeat monitoring.
 * Returns current failure patterns and alerts if thresholds are exceeded.
 */
export async function checkReflexionStatus(workspaceDir?: string): Promise<ReflexionStatusReport> {
  try {
    const reflexion = getReflexionSystem(workspaceDir);

    // Get failure pattern analysis
    const analysis = await reflexion.analyzeFailurePatterns();

    // Check episodes needing reflection
    const needsReflection = reflexion.getEpisodesNeedingReflection();

    // Extract recent patterns from lessons
    const recentPatterns = analysis.lessonsExtracted.slice(-5);

    // Get top failing tools
    const topFailingTools = Object.entries(analysis.toolFailureRates)
      .map(([tool, rate]) => ({ tool, rate }))
      .sort((a, b) => b.rate - a.rate)
      .slice(0, 5);

    // Generate alert if thresholds exceeded
    let alert: ReflexionStatusReport["alert"];

    if (analysis.failureRate > 0.4) {
      alert = {
        severity: "critical",
        message: `Critical failure rate: ${(analysis.failureRate * 100).toFixed(1)}%`,
      };
    } else if (analysis.failureRate > 0.2) {
      alert = {
        severity: "warning",
        message: `High failure rate: ${(analysis.failureRate * 100).toFixed(1)}%`,
      };
    } else if (analysis.averageHeuristic < 0.5) {
      alert = {
        severity: "warning",
        message: `Low efficiency: ${(analysis.averageHeuristic * 100).toFixed(1)}% avg heuristic`,
      };
    }

    const report: ReflexionStatusReport = {
      totalEpisodes: analysis.totalEpisodes,
      failureRate: analysis.failureRate,
      averageHeuristic: analysis.averageHeuristic,
      needsReflection: needsReflection.length,
      alert,
      recentPatterns,
      topFailingTools,
    };

    return report;
  } catch (err) {
    logDebug(`[reflexion] Failed to check status: ${String(err)}`);

    return {
      totalEpisodes: 0,
      failureRate: 0,
      averageHeuristic: 0,
      needsReflection: 0,
      recentPatterns: [],
      topFailingTools: [],
    };
  }
}

/**
 * Generate reflexion insights for system prompts or diagnostic context.
 * Returns recent lessons and improvement suggestions.
 */
export async function getReflexionInsights(workspaceDir?: string): Promise<{
  lessons: string[];
  suggestions: string[];
  criticalPatterns: string[];
}> {
  try {
    const reflexion = getReflexionSystem(workspaceDir);

    const analysis = await reflexion.analyzeFailurePatterns();
    const suggestions = await reflexion.generateImprovementSuggestions();

    // Extract critical patterns from high-rate tool failures
    const criticalPatterns = Object.entries(analysis.toolFailureRates)
      .filter(([_, rate]) => rate > 0.3)
      .map(([tool, rate]) => `${tool}: ${(rate * 100).toFixed(1)}% failure rate`);

    return {
      lessons: analysis.lessonsExtracted.slice(-10),
      suggestions: suggestions.slice(0, 8),
      criticalPatterns,
    };
  } catch (err) {
    logDebug(`[reflexion] Failed to get insights: ${String(err)}`);
    return {
      lessons: [],
      suggestions: [],
      criticalPatterns: [],
    };
  }
}

/**
 * Format reflexion status for heartbeat display.
 */
export function formatReflexionStatus(report: ReflexionStatusReport): string {
  const lines: string[] = [];

  lines.push(`**Reflexion Status**`);
  lines.push(
    `Episodes: ${report.totalEpisodes} | Failure rate: ${(report.failureRate * 100).toFixed(1)}% | Avg heuristic: ${(report.averageHeuristic * 100).toFixed(1)}%`,
  );

  if (report.alert) {
    const emoji = report.alert.severity === "critical" ? "🚨" : "⚠️";
    lines.push(`${emoji} **${report.alert.message}**`);
  }

  if (report.needsReflection > 0) {
    lines.push(`💭 ${report.needsReflection} episodes need reflection`);
  }

  if (report.recentPatterns.length > 0) {
    lines.push(`🎯 Recent patterns: ${report.recentPatterns.slice(0, 3).join("; ")}`);
  }

  if (report.topFailingTools.length > 0) {
    const topTool = report.topFailingTools[0];
    if (topTool.rate > 0.2) {
      lines.push(`🔧 Top failing tool: ${topTool.tool} (${(topTool.rate * 100).toFixed(1)}%)`);
    }
  }

  return lines.join("\n");
}
