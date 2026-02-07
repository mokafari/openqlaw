/**
 * Performance Profiling Tools
 *
 * Provides comprehensive performance monitoring with:
 * - Track time per tool call
 * - Memory usage tracking
 * - Identify slow operations
 * - Generate performance reports
 *
 * Enables data-driven optimization of agent operations.
 */

import { promises as fs } from "fs";
import path from "path";
import { resolveStateDir } from "../../config/paths.js";

// ============================================================================
// Types
// ============================================================================

export interface ToolCallProfile {
  toolName: string;
  startTime: number;
  endTime: number;
  durationMs: number;
  success: boolean;
  error?: string;
  memoryBefore?: MemorySnapshot;
  memoryAfter?: MemorySnapshot;
  params?: Record<string, unknown>;
  resultSize?: number;
}

export interface MemorySnapshot {
  heapUsed: number;
  heapTotal: number;
  external: number;
  arrayBuffers: number;
  rss: number;
  timestamp: number;
}

export interface SessionProfile {
  sessionId: string;
  startTime: number;
  endTime?: number;
  toolCalls: ToolCallProfile[];
  memorySnapshots: MemorySnapshot[];
  peakMemory: MemorySnapshot | null;
  totalDurationMs: number;
  slowOperations: SlowOperation[];
}

export interface SlowOperation {
  toolName: string;
  durationMs: number;
  timestamp: number;
  percentile: number;
  reason: string;
}

export interface ToolStats {
  toolName: string;
  callCount: number;
  totalDurationMs: number;
  avgDurationMs: number;
  minDurationMs: number;
  maxDurationMs: number;
  p50DurationMs: number;
  p95DurationMs: number;
  p99DurationMs: number;
  successRate: number;
  avgMemoryDelta: number;
  errorCount: number;
  commonErrors: Array<{ error: string; count: number }>;
}

export interface PerformanceReport {
  generatedAt: number;
  periodStart: number;
  periodEnd: number;
  sessionCount: number;
  totalToolCalls: number;
  toolStats: ToolStats[];
  slowestOperations: SlowOperation[];
  memoryProfile: {
    avgHeapUsed: number;
    maxHeapUsed: number;
    avgRss: number;
    maxRss: number;
    memoryLeakSuspects: string[];
  };
  recommendations: string[];
}

// ============================================================================
// Constants
// ============================================================================

const PROFILES_DIR = path.join(resolveStateDir(), "perf-profiles");
const SLOW_THRESHOLD_MS = 5000; // 5 seconds
const MEMORY_SAMPLE_INTERVAL_MS = 10000; // 10 seconds

// ============================================================================
// Active Profiling State
// ============================================================================

const activeProfiles = new Map<string, SessionProfile>();
const activeToolCalls = new Map<string, { startTime: number; memoryBefore: MemorySnapshot }>();

// ============================================================================
// Memory Utilities
// ============================================================================

/**
 * Take a memory snapshot.
 */
export function takeMemorySnapshot(): MemorySnapshot {
  const usage = process.memoryUsage();
  return {
    heapUsed: usage.heapUsed,
    heapTotal: usage.heapTotal,
    external: usage.external,
    arrayBuffers: usage.arrayBuffers,
    rss: usage.rss,
    timestamp: Date.now(),
  };
}

/**
 * Format bytes to human readable string.
 */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

/**
 * Calculate memory delta between two snapshots.
 */
export function calculateMemoryDelta(
  before: MemorySnapshot,
  after: MemorySnapshot,
): { heapDelta: number; rssDelta: number } {
  return {
    heapDelta: after.heapUsed - before.heapUsed,
    rssDelta: after.rss - before.rss,
  };
}

// ============================================================================
// Session Profiling
// ============================================================================

/**
 * Start profiling a session.
 */
export function startSessionProfile(sessionId: string): SessionProfile {
  const profile: SessionProfile = {
    sessionId,
    startTime: Date.now(),
    toolCalls: [],
    memorySnapshots: [takeMemorySnapshot()],
    peakMemory: null,
    totalDurationMs: 0,
    slowOperations: [],
  };

  activeProfiles.set(sessionId, profile);
  return profile;
}

/**
 * End profiling a session.
 */
export async function endSessionProfile(sessionId: string): Promise<SessionProfile | null> {
  const profile = activeProfiles.get(sessionId);
  if (!profile) return null;

  profile.endTime = Date.now();
  profile.totalDurationMs = profile.endTime - profile.startTime;

  // Take final memory snapshot
  profile.memorySnapshots.push(takeMemorySnapshot());

  // Find peak memory
  profile.peakMemory =
    profile.memorySnapshots.reduce(
      (peak, snapshot) => (!peak || snapshot.heapUsed > peak.heapUsed ? snapshot : peak),
      null as MemorySnapshot | null,
    ) ?? null;

  // Identify slow operations
  profile.slowOperations = identifySlowOperations(profile.toolCalls);

  // Save profile
  await saveSessionProfile(profile);

  activeProfiles.delete(sessionId);
  return profile;
}

/**
 * Get active profile for a session.
 */
export function getActiveProfile(sessionId: string): SessionProfile | undefined {
  return activeProfiles.get(sessionId);
}

// ============================================================================
// Tool Call Profiling
// ============================================================================

/**
 * Start timing a tool call.
 */
export function startToolCall(
  sessionId: string,
  toolName: string,
  params?: Record<string, unknown>,
): string {
  const callId = `${sessionId}:${toolName}:${Date.now()}`;
  const memoryBefore = takeMemorySnapshot();

  activeToolCalls.set(callId, {
    startTime: Date.now(),
    memoryBefore,
  });

  return callId;
}

/**
 * End timing a tool call.
 */
export function endToolCall(
  callId: string,
  result: { success: boolean; error?: string; resultSize?: number },
): ToolCallProfile | null {
  const callInfo = activeToolCalls.get(callId);
  if (!callInfo) return null;

  const endTime = Date.now();
  const memoryAfter = takeMemorySnapshot();

  // Parse callId to get sessionId and toolName
  const parts = callId.split(":");
  const sessionId = parts[0];
  const toolName = parts[1];

  const profile: ToolCallProfile = {
    toolName,
    startTime: callInfo.startTime,
    endTime,
    durationMs: endTime - callInfo.startTime,
    success: result.success,
    error: result.error,
    memoryBefore: callInfo.memoryBefore,
    memoryAfter,
    resultSize: result.resultSize,
  };

  // Add to session profile if active
  const sessionProfile = activeProfiles.get(sessionId);
  if (sessionProfile) {
    sessionProfile.toolCalls.push(profile);
  }

  activeToolCalls.delete(callId);
  return profile;
}

/**
 * Higher-order function to wrap tool execution with profiling.
 */
export function profileTool<T>(
  sessionId: string,
  toolName: string,
  fn: () => Promise<T>,
): Promise<T> {
  const callId = startToolCall(sessionId, toolName);

  return fn()
    .then((result) => {
      endToolCall(callId, {
        success: true,
        resultSize: typeof result === "string" ? result.length : JSON.stringify(result).length,
      });
      return result;
    })
    .catch((err) => {
      endToolCall(callId, { success: false, error: String(err) });
      throw err;
    });
}

// ============================================================================
// Slow Operation Detection
// ============================================================================

/**
 * Identify slow operations from tool calls.
 */
function identifySlowOperations(toolCalls: ToolCallProfile[]): SlowOperation[] {
  const slowOps: SlowOperation[] = [];

  // Sort by duration
  const sorted = [...toolCalls].sort((a, b) => b.durationMs - a.durationMs);

  for (let i = 0; i < sorted.length; i++) {
    const call = sorted[i];
    const percentile = 100 - (i / sorted.length) * 100;

    if (call.durationMs >= SLOW_THRESHOLD_MS) {
      let reason = `Took ${call.durationMs}ms (threshold: ${SLOW_THRESHOLD_MS}ms)`;

      if (call.memoryBefore && call.memoryAfter) {
        const delta = calculateMemoryDelta(call.memoryBefore, call.memoryAfter);
        if (delta.heapDelta > 50 * 1024 * 1024) {
          // > 50MB
          reason += `, allocated ${formatBytes(delta.heapDelta)}`;
        }
      }

      slowOps.push({
        toolName: call.toolName,
        durationMs: call.durationMs,
        timestamp: call.startTime,
        percentile,
        reason,
      });
    }
  }

  return slowOps;
}

// ============================================================================
// Statistics Calculation
// ============================================================================

/**
 * Calculate statistics for a tool.
 */
function calculateToolStats(toolName: string, calls: ToolCallProfile[]): ToolStats {
  const durations = calls.map((c) => c.durationMs).sort((a, b) => a - b);
  const successCount = calls.filter((c) => c.success).length;

  // Calculate memory deltas
  const memoryDeltas: number[] = [];
  for (const call of calls) {
    if (call.memoryBefore && call.memoryAfter) {
      memoryDeltas.push(call.memoryAfter.heapUsed - call.memoryBefore.heapUsed);
    }
  }

  // Count errors
  const errorCounts = new Map<string, number>();
  for (const call of calls) {
    if (call.error) {
      const count = errorCounts.get(call.error) ?? 0;
      errorCounts.set(call.error, count + 1);
    }
  }

  const commonErrors = [...errorCounts.entries()]
    .map(([error, count]) => ({ error, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  return {
    toolName,
    callCount: calls.length,
    totalDurationMs: durations.reduce((a, b) => a + b, 0),
    avgDurationMs:
      durations.length > 0 ? durations.reduce((a, b) => a + b, 0) / durations.length : 0,
    minDurationMs: durations.length > 0 ? durations[0] : 0,
    maxDurationMs: durations.length > 0 ? durations[durations.length - 1] : 0,
    p50DurationMs: durations.length > 0 ? durations[Math.floor(durations.length * 0.5)] : 0,
    p95DurationMs: durations.length > 0 ? durations[Math.floor(durations.length * 0.95)] : 0,
    p99DurationMs: durations.length > 0 ? durations[Math.floor(durations.length * 0.99)] : 0,
    successRate: calls.length > 0 ? successCount / calls.length : 0,
    avgMemoryDelta:
      memoryDeltas.length > 0 ? memoryDeltas.reduce((a, b) => a + b, 0) / memoryDeltas.length : 0,
    errorCount: calls.length - successCount,
    commonErrors,
  };
}

// ============================================================================
// Profile Persistence
// ============================================================================

/**
 * Save session profile to disk.
 */
async function saveSessionProfile(profile: SessionProfile): Promise<void> {
  await fs.mkdir(PROFILES_DIR, { recursive: true });

  const date = new Date(profile.startTime);
  const dateStr = date.toISOString().split("T")[0];
  const profileFile = path.join(PROFILES_DIR, `${dateStr}.jsonl`);

  const line = JSON.stringify(profile) + "\n";
  await fs.appendFile(profileFile, line, "utf-8");
}

/**
 * Load profiles from disk.
 */
export async function loadProfiles(options?: {
  startTime?: number;
  endTime?: number;
  limit?: number;
}): Promise<SessionProfile[]> {
  const profiles: SessionProfile[] = [];

  try {
    const files = await fs.readdir(PROFILES_DIR);
    const jsonlFiles = files
      .filter((f) => f.endsWith(".jsonl"))
      .sort()
      .reverse();

    for (const file of jsonlFiles) {
      const content = await fs.readFile(path.join(PROFILES_DIR, file), "utf-8");
      const lines = content.trim().split("\n");

      for (const line of lines) {
        try {
          const profile = JSON.parse(line) as SessionProfile;

          // Filter by time range
          if (options?.startTime && profile.startTime < options.startTime) continue;
          if (options?.endTime && profile.startTime > options.endTime) continue;

          profiles.push(profile);

          if (options?.limit && profiles.length >= options.limit) {
            return profiles;
          }
        } catch {
          continue;
        }
      }
    }
  } catch {
    // Directory doesn't exist
  }

  return profiles;
}

// ============================================================================
// Report Generation
// ============================================================================

/**
 * Generate a comprehensive performance report.
 */
export async function generatePerformanceReport(options?: {
  startTime?: number;
  endTime?: number;
}): Promise<PerformanceReport> {
  const endTime = options?.endTime ?? Date.now();
  const startTime = options?.startTime ?? endTime - 24 * 60 * 60 * 1000; // Last 24 hours

  const profiles = await loadProfiles({ startTime, endTime });

  // Aggregate all tool calls
  const allToolCalls: ToolCallProfile[] = [];
  const allMemorySnapshots: MemorySnapshot[] = [];

  for (const profile of profiles) {
    allToolCalls.push(...profile.toolCalls);
    allMemorySnapshots.push(...profile.memorySnapshots);
  }

  // Group tool calls by name
  const toolCallsByName = new Map<string, ToolCallProfile[]>();
  for (const call of allToolCalls) {
    const calls = toolCallsByName.get(call.toolName) ?? [];
    calls.push(call);
    toolCallsByName.set(call.toolName, calls);
  }

  // Calculate stats for each tool
  const toolStats: ToolStats[] = [];
  for (const [toolName, calls] of toolCallsByName) {
    toolStats.push(calculateToolStats(toolName, calls));
  }

  // Sort by total duration (most impactful first)
  toolStats.sort((a, b) => b.totalDurationMs - a.totalDurationMs);

  // Find slowest operations across all sessions
  const slowestOperations: SlowOperation[] = [];
  for (const profile of profiles) {
    slowestOperations.push(...profile.slowOperations);
  }
  slowestOperations.sort((a, b) => b.durationMs - a.durationMs);

  // Calculate memory profile
  const heapUsages = allMemorySnapshots.map((s) => s.heapUsed);
  const rssValues = allMemorySnapshots.map((s) => s.rss);

  const avgHeapUsed =
    heapUsages.length > 0 ? heapUsages.reduce((a, b) => a + b, 0) / heapUsages.length : 0;
  const maxHeapUsed = heapUsages.length > 0 ? Math.max(...heapUsages) : 0;
  const avgRss = rssValues.length > 0 ? rssValues.reduce((a, b) => a + b, 0) / rssValues.length : 0;
  const maxRss = rssValues.length > 0 ? Math.max(...rssValues) : 0;

  // Detect memory leak suspects
  const memoryLeakSuspects: string[] = [];
  for (const stats of toolStats) {
    if (stats.avgMemoryDelta > 10 * 1024 * 1024) {
      // > 10MB average allocation
      memoryLeakSuspects.push(
        `${stats.toolName}: avg ${formatBytes(stats.avgMemoryDelta)} per call`,
      );
    }
  }

  // Generate recommendations
  const recommendations: string[] = [];

  // Slow tool recommendations
  const slowTools = toolStats.filter((s) => s.p95DurationMs > SLOW_THRESHOLD_MS);
  for (const tool of slowTools.slice(0, 3)) {
    recommendations.push(
      `Consider optimizing ${tool.toolName}: p95 latency is ${tool.p95DurationMs}ms`,
    );
  }

  // High error rate recommendations
  const errorProneTools = toolStats.filter((s) => s.successRate < 0.9 && s.callCount >= 10);
  for (const tool of errorProneTools.slice(0, 3)) {
    recommendations.push(
      `Investigate errors in ${tool.toolName}: ${((1 - tool.successRate) * 100).toFixed(1)}% failure rate`,
    );
  }

  // Memory recommendations
  if (maxHeapUsed > 500 * 1024 * 1024) {
    // > 500MB
    recommendations.push(
      `High memory usage detected (peak: ${formatBytes(maxHeapUsed)}). Consider memory optimization.`,
    );
  }

  if (memoryLeakSuspects.length > 0) {
    recommendations.push(`Potential memory leaks in: ${memoryLeakSuspects.slice(0, 3).join(", ")}`);
  }

  return {
    generatedAt: Date.now(),
    periodStart: startTime,
    periodEnd: endTime,
    sessionCount: profiles.length,
    totalToolCalls: allToolCalls.length,
    toolStats,
    slowestOperations: slowestOperations.slice(0, 20),
    memoryProfile: {
      avgHeapUsed,
      maxHeapUsed,
      avgRss,
      maxRss,
      memoryLeakSuspects,
    },
    recommendations,
  };
}

// ============================================================================
// Real-time Monitoring
// ============================================================================

let memoryMonitorInterval: NodeJS.Timeout | null = null;
let monitoringSessionId: string | null = null;

/**
 * Start real-time memory monitoring.
 */
export function startMemoryMonitoring(
  sessionId: string,
  intervalMs: number = MEMORY_SAMPLE_INTERVAL_MS,
): void {
  stopMemoryMonitoring();

  monitoringSessionId = sessionId;
  memoryMonitorInterval = setInterval(() => {
    const profile = activeProfiles.get(sessionId);
    if (profile) {
      profile.memorySnapshots.push(takeMemorySnapshot());

      // Update peak memory
      const current = profile.memorySnapshots[profile.memorySnapshots.length - 1];
      if (!profile.peakMemory || current.heapUsed > profile.peakMemory.heapUsed) {
        profile.peakMemory = current;
      }
    }
  }, intervalMs);
}

/**
 * Stop memory monitoring.
 */
export function stopMemoryMonitoring(): void {
  if (memoryMonitorInterval) {
    clearInterval(memoryMonitorInterval);
    memoryMonitorInterval = null;
    monitoringSessionId = null;
  }
}

// ============================================================================
// Convenience Functions
// ============================================================================

/**
 * Get quick summary of current performance.
 */
export async function getPerformanceSummary(): Promise<{
  currentMemory: MemorySnapshot;
  activeProfiles: number;
  recentSlowOperations: number;
  topToolsByDuration: Array<{ name: string; avgMs: number }>;
}> {
  const currentMemory = takeMemorySnapshot();
  const recentProfiles = await loadProfiles({ limit: 10 });

  let recentSlowOps = 0;
  const toolDurations = new Map<string, { total: number; count: number }>();

  for (const profile of recentProfiles) {
    recentSlowOps += profile.slowOperations.length;

    for (const call of profile.toolCalls) {
      const stats = toolDurations.get(call.toolName) ?? { total: 0, count: 0 };
      stats.total += call.durationMs;
      stats.count += 1;
      toolDurations.set(call.toolName, stats);
    }
  }

  const topTools = [...toolDurations.entries()]
    .map(([name, stats]) => ({ name, avgMs: stats.total / stats.count }))
    .sort((a, b) => b.avgMs - a.avgMs)
    .slice(0, 5);

  return {
    currentMemory,
    activeProfiles: activeProfiles.size,
    recentSlowOperations: recentSlowOps,
    topToolsByDuration: topTools,
  };
}

/**
 * Format a performance report as text.
 */
export function formatReportAsText(report: PerformanceReport): string {
  const lines: string[] = [];

  lines.push("=".repeat(60));
  lines.push("PERFORMANCE REPORT");
  lines.push("=".repeat(60));
  lines.push("");
  lines.push(
    `Period: ${new Date(report.periodStart).toISOString()} - ${new Date(report.periodEnd).toISOString()}`,
  );
  lines.push(`Sessions: ${report.sessionCount}`);
  lines.push(`Total Tool Calls: ${report.totalToolCalls}`);
  lines.push("");

  lines.push("-".repeat(60));
  lines.push("TOP TOOLS BY TOTAL TIME");
  lines.push("-".repeat(60));

  for (const stats of report.toolStats.slice(0, 10)) {
    lines.push(
      `  ${stats.toolName}: ${stats.callCount} calls, ` +
        `avg ${stats.avgDurationMs.toFixed(0)}ms, ` +
        `p95 ${stats.p95DurationMs.toFixed(0)}ms, ` +
        `${(stats.successRate * 100).toFixed(1)}% success`,
    );
  }

  lines.push("");
  lines.push("-".repeat(60));
  lines.push("MEMORY PROFILE");
  lines.push("-".repeat(60));
  lines.push(`  Avg Heap: ${formatBytes(report.memoryProfile.avgHeapUsed)}`);
  lines.push(`  Max Heap: ${formatBytes(report.memoryProfile.maxHeapUsed)}`);
  lines.push(`  Avg RSS: ${formatBytes(report.memoryProfile.avgRss)}`);
  lines.push(`  Max RSS: ${formatBytes(report.memoryProfile.maxRss)}`);

  if (report.memoryProfile.memoryLeakSuspects.length > 0) {
    lines.push("");
    lines.push("  Potential Memory Leaks:");
    for (const suspect of report.memoryProfile.memoryLeakSuspects) {
      lines.push(`    - ${suspect}`);
    }
  }

  if (report.slowestOperations.length > 0) {
    lines.push("");
    lines.push("-".repeat(60));
    lines.push("SLOWEST OPERATIONS");
    lines.push("-".repeat(60));

    for (const op of report.slowestOperations.slice(0, 10)) {
      lines.push(`  ${op.toolName}: ${op.durationMs}ms - ${op.reason}`);
    }
  }

  if (report.recommendations.length > 0) {
    lines.push("");
    lines.push("-".repeat(60));
    lines.push("RECOMMENDATIONS");
    lines.push("-".repeat(60));

    for (const rec of report.recommendations) {
      lines.push(`  • ${rec}`);
    }
  }

  lines.push("");
  lines.push("=".repeat(60));

  return lines.join("\n");
}
