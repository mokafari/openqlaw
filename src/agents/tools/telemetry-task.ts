/**
 * Telemetry Task Wrapper - Token Budget Enforcement
 *
 * Provides controlled task spawning with hard token limits for telemetry operations.
 * Prevents runaway analysis tasks through:
 * - Hard-coded 2000 token max per task
 * - Keyword validation (blocks analysis-heavy terms)
 * - Pre-defined templates for common operations
 * - Type-safe task definitions
 */

import { sessions_spawn } from "../index";

export interface TelemetryTaskConfig {
  name: string;
  description: string;
  maxTokens?: number;
  tags?: string[];
}

export interface TelemetryTask {
  readonly taskType: "telemetry";
  readonly maxTokens: 2000; // Hard-coded limit
  readonly name: string;
  readonly description: string;
  readonly template: string;
}

// Validation keywords that indicate analysis-heavy tasks (blocked)
const ANALYSIS_KEYWORDS = [
  "comprehensive",
  "analysis",
  "detailed",
  "report",
  "examine",
  "investigate",
  "explore",
  "analyze",
  "compare",
  "evaluate",
  "review",
  "audit",
  "statistics",
  "summary",
  "overview",
  "ml",
  "learning",
  "pattern",
  "insight",
];

/**
 * Validate task description to prevent analysis-heavy telemetry tasks
 */
function validateTaskDescription(description: string): { valid: boolean; reason?: string } {
  const lower = description.toLowerCase();
  for (const keyword of ANALYSIS_KEYWORDS) {
    if (lower.includes(keyword)) {
      return {
        valid: false,
        reason: `Description contains analysis keyword: "${keyword}"`,
      };
    }
  }
  return { valid: true };
}

/**
 * Predefined telemetry task templates (all <500 tokens when executed)
 */
export const TELEMETRY_TEMPLATES = {
  healthProbe: (target: string): TelemetryTask => ({
    taskType: "telemetry",
    maxTokens: 2000,
    name: "health-probe",
    description: `Quick health check for ${target}: DNS resolution, TCP connection, response time, error rate`,
    template: `Run health check against ${target}. Collect: endpoint status, response time (ms), error count, last 10 errors. Output JSON.`,
  }),

  logCollection: (source: string, lines: number = 100): TelemetryTask => ({
    taskType: "telemetry",
    maxTokens: 2000,
    name: "log-collection",
    description: `Collect last ${lines} lines from ${source}`,
    template: `Read last ${lines} lines from ${source}. Parse error/warning/info counts. Output JSON: {source, total_lines, error_count, warning_count, info_count}`,
  }),

  metricsSnapshot: (): TelemetryTask => ({
    taskType: "telemetry",
    maxTokens: 2000,
    name: "metrics-snapshot",
    description: "Snapshot system metrics (CPU, memory, disk, network)",
    template:
      "Collect current system metrics via system tools. Output JSON: {cpu_percent, memory_mb, disk_percent, network_io}",
  }),

  serviceStatus: (services: string[]): TelemetryTask => ({
    taskType: "telemetry",
    maxTokens: 2000,
    name: "service-status",
    description: `Check status of services: ${services.join(", ")}`,
    template: `Check process status for: ${services.join(", ")}. For each, output: name, running (bool), pid (if running), uptime_seconds`,
  }),

  sessionStats: (): TelemetryTask => ({
    taskType: "telemetry",
    maxTokens: 2000,
    name: "session-stats",
    description: "Quick session statistics (count, success rate, avg tokens)",
    template:
      "Count active sessions, calculate success rate from last 100 sessions, compute average tokens. Output JSON: {total_sessions, success_rate, avg_tokens}",
  }),

  cacheMetrics: (): TelemetryTask => ({
    taskType: "telemetry",
    maxTokens: 2000,
    name: "cache-metrics",
    description: "Cache hit rate and eviction metrics",
    template:
      "Query cache stats: hit_count, miss_count, eviction_count. Calculate hit_rate = hits/(hits+misses). Output JSON.",
  }),

  errorTally: (timeWindow: string = "1h"): TelemetryTask => ({
    taskType: "telemetry",
    maxTokens: 2000,
    name: "error-tally",
    description: `Count errors in last ${timeWindow}`,
    template: `Count errors from last ${timeWindow}. Group by type and severity. Output JSON: {total_errors, by_type: {}, by_severity: {}}`,
  }),
};

/**
 * Main API for spawning controlled telemetry tasks
 */
export class TelemetryTaskAPI {
  /**
   * Spawn a telemetry task with token budget enforcement
   */
  static async spawn(task: TelemetryTask, timeoutSeconds: number = 60): Promise<any> {
    return sessions_spawn({
      task: task.template,
      label: task.name,
      runTimeoutSeconds: timeoutSeconds,
      model: "claude-haiku-4-5", // Use fast model for quick telemetry
      cleanup: "keep",
    });
  }

  /**
   * Health check for a target (HTTP endpoint, host, service)
   */
  static async healthProbe(name: string, target: string): Promise<any> {
    const task = TELEMETRY_TEMPLATES.healthProbe(target);
    return this.spawn(task);
  }

  /**
   * Collect logs from a source file
   */
  static async collectLogs(name: string, source: string, lines: number = 100): Promise<any> {
    const task = TELEMETRY_TEMPLATES.logCollection(source, lines);
    return this.spawn(task);
  }

  /**
   * Get system metrics snapshot
   */
  static async metricsSnapshot(name: string): Promise<any> {
    const task = TELEMETRY_TEMPLATES.metricsSnapshot();
    return this.spawn(task);
  }

  /**
   * Check service status
   */
  static async serviceStatus(name: string, services: string[]): Promise<any> {
    const task = TELEMETRY_TEMPLATES.serviceStatus(services);
    return this.spawn(task);
  }

  /**
   * Get quick session statistics
   */
  static async sessionStats(name: string): Promise<any> {
    const task = TELEMETRY_TEMPLATES.sessionStats();
    return this.spawn(task);
  }

  /**
   * Get cache hit rate metrics
   */
  static async cacheMetrics(name: string): Promise<any> {
    const task = TELEMETRY_TEMPLATES.cacheMetrics();
    return this.spawn(task);
  }

  /**
   * Tally errors in time window
   */
  static async errorTally(name: string, timeWindow: string = "1h"): Promise<any> {
    const task = TELEMETRY_TEMPLATES.errorTally(timeWindow);
    return this.spawn(task);
  }

  /**
   * Custom telemetry task with validation
   */
  static async custom(config: TelemetryTaskConfig): Promise<any> {
    const validation = validateTaskDescription(config.description);
    if (!validation.valid) {
      throw new Error(`Task validation failed: ${validation.reason}`);
    }

    const task: TelemetryTask = {
      taskType: "telemetry",
      maxTokens: 2000,
      name: config.name,
      description: config.description,
      template: config.description,
    };

    return this.spawn(task, 30);
  }
}

export default TelemetryTaskAPI;
