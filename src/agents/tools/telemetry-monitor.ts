/**
 * Telemetry Monitoring Dashboard
 *
 * Real-time metrics aggregation and anomaly detection
 * Feeds into monitoring cron jobs and alert systems
 */

import fs from "fs";
import path from "path";

export interface Metric {
  timestamp: number;
  timestamp_iso: string;
  metrics: {
    total_sessions: number;
    successful_sessions: number;
    failed_sessions: number;
    success_rate: number;
    estimated_tokens: number;
    tool_calls: number;
    errors: number;
    avg_duration_ms: number;
    model_distribution: Record<string, number>;
  };
  anomalies: string[];
  is_anomalous: boolean;
  collection_window: string;
}

export interface AnomalyThresholds {
  successRate: number; // Alert if below this %
  tokenBudget: number; // Alert if above this tokens
  errorCount: number; // Alert if above this count
  avgDuration: number; // Alert if above this ms
}

const DEFAULT_THRESHOLDS: AnomalyThresholds = {
  successRate: 90, // Alert if <90% success
  tokenBudget: 100000, // Alert if >100k avg tokens
  errorCount: 10, // Alert if >10 errors
  avgDuration: 60000, // Alert if >60s avg duration
};

/**
 * Monitor class for telemetry aggregation and anomaly detection
 */
export class TelemetryMonitor {
  private metricsPath: string;
  private metrics: Metric[] = [];
  private thresholds: AnomalyThresholds;

  constructor(
    metricsPath: string = "/Users/gustav/.openclaw/workspace/data/telemetry/metrics.jsonl",
  ) {
    this.metricsPath = metricsPath;
    this.thresholds = DEFAULT_THRESHOLDS;
  }

  /**
   * Load metrics from JSONL file
   */
  async loadMetrics(): Promise<Metric[]> {
    try {
      const content = fs.readFileSync(this.metricsPath, "utf-8");
      this.metrics = content
        .trim()
        .split("\n")
        .filter((line) => line.trim())
        .map((line, idx) => {
          try {
            return JSON.parse(line);
          } catch (e) {
            console.warn(
              `Warning: Could not parse metric line ${idx}: ${line.substring(0, 50)}...`,
            );
            return null;
          }
        })
        .filter((m): m is Metric => m !== null);

      return this.metrics;
    } catch (error) {
      console.error("Failed to load metrics:", error);
      return [];
    }
  }

  /**
   * Get latest N metrics
   */
  getLatest(count: number = 10): Metric[] {
    return this.metrics.slice(-count).reverse();
  }

  /**
   * Get metrics within time window (seconds)
   */
  getWindow(seconds: number): Metric[] {
    const now = Math.floor(Date.now() / 1000);
    const cutoff = now - seconds;
    return this.metrics.filter((m) => m.timestamp >= cutoff);
  }

  /**
   * Calculate aggregate stats over time window
   */
  getStats(seconds: number = 3600): {
    avgSuccessRate: number;
    avgTokens: number;
    totalErrors: number;
    totalSessions: number;
  } {
    const windowMetrics = this.getWindow(seconds);

    if (windowMetrics.length === 0) {
      return { avgSuccessRate: 0, avgTokens: 0, totalErrors: 0, totalSessions: 0 };
    }

    const avgSuccessRate =
      windowMetrics.reduce((sum, m) => sum + m.metrics.success_rate, 0) / windowMetrics.length;
    const avgTokens =
      windowMetrics.reduce((sum, m) => sum + m.metrics.estimated_tokens, 0) / windowMetrics.length;
    const totalErrors = windowMetrics.reduce((sum, m) => sum + m.metrics.errors, 0);
    const totalSessions = windowMetrics.reduce((sum, m) => sum + m.metrics.total_sessions, 0);

    return { avgSuccessRate, avgTokens, totalErrors, totalSessions };
  }

  /**
   * Detect anomalies in latest metric
   */
  detectAnomalies(metric: Metric): string[] {
    const anomalies: string[] = [];

    if (metric.metrics.success_rate < this.thresholds.successRate) {
      anomalies.push(
        `low_success_rate: ${metric.metrics.success_rate.toFixed(1)}% < ${this.thresholds.successRate}%`,
      );
    }

    if (metric.metrics.estimated_tokens > this.thresholds.tokenBudget) {
      anomalies.push(
        `high_token_usage: ${metric.metrics.estimated_tokens} > ${this.thresholds.tokenBudget}`,
      );
    }

    if (metric.metrics.errors > this.thresholds.errorCount) {
      anomalies.push(`high_error_rate: ${metric.metrics.errors} > ${this.thresholds.errorCount}`);
    }

    if (metric.metrics.avg_duration_ms > this.thresholds.avgDuration) {
      anomalies.push(
        `slow_execution: ${metric.metrics.avg_duration_ms}ms > ${this.thresholds.avgDuration}ms`,
      );
    }

    return anomalies;
  }

  /**
   * Generate HTML dashboard for visualization
   */
  generateDashboard(): string {
    const latest = this.getLatest(20);
    const stats1h = this.getStats(3600);
    const stats24h = this.getStats(86400);

    const rows = latest
      .map(
        (m) => `
      <tr>
        <td>${new Date(m.timestamp * 1000).toLocaleString()}</td>
        <td>${m.metrics.total_sessions}</td>
        <td>${m.metrics.success_rate.toFixed(1)}%</td>
        <td>${(m.metrics.estimated_tokens / 1000).toFixed(0)}k</td>
        <td>${m.metrics.errors}</td>
        <td>${m.is_anomalous ? "⚠️" : "✓"}</td>
      </tr>
    `,
      )
      .join("\n");

    return `
<!DOCTYPE html>
<html>
<head>
  <title>Telemetry Dashboard</title>
  <style>
    body { font-family: monospace; margin: 20px; background: #f5f5f5; }
    h1 { color: #333; }
    .stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin: 20px 0; }
    .stat-box { background: white; padding: 15px; border-radius: 5px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
    .stat-label { font-size: 0.8em; color: #666; }
    .stat-value { font-size: 1.5em; font-weight: bold; color: #333; }
    table { background: white; border-collapse: collapse; width: 100%; margin: 20px 0; }
    th, td { padding: 10px; text-align: left; border-bottom: 1px solid #ddd; }
    th { background: #f5f5f5; font-weight: bold; }
    tr:hover { background: #f9f9f9; }
    .anomaly { color: #d9534f; }
    .ok { color: #5cb85c; }
    .status-ok { background: #d4edda; }
    .status-warning { background: #fff3cd; }
    .status-alert { background: #f8d7da; }
  </style>
</head>
<body>
  <h1>📊 Telemetry Monitoring Dashboard</h1>
  <p>Last updated: ${new Date().toLocaleString()}</p>

  <div class="stats">
    <div class="stat-box">
      <div class="stat-label">1h Avg Success Rate</div>
      <div class="stat-value">${stats1h.avgSuccessRate.toFixed(1)}%</div>
    </div>
    <div class="stat-box">
      <div class="stat-label">1h Avg Tokens</div>
      <div class="stat-value">${(stats1h.avgTokens / 1000).toFixed(0)}k</div>
    </div>
    <div class="stat-box">
      <div class="stat-label">1h Total Errors</div>
      <div class="stat-value ${stats1h.totalErrors > 10 ? "anomaly" : "ok"}">${stats1h.totalErrors}</div>
    </div>
    <div class="stat-box">
      <div class="stat-label">24h Sessions</div>
      <div class="stat-value">${stats24h.totalSessions}</div>
    </div>
  </div>

  <h2>Latest Metrics (20)</h2>
  <table>
    <thead>
      <tr>
        <th>Timestamp</th>
        <th>Sessions</th>
        <th>Success Rate</th>
        <th>Tokens</th>
        <th>Errors</th>
        <th>Status</th>
      </tr>
    </thead>
    <tbody>
      ${rows}
    </tbody>
  </table>

  <h2>Anomaly Detection Rules</h2>
  <ul>
    <li>🔴 Success Rate < ${this.thresholds.successRate}%</li>
    <li>🟡 Tokens > ${this.thresholds.tokenBudget.toLocaleString()}</li>
    <li>🟠 Errors > ${this.thresholds.errorCount}</li>
    <li>🟣 Avg Duration > ${this.thresholds.avgDuration}ms</li>
  </ul>

  <script>
    // Auto-refresh every 30 seconds
    setTimeout(() => location.reload(), 30000);
  </script>
</body>
</html>
    `;
  }

  /**
   * Export metrics as CSV
   */
  exportCSV(): string {
    const headers = [
      "timestamp",
      "iso_time",
      "sessions",
      "success_rate",
      "tokens",
      "errors",
      "duration_ms",
      "anomalies",
    ];
    const rows = this.metrics.map((m) =>
      [
        m.timestamp,
        m.timestamp_iso,
        m.metrics.total_sessions,
        m.metrics.success_rate.toFixed(2),
        m.metrics.estimated_tokens,
        m.metrics.errors,
        m.metrics.avg_duration_ms,
        m.anomalies.join("|"),
      ].join(","),
    );

    return [headers.join(","), ...rows].join("\n");
  }

  /**
   * Set custom thresholds
   */
  setThresholds(thresholds: Partial<AnomalyThresholds>) {
    this.thresholds = { ...this.thresholds, ...thresholds };
  }
}

export default TelemetryMonitor;
