/**
 * Session Diff Tool: Compare two sessions semantically for behavioral analysis.
 *
 * This tool enables:
 * 1. Comparing two sessions semantically (not just text diff)
 * 2. Identifying divergence points where behavior differed
 * 3. Highlighting behavioral shifts (error rate, latency, etc.)
 * 4. Extracting reusable patterns from diffs
 */

import { Type } from "@sinclair/typebox";
import { promises as fs } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import type { AnyAgentTool } from "./common.js";
import { jsonResult, readStringParam, readNumberParam } from "./common.js";

// ============================================================================
// Types
// ============================================================================

export interface ToolCallStats {
  tool: string;
  count: number;
  errorRate: number;
  totalDurationMs: number;
  avgDurationMs: number;
}

export interface SessionSummary {
  sessionId: string;
  turns: number;
  toolCalls: ToolCallStats[];
  duration: number;
  tokenUsage: {
    input: number;
    output: number;
    total: number;
    cacheRead?: number;
    cacheWrite?: number;
  };
  errors: string[];
  model?: string;
  provider?: string;
  startTime?: number;
  endTime?: number;
}

export interface DivergencePoint {
  turnIndex: number;
  sessionA: {
    tool: string;
    result: string;
    durationMs: number;
    error?: string;
  };
  sessionB: {
    tool: string;
    result: string;
    durationMs: number;
    error?: string;
  };
  analysis: string;
}

export interface BehaviorShift {
  errorRate: {
    sessionA: number;
    sessionB: number;
    delta: number;
    direction: "better" | "worse" | "same";
  };
  avgLatency: {
    sessionA: number;
    sessionB: number;
    delta: number;
    direction: "better" | "worse" | "same";
  };
  toolUsage: {
    added: string[];
    removed: string[];
    changed: string[];
  };
}

export interface SessionDiff {
  sessionA: SessionSummary;
  sessionB: SessionSummary;
  divergencePoints: DivergencePoint[];
  behaviorShift: BehaviorShift;
}

// Internal types for parsing JSONL
interface SessionEvent {
  type: string;
  id: string;
  parentId?: string | null;
  timestamp: string;
  // Session header
  version?: number;
  cwd?: string;
  // Model change
  provider?: string;
  modelId?: string;
  // Message
  message?: {
    role: string;
    content?: Array<{
      type: string;
      text?: string;
      id?: string;
      name?: string;
      arguments?: unknown;
    }>;
    usage?: {
      input: number;
      output: number;
      cacheRead?: number;
      cacheWrite?: number;
      totalTokens?: number;
    };
    stopReason?: string;
    errorMessage?: string;
    toolCallId?: string;
    toolName?: string;
  };
  // Custom event
  customType?: string;
  data?: unknown;
  // Tool result details
  details?: {
    status?: string;
    durationMs?: number;
    exitCode?: number;
    error?: string;
  };
  isError?: boolean;
}

interface ToolCallInfo {
  toolName: string;
  turnIndex: number;
  timestamp: number;
  durationMs: number;
  success: boolean;
  error?: string;
  result?: string;
}

// ============================================================================
// Core Functions
// ============================================================================

/**
 * Resolve the sessions directory for a given agent.
 * Allows custom base path for testing.
 */
function resolveSessionsDir(agentId: string = "main", basePath?: string): string {
  const base = basePath ?? path.join(homedir(), ".openclaw");
  return path.join(base, "agents", agentId, "sessions");
}

/**
 * List available session files.
 */
export async function listSessions(
  agentId: string = "main",
  basePath?: string,
): Promise<Array<{ sessionId: string; path: string; mtime: Date }>> {
  const sessionsDir = resolveSessionsDir(agentId, basePath);

  try {
    const files = await fs.readdir(sessionsDir);
    const sessions: Array<{ sessionId: string; path: string; mtime: Date }> = [];

    for (const file of files) {
      if (file.endsWith(".jsonl") && !file.includes(".deleted.")) {
        const filePath = path.join(sessionsDir, file);
        const stat = await fs.stat(filePath);
        const sessionId = file.replace(".jsonl", "");
        sessions.push({
          sessionId,
          path: filePath,
          mtime: stat.mtime,
        });
      }
    }

    // Sort by modification time, newest first
    sessions.sort((a, b) => b.mtime.getTime() - a.mtime.getTime());
    return sessions;
  } catch {
    return [];
  }
}

/**
 * Parse a session JSONL file into events.
 */
async function parseSessionFile(filePath: string): Promise<SessionEvent[]> {
  const content = await fs.readFile(filePath, "utf-8");
  const lines = content.split("\n").filter((line) => line.trim());
  const events: SessionEvent[] = [];

  for (const line of lines) {
    try {
      const event = JSON.parse(line) as SessionEvent;
      events.push(event);
    } catch {
      // Skip malformed lines
    }
  }

  return events;
}

/**
 * Extract tool calls from session events.
 */
function extractToolCalls(events: SessionEvent[]): ToolCallInfo[] {
  const toolCalls: ToolCallInfo[] = [];
  const pendingCalls = new Map<string, { name: string; timestamp: number; turnIndex: number }>();
  let turnIndex = 0;

  for (const event of events) {
    if (event.type === "message") {
      const msg = event.message;
      if (!msg) continue;

      if (msg.role === "user") {
        turnIndex++;
      }

      if (msg.role === "assistant" && msg.content) {
        for (const content of msg.content) {
          if (content.type === "toolCall" && content.id && content.name) {
            pendingCalls.set(content.id, {
              name: content.name,
              timestamp: new Date(event.timestamp).getTime(),
              turnIndex,
            });
          }
        }
      }

      if (msg.role === "toolResult" && msg.toolCallId) {
        const pending = pendingCalls.get(msg.toolCallId);
        if (pending) {
          const resultTimestamp = new Date(event.timestamp).getTime();
          const durationMs = event.details?.durationMs ?? resultTimestamp - pending.timestamp;

          let resultText = "";
          if (msg.content) {
            for (const content of msg.content) {
              if (content.type === "text" && content.text) {
                resultText += content.text;
              }
            }
          }

          toolCalls.push({
            toolName: msg.toolName ?? pending.name,
            turnIndex: pending.turnIndex,
            timestamp: pending.timestamp,
            durationMs,
            success: !event.isError && event.details?.status !== "error",
            error: event.isError ? resultText.slice(0, 200) : event.details?.error,
            result: resultText.slice(0, 500),
          });

          pendingCalls.delete(msg.toolCallId);
        }
      }
    }
  }

  return toolCalls;
}

/**
 * Load and summarize a session by ID.
 */
export async function loadSession(
  sessionId: string,
  agentId: string = "main",
  basePath?: string,
): Promise<SessionSummary> {
  const sessionsDir = resolveSessionsDir(agentId, basePath);
  const filePath = path.join(sessionsDir, `${sessionId}.jsonl`);

  const events = await parseSessionFile(filePath);
  const toolCalls = extractToolCalls(events);

  // Extract session metadata
  const sessionHeader = events.find((e) => e.type === "session");
  const modelChange = events.find((e) => e.type === "model_change");

  // Count turns (user messages)
  let turns = 0;
  for (const event of events) {
    if (event.type === "message" && event.message?.role === "user") {
      turns++;
    }
  }

  // Aggregate tool call stats
  const toolStats = new Map<string, { count: number; errors: number; totalDuration: number }>();

  for (const call of toolCalls) {
    const existing = toolStats.get(call.toolName) ?? {
      count: 0,
      errors: 0,
      totalDuration: 0,
    };
    existing.count++;
    if (!call.success) existing.errors++;
    existing.totalDuration += call.durationMs;
    toolStats.set(call.toolName, existing);
  }

  const toolCallStats: ToolCallStats[] = [];
  for (const [tool, stats] of toolStats) {
    toolCallStats.push({
      tool,
      count: stats.count,
      errorRate: stats.count > 0 ? stats.errors / stats.count : 0,
      totalDurationMs: stats.totalDuration,
      avgDurationMs: stats.count > 0 ? Math.round(stats.totalDuration / stats.count) : 0,
    });
  }

  // Aggregate token usage
  let inputTokens = 0;
  let outputTokens = 0;
  let cacheRead = 0;
  let cacheWrite = 0;

  for (const event of events) {
    if (event.type === "message" && event.message?.usage) {
      const usage = event.message.usage;
      inputTokens += usage.input ?? 0;
      outputTokens += usage.output ?? 0;
      cacheRead += usage.cacheRead ?? 0;
      cacheWrite += usage.cacheWrite ?? 0;
    }
  }

  // Collect errors
  const errors: string[] = [];
  for (const event of events) {
    if (event.type === "message" && event.message?.errorMessage) {
      errors.push(event.message.errorMessage.slice(0, 200));
    }
    if (event.isError && event.message?.content) {
      for (const content of event.message.content) {
        if (content.type === "text" && content.text) {
          errors.push(content.text.slice(0, 200));
        }
      }
    }
  }

  // Calculate duration
  const timestamps = events.filter((e) => e.timestamp).map((e) => new Date(e.timestamp).getTime());
  const startTime = timestamps.length > 0 ? Math.min(...timestamps) : 0;
  const endTime = timestamps.length > 0 ? Math.max(...timestamps) : 0;
  const duration = endTime - startTime;

  return {
    sessionId,
    turns,
    toolCalls: toolCallStats,
    duration,
    tokenUsage: {
      input: inputTokens,
      output: outputTokens,
      total: inputTokens + outputTokens,
      cacheRead,
      cacheWrite,
    },
    errors: errors.slice(0, 10), // Limit to 10 errors
    model: modelChange?.modelId,
    provider: modelChange?.provider,
    startTime,
    endTime,
  };
}

/**
 * Compare two sessions and identify divergence points.
 */
export async function compareSessions(
  sessionIdA: string,
  sessionIdB: string,
  agentId: string = "main",
  basePath?: string,
): Promise<SessionDiff> {
  const sessionsDir = resolveSessionsDir(agentId, basePath);
  const filePathA = path.join(sessionsDir, `${sessionIdA}.jsonl`);
  const filePathB = path.join(sessionsDir, `${sessionIdB}.jsonl`);

  const [eventsA, eventsB] = await Promise.all([
    parseSessionFile(filePathA),
    parseSessionFile(filePathB),
  ]);

  const toolCallsA = extractToolCalls(eventsA);
  const toolCallsB = extractToolCalls(eventsB);

  const [summaryA, summaryB] = await Promise.all([
    loadSession(sessionIdA, agentId, basePath),
    loadSession(sessionIdB, agentId, basePath),
  ]);

  // Find divergence points
  const divergencePoints: DivergencePoint[] = [];

  // Compare tool calls at each turn
  const maxTurns = Math.max(
    toolCallsA[toolCallsA.length - 1]?.turnIndex ?? 0,
    toolCallsB[toolCallsB.length - 1]?.turnIndex ?? 0,
  );

  for (let turn = 1; turn <= maxTurns; turn++) {
    const callsAtTurnA = toolCallsA.filter((c) => c.turnIndex === turn);
    const callsAtTurnB = toolCallsB.filter((c) => c.turnIndex === turn);

    // Check for different tool usage at this turn
    if (callsAtTurnA.length > 0 || callsAtTurnB.length > 0) {
      const toolsA = new Set(callsAtTurnA.map((c) => c.toolName));
      const toolsB = new Set(callsAtTurnB.map((c) => c.toolName));

      // Find tools that differ
      for (const tool of toolsA) {
        if (!toolsB.has(tool)) {
          const callA = callsAtTurnA.find((c) => c.toolName === tool);
          if (callA) {
            divergencePoints.push({
              turnIndex: turn,
              sessionA: {
                tool: callA.toolName,
                result: callA.success ? "success" : "error",
                durationMs: callA.durationMs,
                error: callA.error,
              },
              sessionB: {
                tool: "(not called)",
                result: "n/a",
                durationMs: 0,
              },
              analysis: `Session A called ${tool} but Session B did not at turn ${turn}`,
            });
          }
        }
      }

      for (const tool of toolsB) {
        if (!toolsA.has(tool)) {
          const callB = callsAtTurnB.find((c) => c.toolName === tool);
          if (callB) {
            divergencePoints.push({
              turnIndex: turn,
              sessionA: {
                tool: "(not called)",
                result: "n/a",
                durationMs: 0,
              },
              sessionB: {
                tool: callB.toolName,
                result: callB.success ? "success" : "error",
                durationMs: callB.durationMs,
                error: callB.error,
              },
              analysis: `Session B called ${tool} but Session A did not at turn ${turn}`,
            });
          }
        }
      }

      // Compare same tools with different outcomes
      for (const tool of toolsA) {
        if (toolsB.has(tool)) {
          const callA = callsAtTurnA.find((c) => c.toolName === tool);
          const callB = callsAtTurnB.find((c) => c.toolName === tool);

          if (callA && callB) {
            const outcomesDiffer = callA.success !== callB.success;
            const latencyDiff = Math.abs(callA.durationMs - callB.durationMs);
            const significantLatencyDiff = latencyDiff > 1000 || latencyDiff > callA.durationMs * 2;

            if (outcomesDiffer || significantLatencyDiff) {
              let analysis = "";
              if (outcomesDiffer) {
                analysis = `${tool} ${callA.success ? "succeeded" : "failed"} in A but ${callB.success ? "succeeded" : "failed"} in B`;
              } else if (significantLatencyDiff) {
                analysis = `${tool} took ${callA.durationMs}ms in A vs ${callB.durationMs}ms in B (${Math.round((latencyDiff / callA.durationMs) * 100)}% difference)`;
              }

              divergencePoints.push({
                turnIndex: turn,
                sessionA: {
                  tool: callA.toolName,
                  result: callA.success ? "success" : "error",
                  durationMs: callA.durationMs,
                  error: callA.error,
                },
                sessionB: {
                  tool: callB.toolName,
                  result: callB.success ? "success" : "error",
                  durationMs: callB.durationMs,
                  error: callB.error,
                },
                analysis,
              });
            }
          }
        }
      }
    }
  }

  // Calculate behavior shift
  const errorRateA =
    toolCallsA.length > 0 ? toolCallsA.filter((c) => !c.success).length / toolCallsA.length : 0;
  const errorRateB =
    toolCallsB.length > 0 ? toolCallsB.filter((c) => !c.success).length / toolCallsB.length : 0;
  const errorDelta = errorRateB - errorRateA;

  const avgLatencyA =
    toolCallsA.length > 0
      ? toolCallsA.reduce((sum, c) => sum + c.durationMs, 0) / toolCallsA.length
      : 0;
  const avgLatencyB =
    toolCallsB.length > 0
      ? toolCallsB.reduce((sum, c) => sum + c.durationMs, 0) / toolCallsB.length
      : 0;
  const latencyDelta = avgLatencyB - avgLatencyA;

  const toolsUsedA = new Set(summaryA.toolCalls.map((t) => t.tool));
  const toolsUsedB = new Set(summaryB.toolCalls.map((t) => t.tool));

  const addedTools = [...toolsUsedB].filter((t) => !toolsUsedA.has(t));
  const removedTools = [...toolsUsedA].filter((t) => !toolsUsedB.has(t));
  const changedTools: string[] = [];

  for (const tool of toolsUsedA) {
    if (toolsUsedB.has(tool)) {
      const statsA = summaryA.toolCalls.find((t) => t.tool === tool);
      const statsB = summaryB.toolCalls.find((t) => t.tool === tool);
      if (statsA && statsB) {
        const errorDiff = Math.abs(statsA.errorRate - statsB.errorRate);
        const countDiff = Math.abs(statsA.count - statsB.count);
        if (errorDiff > 0.1 || countDiff > 5) {
          changedTools.push(tool);
        }
      }
    }
  }

  const behaviorShift: BehaviorShift = {
    errorRate: {
      sessionA: errorRateA,
      sessionB: errorRateB,
      delta: errorDelta,
      direction: Math.abs(errorDelta) < 0.01 ? "same" : errorDelta < 0 ? "better" : "worse",
    },
    avgLatency: {
      sessionA: Math.round(avgLatencyA),
      sessionB: Math.round(avgLatencyB),
      delta: Math.round(latencyDelta),
      direction: Math.abs(latencyDelta) < 100 ? "same" : latencyDelta < 0 ? "better" : "worse",
    },
    toolUsage: {
      added: addedTools,
      removed: removedTools,
      changed: changedTools,
    },
  };

  return {
    sessionA: summaryA,
    sessionB: summaryB,
    divergencePoints: divergencePoints.slice(0, 20), // Limit to 20 divergence points
    behaviorShift,
  };
}

/**
 * Compare the latest N sessions, optionally filtered by a pattern.
 */
export async function compareLatest(
  count: number = 2,
  filter?: string,
  agentId: string = "main",
  basePath?: string,
): Promise<SessionDiff[]> {
  const sessions = await listSessions(agentId, basePath);

  // Filter sessions if pattern provided
  let filtered = sessions;
  if (filter) {
    const filterLower = filter.toLowerCase();
    filtered = sessions.filter((s) => s.sessionId.toLowerCase().includes(filterLower));
  }

  // Need at least 2 sessions to compare
  if (filtered.length < 2) {
    return [];
  }

  const toCompare = filtered.slice(0, Math.min(count, filtered.length));
  const diffs: SessionDiff[] = [];

  // Compare consecutive pairs
  for (let i = 0; i < toCompare.length - 1; i++) {
    const diff = await compareSessions(
      toCompare[i].sessionId,
      toCompare[i + 1].sessionId,
      agentId,
      basePath,
    );
    diffs.push(diff);
  }

  return diffs;
}

/**
 * Generate a formatted report highlighting divergences.
 */
export function highlightDivergence(diff: SessionDiff): string {
  const lines: string[] = [];

  lines.push("# Session Comparison Report");
  lines.push("");
  lines.push(`## Sessions Compared`);
  lines.push(
    `- **Session A**: ${diff.sessionA.sessionId} (${diff.sessionA.turns} turns, ${diff.sessionA.toolCalls.reduce((sum, t) => sum + t.count, 0)} tool calls)`,
  );
  lines.push(
    `- **Session B**: ${diff.sessionB.sessionId} (${diff.sessionB.turns} turns, ${diff.sessionB.toolCalls.reduce((sum, t) => sum + t.count, 0)} tool calls)`,
  );
  lines.push("");

  lines.push("## Behavior Shift Summary");
  lines.push("");

  const shift = diff.behaviorShift;
  const errorEmoji =
    shift.errorRate.direction === "better"
      ? "✅"
      : shift.errorRate.direction === "worse"
        ? "❌"
        : "➖";
  const latencyEmoji =
    shift.avgLatency.direction === "better"
      ? "✅"
      : shift.avgLatency.direction === "worse"
        ? "⚠️"
        : "➖";

  lines.push(`| Metric | Session A | Session B | Change |`);
  lines.push(`|--------|-----------|-----------|--------|`);
  lines.push(
    `| Error Rate | ${(shift.errorRate.sessionA * 100).toFixed(1)}% | ${(shift.errorRate.sessionB * 100).toFixed(1)}% | ${errorEmoji} ${shift.errorRate.direction} |`,
  );
  lines.push(
    `| Avg Latency | ${shift.avgLatency.sessionA}ms | ${shift.avgLatency.sessionB}ms | ${latencyEmoji} ${shift.avgLatency.direction} |`,
  );
  lines.push("");

  if (
    shift.toolUsage.added.length > 0 ||
    shift.toolUsage.removed.length > 0 ||
    shift.toolUsage.changed.length > 0
  ) {
    lines.push("### Tool Usage Changes");
    if (shift.toolUsage.added.length > 0) {
      lines.push(`- **Added**: ${shift.toolUsage.added.join(", ")}`);
    }
    if (shift.toolUsage.removed.length > 0) {
      lines.push(`- **Removed**: ${shift.toolUsage.removed.join(", ")}`);
    }
    if (shift.toolUsage.changed.length > 0) {
      lines.push(`- **Changed behavior**: ${shift.toolUsage.changed.join(", ")}`);
    }
    lines.push("");
  }

  if (diff.divergencePoints.length > 0) {
    lines.push("## Divergence Points");
    lines.push("");

    for (let i = 0; i < Math.min(diff.divergencePoints.length, 10); i++) {
      const point = diff.divergencePoints[i];
      lines.push(`### Turn ${point.turnIndex}`);
      lines.push(
        `- **Session A**: ${point.sessionA.tool} → ${point.sessionA.result} (${point.sessionA.durationMs}ms)`,
      );
      if (point.sessionA.error) {
        lines.push(`  - Error: ${point.sessionA.error.slice(0, 100)}`);
      }
      lines.push(
        `- **Session B**: ${point.sessionB.tool} → ${point.sessionB.result} (${point.sessionB.durationMs}ms)`,
      );
      if (point.sessionB.error) {
        lines.push(`  - Error: ${point.sessionB.error.slice(0, 100)}`);
      }
      lines.push(`- **Analysis**: ${point.analysis}`);
      lines.push("");
    }

    if (diff.divergencePoints.length > 10) {
      lines.push(`*... and ${diff.divergencePoints.length - 10} more divergence points*`);
      lines.push("");
    }
  } else {
    lines.push("## Divergence Points");
    lines.push("");
    lines.push("No significant divergence points detected.");
    lines.push("");
  }

  // Add error summary if present
  if (diff.sessionA.errors.length > 0 || diff.sessionB.errors.length > 0) {
    lines.push("## Errors");
    lines.push("");
    if (diff.sessionA.errors.length > 0) {
      lines.push(`### Session A Errors (${diff.sessionA.errors.length})`);
      for (const error of diff.sessionA.errors.slice(0, 3)) {
        lines.push(`- ${error.slice(0, 150)}`);
      }
      lines.push("");
    }
    if (diff.sessionB.errors.length > 0) {
      lines.push(`### Session B Errors (${diff.sessionB.errors.length})`);
      for (const error of diff.sessionB.errors.slice(0, 3)) {
        lines.push(`- ${error.slice(0, 150)}`);
      }
      lines.push("");
    }
  }

  return lines.join("\n");
}

/**
 * Extract a reusable pattern/insight from a session diff.
 */
export function extractPattern(diff: SessionDiff): string {
  const insights: string[] = [];

  // Pattern: Error rate regression
  if (diff.behaviorShift.errorRate.direction === "worse") {
    const errorDelta = diff.behaviorShift.errorRate.delta * 100;
    insights.push(
      `🔴 **Error Rate Regression**: Error rate increased by ${errorDelta.toFixed(1)} percentage points. ` +
        `Check the following tools for issues: ${diff.behaviorShift.toolUsage.changed.join(", ") || "none identified"}.`,
    );
  }

  // Pattern: Latency regression
  if (
    diff.behaviorShift.avgLatency.direction === "worse" &&
    diff.behaviorShift.avgLatency.delta > 500
  ) {
    insights.push(
      `⏱️ **Latency Regression**: Average tool call latency increased by ${diff.behaviorShift.avgLatency.delta}ms. ` +
        `This may indicate network issues, resource exhaustion, or API throttling.`,
    );
  }

  // Pattern: New tool adoption
  if (diff.behaviorShift.toolUsage.added.length > 0) {
    insights.push(
      `🆕 **New Tool Usage**: Session B started using new tools: ${diff.behaviorShift.toolUsage.added.join(", ")}. ` +
        `This may indicate capability expansion or different task requirements.`,
    );
  }

  // Pattern: Tool abandonment
  if (diff.behaviorShift.toolUsage.removed.length > 0) {
    insights.push(
      `➖ **Tool Abandonment**: Session B stopped using: ${diff.behaviorShift.toolUsage.removed.join(", ")}. ` +
        `Verify this is intentional and not due to errors.`,
    );
  }

  // Pattern: Outcome divergence
  const outcomeDiv = diff.divergencePoints.filter(
    (d) => d.sessionA.result !== d.sessionB.result && d.sessionA.tool === d.sessionB.tool,
  );
  if (outcomeDiv.length > 0) {
    const tools = [...new Set(outcomeDiv.map((d) => d.sessionA.tool))];
    insights.push(
      `⚡ **Outcome Divergence**: The following tools produced different outcomes: ${tools.join(", ")}. ` +
        `This may indicate non-deterministic behavior or environmental changes.`,
    );
  }

  // Pattern: Improvement
  if (
    diff.behaviorShift.errorRate.direction === "better" &&
    diff.behaviorShift.avgLatency.direction === "better"
  ) {
    insights.push(
      `✅ **Overall Improvement**: Session B shows improvement in both error rate and latency. ` +
        `Document what changed to replicate this success.`,
    );
  }

  if (insights.length === 0) {
    insights.push(
      `ℹ️ **No Significant Patterns**: The sessions are similar in behavior. ` +
        `Minor variations within normal range.`,
    );
  }

  return insights.join("\n\n");
}

// ============================================================================
// Tool Definition
// ============================================================================

const SessionDiffToolSchema = Type.Object({
  action: Type.Union([
    Type.Literal("compare"),
    Type.Literal("compare_latest"),
    Type.Literal("highlight"),
    Type.Literal("extract_pattern"),
    Type.Literal("list_sessions"),
  ]),
  sessionA: Type.Optional(Type.String()),
  sessionB: Type.Optional(Type.String()),
  count: Type.Optional(Type.Number()),
  filter: Type.Optional(Type.String()),
  agentId: Type.Optional(Type.String()),
});

/**
 * Options for creating the session diff tool.
 */
export interface SessionDiffToolOptions {
  /** Base path for testing (uses ~/.openclaw by default) */
  basePath?: string;
}

export function createSessionDiffTool(options?: SessionDiffToolOptions): AnyAgentTool {
  const basePath = options?.basePath;

  return {
    label: "Session Diff",
    name: "session_diff",
    description:
      "Compare sessions semantically for behavioral analysis. " +
      "Identify divergence points, error rate changes, latency shifts, and tool usage patterns. " +
      "Actions: compare (two sessions), compare_latest (N recent sessions), " +
      "highlight (formatted report), extract_pattern (insights), list_sessions (available sessions).",
    parameters: SessionDiffToolSchema,
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const action = readStringParam(params, "action", { required: true });
      const agentId = readStringParam(params, "agentId") ?? "main";

      try {
        if (action === "list_sessions") {
          const sessions = await listSessions(agentId, basePath);
          return jsonResult({
            sessions: sessions.slice(0, 50).map((s) => ({
              sessionId: s.sessionId,
              modifiedAt: s.mtime.toISOString(),
            })),
            total: sessions.length,
          });
        }

        if (action === "compare") {
          const sessionA = readStringParam(params, "sessionA", { required: true });
          const sessionB = readStringParam(params, "sessionB", { required: true });
          const diff = await compareSessions(sessionA, sessionB, agentId, basePath);
          return jsonResult(diff);
        }

        if (action === "compare_latest") {
          const count = readNumberParam(params, "count") ?? 2;
          const filter = readStringParam(params, "filter");
          const diffs = await compareLatest(count, filter, agentId, basePath);
          return jsonResult({ diffs });
        }

        if (action === "highlight") {
          const sessionA = readStringParam(params, "sessionA", { required: true });
          const sessionB = readStringParam(params, "sessionB", { required: true });
          const diff = await compareSessions(sessionA, sessionB, agentId, basePath);
          const report = highlightDivergence(diff);
          return {
            content: [{ type: "text", text: report }],
            details: { ok: true, format: "markdown" },
          };
        }

        if (action === "extract_pattern") {
          const sessionA = readStringParam(params, "sessionA", { required: true });
          const sessionB = readStringParam(params, "sessionB", { required: true });
          const diff = await compareSessions(sessionA, sessionB, agentId, basePath);
          const pattern = extractPattern(diff);
          return {
            content: [{ type: "text", text: pattern }],
            details: { ok: true, format: "markdown" },
          };
        }

        return jsonResult({
          success: false,
          error: `Unknown action: ${action}`,
        });
      } catch (err) {
        return jsonResult({
          success: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    },
  };
}
