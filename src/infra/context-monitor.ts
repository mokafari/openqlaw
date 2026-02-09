/**
 * Context Monitor — Phase 2 Monitoring Infrastructure
 *
 * Monitors session context size in real-time and triggers alerts
 * when thresholds are exceeded. Supports automatic summarization
 * and context efficiency tracking.
 *
 * Created: 2026-02-08
 */

import { EventEmitter } from "node:events";
import fs from "node:fs";
import path from "node:path";
import { createSubsystemLogger } from "../logging/subsystem.js";

// ────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────

export interface ContextMetrics {
  sessionKey: string;
  tokenCount: number;
  messageCount: number;
  timestamp: number;
  thresholdExceeded: boolean;
  compressionRatio?: number;
}

export interface ContextAlert {
  sessionKey: string;
  tokenCount: number;
  threshold: number;
  severity: "warning" | "critical";
  timestamp: number;
  suggestedAction: "summarize" | "compress" | "truncate";
}

export interface ContextEfficiencyReport {
  sessionKey: string;
  startTokens: number;
  endTokens: number;
  tokensSaved: number;
  compressionRatio: number;
  summarizationDuration: number;
  timestamp: number;
}

export interface SessionContextPattern {
  sessionKey: string;
  avgTokenCount: number;
  peakTokenCount: number;
  alertCount: number;
  summarizationCount: number;
  efficiency: number; // 0-1 scale
}

export interface WeeklyContextReport {
  weekStart: string;
  weekEnd: string;
  totalSessions: number;
  sessionsExceeding80k: number;
  avgTokensPerSession: number;
  peakTokens: number;
  totalSummarizations: number;
  avgCompressionRatio: number;
  recommendations: string[];
}

// ────────────────────────────────────────────────────────────────
// Constants
// ────────────────────────────────────────────────────────────────

/** Default threshold for context alerts (80k tokens) */
export const CONTEXT_THRESHOLD_WARNING = 80_000;

/** Critical threshold (95% of context window) */
export const CONTEXT_THRESHOLD_CRITICAL = 190_000;

/** Number of recent messages to preserve during summarization */
export const PRESERVE_RECENT_MESSAGES = 20;

// ────────────────────────────────────────────────────────────────
// Context Monitor Class
// ────────────────────────────────────────────────────────────────

export class ContextMonitor extends EventEmitter {
  private readonly logger = createSubsystemLogger("context-monitor");
  private readonly metricsHistory: Map<string, ContextMetrics[]> = new Map();
  private readonly alertHistory: ContextAlert[] = [];
  private readonly efficiencyReports: ContextEfficiencyReport[] = [];
  private readonly sessionPatterns: Map<string, SessionContextPattern> = new Map();

  private warningThreshold: number;
  private criticalThreshold: number;
  private metricsDir: string;

  constructor(options?: {
    warningThreshold?: number;
    criticalThreshold?: number;
    metricsDir?: string;
  }) {
    super();
    this.warningThreshold = options?.warningThreshold ?? CONTEXT_THRESHOLD_WARNING;
    this.criticalThreshold = options?.criticalThreshold ?? CONTEXT_THRESHOLD_CRITICAL;
    this.metricsDir =
      options?.metricsDir ?? path.join(process.env.HOME ?? "/tmp", ".openclaw", "context-metrics");
    this.ensureMetricsDir();
  }

  private ensureMetricsDir(): void {
    try {
      if (!fs.existsSync(this.metricsDir)) {
        fs.mkdirSync(this.metricsDir, { recursive: true });
      }
    } catch (err) {
      this.logger.warn(`Failed to create metrics dir: ${err}`);
    }
  }

  /**
   * Record context metrics for a session
   * Emits 'threshold' event if warning/critical threshold exceeded
   */
  recordMetrics(metrics: Omit<ContextMetrics, "thresholdExceeded" | "timestamp">): ContextMetrics {
    const fullMetrics: ContextMetrics = {
      ...metrics,
      timestamp: Date.now(),
      thresholdExceeded: metrics.tokenCount >= this.warningThreshold,
    };

    // Store in history
    const history = this.metricsHistory.get(metrics.sessionKey) ?? [];
    history.push(fullMetrics);
    // Keep last 100 entries per session
    if (history.length > 100) {
      history.shift();
    }
    this.metricsHistory.set(metrics.sessionKey, history);

    // Update session pattern
    this.updateSessionPattern(metrics.sessionKey, fullMetrics);

    // Check thresholds and emit events
    if (fullMetrics.tokenCount >= this.criticalThreshold) {
      const alert = this.createAlert(fullMetrics, "critical");
      this.emit("threshold", alert);
      this.emit("critical", alert);
    } else if (fullMetrics.tokenCount >= this.warningThreshold) {
      const alert = this.createAlert(fullMetrics, "warning");
      this.emit("threshold", alert);
      this.emit("warning", alert);
    }

    return fullMetrics;
  }

  private createAlert(metrics: ContextMetrics, severity: "warning" | "critical"): ContextAlert {
    const alert: ContextAlert = {
      sessionKey: metrics.sessionKey,
      tokenCount: metrics.tokenCount,
      threshold: severity === "critical" ? this.criticalThreshold : this.warningThreshold,
      severity,
      timestamp: Date.now(),
      suggestedAction: severity === "critical" ? "truncate" : "summarize",
    };

    this.alertHistory.push(alert);
    this.logger.info(
      `Context alert [${severity}]: ${metrics.sessionKey} at ${metrics.tokenCount} tokens`,
    );

    return alert;
  }

  private updateSessionPattern(sessionKey: string, metrics: ContextMetrics): void {
    const existing = this.sessionPatterns.get(sessionKey) ?? {
      sessionKey,
      avgTokenCount: 0,
      peakTokenCount: 0,
      alertCount: 0,
      summarizationCount: 0,
      efficiency: 1.0,
    };

    const history = this.metricsHistory.get(sessionKey) ?? [];
    const totalTokens = history.reduce((sum, m) => sum + m.tokenCount, 0);
    existing.avgTokenCount = history.length > 0 ? totalTokens / history.length : 0;
    existing.peakTokenCount = Math.max(existing.peakTokenCount, metrics.tokenCount);

    if (metrics.thresholdExceeded) {
      existing.alertCount += 1;
    }

    this.sessionPatterns.set(sessionKey, existing);
  }

  /**
   * Record summarization efficiency metrics
   */
  recordSummarizationComplete(report: Omit<ContextEfficiencyReport, "timestamp">): void {
    const fullReport: ContextEfficiencyReport = {
      ...report,
      timestamp: Date.now(),
    };

    this.efficiencyReports.push(fullReport);

    // Update session pattern
    const pattern = this.sessionPatterns.get(report.sessionKey);
    if (pattern) {
      pattern.summarizationCount += 1;
      pattern.efficiency = report.compressionRatio;
      this.sessionPatterns.set(report.sessionKey, pattern);
    }

    this.emit("summarizationComplete", fullReport);
    this.logger.info(
      `Summarization complete: ${report.sessionKey} saved ${report.tokensSaved} tokens ` +
        `(${(report.compressionRatio * 100).toFixed(1)}% compression)`,
    );
  }

  /**
   * Record session end metrics for analysis
   */
  recordSessionEnd(sessionKey: string, finalTokenCount: number): void {
    const pattern = this.sessionPatterns.get(sessionKey);
    const history = this.metricsHistory.get(sessionKey) ?? [];

    const sessionMetrics = {
      sessionKey,
      finalTokenCount,
      peakTokenCount: pattern?.peakTokenCount ?? finalTokenCount,
      alertCount: pattern?.alertCount ?? 0,
      summarizationCount: pattern?.summarizationCount ?? 0,
      messageCount: history.length,
      avgTokenCount: pattern?.avgTokenCount ?? finalTokenCount,
    };

    this.emit("sessionEnd", sessionMetrics);
    this.logger.debug(`Session ended: ${sessionKey} with ${finalTokenCount} final tokens`);

    // Persist to disk for weekly analysis
    this.persistSessionMetrics(sessionMetrics);
  }

  private persistSessionMetrics(metrics: Record<string, unknown>): void {
    try {
      const today = new Date().toISOString().split("T")[0];
      const filePath = path.join(this.metricsDir, `${today}.jsonl`);
      const line = JSON.stringify({ ...metrics, timestamp: Date.now() }) + "\n";
      fs.appendFileSync(filePath, line);
    } catch (err) {
      this.logger.warn(`Failed to persist session metrics: ${err}`);
    }
  }

  /**
   * Generate weekly context efficiency report
   */
  async generateWeeklyReport(): Promise<WeeklyContextReport> {
    const now = new Date();
    const weekStart = new Date(now);
    weekStart.setDate(weekStart.getDate() - 7);

    const weeklyMetrics = await this.loadWeeklyMetrics(weekStart, now);

    const sessionsExceeding80k = weeklyMetrics.filter(
      (m) => (m.peakTokenCount ?? 0) >= this.warningThreshold,
    ).length;

    const totalTokens = weeklyMetrics.reduce((sum, m) => sum + (m.avgTokenCount ?? 0), 0);
    const avgTokens = weeklyMetrics.length > 0 ? totalTokens / weeklyMetrics.length : 0;

    const peakTokens = Math.max(...weeklyMetrics.map((m) => m.peakTokenCount ?? 0), 0);

    const totalSummarizations = weeklyMetrics.reduce(
      (sum, m) => sum + (m.summarizationCount ?? 0),
      0,
    );

    const efficiencyReportsThisWeek = this.efficiencyReports.filter(
      (r) => r.timestamp >= weekStart.getTime(),
    );
    const avgCompression =
      efficiencyReportsThisWeek.length > 0
        ? efficiencyReportsThisWeek.reduce((sum, r) => sum + r.compressionRatio, 0) /
          efficiencyReportsThisWeek.length
        : 0;

    const recommendations = this.generateRecommendations({
      sessionsExceeding80k,
      totalSessions: weeklyMetrics.length,
      avgTokens,
      avgCompression,
    });

    return {
      weekStart: weekStart.toISOString().split("T")[0],
      weekEnd: now.toISOString().split("T")[0],
      totalSessions: weeklyMetrics.length,
      sessionsExceeding80k,
      avgTokensPerSession: Math.round(avgTokens),
      peakTokens,
      totalSummarizations,
      avgCompressionRatio: avgCompression,
      recommendations,
    };
  }

  private async loadWeeklyMetrics(start: Date, end: Date): Promise<Array<Record<string, number>>> {
    const metrics: Array<Record<string, number>> = [];

    try {
      const files = await fs.promises.readdir(this.metricsDir);
      for (const file of files) {
        if (!file.endsWith(".jsonl")) continue;

        const dateStr = file.replace(".jsonl", "");
        const fileDate = new Date(dateStr);
        if (fileDate >= start && fileDate <= end) {
          const content = await fs.promises.readFile(path.join(this.metricsDir, file), "utf-8");
          for (const line of content.split("\n")) {
            if (!line.trim()) continue;
            try {
              metrics.push(JSON.parse(line));
            } catch {
              // Skip malformed lines
            }
          }
        }
      }
    } catch {
      // Directory may not exist yet
    }

    return metrics;
  }

  private generateRecommendations(data: {
    sessionsExceeding80k: number;
    totalSessions: number;
    avgTokens: number;
    avgCompression: number;
  }): string[] {
    const recommendations: string[] = [];

    const exceedingRatio =
      data.totalSessions > 0 ? data.sessionsExceeding80k / data.totalSessions : 0;

    if (exceedingRatio > 0.3) {
      recommendations.push(
        "High rate of sessions exceeding 80k tokens. Consider enabling aggressive summarization.",
      );
    }

    if (data.avgTokens > 60_000) {
      recommendations.push(
        "Average token usage is high. Consider implementing selective history compression.",
      );
    }

    if (data.avgCompression < 0.4 && data.avgCompression > 0) {
      recommendations.push(
        "Summarization efficiency is low. Review summarization strategies for improvement.",
      );
    }

    if (recommendations.length === 0) {
      recommendations.push("Context usage is within optimal parameters. No action needed.");
    }

    return recommendations;
  }

  /**
   * Get current metrics for a session
   */
  getSessionMetrics(sessionKey: string): ContextMetrics[] {
    return this.metricsHistory.get(sessionKey) ?? [];
  }

  /**
   * Get session pattern analysis
   */
  getSessionPattern(sessionKey: string): SessionContextPattern | undefined {
    return this.sessionPatterns.get(sessionKey);
  }

  /**
   * Get all alerts for analysis
   */
  getAlerts(since?: number): ContextAlert[] {
    if (!since) return [...this.alertHistory];
    return this.alertHistory.filter((a) => a.timestamp >= since);
  }

  /**
   * Clear metrics for a session (on reset)
   */
  clearSession(sessionKey: string): void {
    this.metricsHistory.delete(sessionKey);
    this.sessionPatterns.delete(sessionKey);
  }

  /**
   * Get thresholds
   */
  getThresholds(): { warning: number; critical: number } {
    return {
      warning: this.warningThreshold,
      critical: this.criticalThreshold,
    };
  }
}

// ────────────────────────────────────────────────────────────────
// Singleton Instance
// ────────────────────────────────────────────────────────────────

let contextMonitor: ContextMonitor | null = null;

export function getContextMonitor(): ContextMonitor {
  if (!contextMonitor) {
    contextMonitor = new ContextMonitor();
  }
  return contextMonitor;
}

export function resetContextMonitor(): void {
  contextMonitor = null;
}
