/**
 * Performance Metrics Module
 * Tracks latency, throughput, and resource usage for optimization analysis.
 *
 * @module performance-metrics
 */

export interface PerformanceMetrics {
  messageLatency: Map<string, number[]>;
  toolExecutionTime: Map<string, number[]>;
  subAgentSpawnTime: number[];
  queueWaitTime: number[];
  cacheHits: { route: number; session: number; binding: number };
  cacheMisses: { route: number; session: number; binding: number };
}

const MAX_SAMPLES = 100;

const metrics: PerformanceMetrics = {
  messageLatency: new Map(),
  toolExecutionTime: new Map(),
  subAgentSpawnTime: [],
  queueWaitTime: [],
  cacheHits: { route: 0, session: 0, binding: 0 },
  cacheMisses: { route: 0, session: 0, binding: 0 },
};

function addSample(arr: number[], value: number): void {
  arr.push(value);
  if (arr.length > MAX_SAMPLES) {
    arr.shift();
  }
}

export function recordMessageLatency(channel: string, latencyMs: number): void {
  if (!metrics.messageLatency.has(channel)) {
    metrics.messageLatency.set(channel, []);
  }
  addSample(metrics.messageLatency.get(channel)!, latencyMs);
}

export function recordToolExecution(toolName: string, durationMs: number): void {
  if (!metrics.toolExecutionTime.has(toolName)) {
    metrics.toolExecutionTime.set(toolName, []);
  }
  addSample(metrics.toolExecutionTime.get(toolName)!, durationMs);
}

export function recordSubAgentSpawn(durationMs: number): void {
  addSample(metrics.subAgentSpawnTime, durationMs);
}

export function recordQueueWait(durationMs: number): void {
  addSample(metrics.queueWaitTime, durationMs);
}

export function recordCacheHit(cache: "route" | "session" | "binding"): void {
  metrics.cacheHits[cache]++;
}

export function recordCacheMiss(cache: "route" | "session" | "binding"): void {
  metrics.cacheMisses[cache]++;
}

function calculateStats(samples: number[]): { avg: number; p50: number; p95: number; p99: number } {
  if (samples.length === 0) {
    return { avg: 0, p50: 0, p95: 0, p99: 0 };
  }
  const sorted = [...samples].sort((a, b) => a - b);
  const avg = sorted.reduce((a, b) => a + b, 0) / sorted.length;
  const p50 = sorted[Math.floor(sorted.length * 0.5)];
  const p95 = sorted[Math.floor(sorted.length * 0.95)];
  const p99 = sorted[Math.floor(sorted.length * 0.99)];
  return { avg: Math.round(avg), p50, p95, p99 };
}

export function getPerformanceStats(): {
  messageLatency: Record<string, { avg: number; p50: number; p95: number; p99: number }>;
  toolExecution: Record<string, { avg: number; p50: number; p95: number; p99: number }>;
  subAgentSpawn: { avg: number; p50: number; p95: number; p99: number };
  queueWait: { avg: number; p50: number; p95: number; p99: number };
  cacheHitRate: { route: number; session: number; binding: number };
} {
  const messageLatency: Record<string, ReturnType<typeof calculateStats>> = {};
  for (const [channel, samples] of metrics.messageLatency) {
    messageLatency[channel] = calculateStats(samples);
  }

  const toolExecution: Record<string, ReturnType<typeof calculateStats>> = {};
  for (const [tool, samples] of metrics.toolExecutionTime) {
    toolExecution[tool] = calculateStats(samples);
  }

  const getCacheHitRate = (cache: "route" | "session" | "binding"): number => {
    const total = metrics.cacheHits[cache] + metrics.cacheMisses[cache];
    return total > 0 ? Math.round((metrics.cacheHits[cache] / total) * 100) : 0;
  };

  return {
    messageLatency,
    toolExecution,
    subAgentSpawn: calculateStats(metrics.subAgentSpawnTime),
    queueWait: calculateStats(metrics.queueWaitTime),
    cacheHitRate: {
      route: getCacheHitRate("route"),
      session: getCacheHitRate("session"),
      binding: getCacheHitRate("binding"),
    },
  };
}

export function resetMetrics(): void {
  metrics.messageLatency.clear();
  metrics.toolExecutionTime.clear();
  metrics.subAgentSpawnTime.length = 0;
  metrics.queueWaitTime.length = 0;
  metrics.cacheHits = { route: 0, session: 0, binding: 0 };
  metrics.cacheMisses = { route: 0, session: 0, binding: 0 };
}

export function getMetricsSummary(): string {
  const stats = getPerformanceStats();
  const lines: string[] = [
    "=== Performance Metrics ===",
    "",
    "Cache Hit Rates:",
    `  Route: ${stats.cacheHitRate.route}%`,
    `  Session: ${stats.cacheHitRate.session}%`,
    `  Binding: ${stats.cacheHitRate.binding}%`,
    "",
    "Sub-Agent Spawn (ms):",
    `  Avg: ${stats.subAgentSpawn.avg}, P95: ${stats.subAgentSpawn.p95}`,
    "",
    "Queue Wait (ms):",
    `  Avg: ${stats.queueWait.avg}, P95: ${stats.queueWait.p95}`,
  ];

  if (Object.keys(stats.messageLatency).length > 0) {
    lines.push("", "Message Latency by Channel:");
    for (const [channel, s] of Object.entries(stats.messageLatency)) {
      lines.push(`  ${channel}: Avg=${s.avg}ms, P95=${s.p95}ms`);
    }
  }

  return lines.join("\n");
}
