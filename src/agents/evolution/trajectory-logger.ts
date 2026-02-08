/**
 * Trajectory Logger - ReAct Integration for Explicit Thought Steps
 *
 * Implements the ReAct (Reasoning + Acting) pattern with explicit logging:
 * - Thought: reasoning before each tool call
 * - Action: the tool invocation
 * - Observation: the tool result
 *
 * Supports trajectory reconstruction for reflexion and distillation systems.
 *
 * References:
 * - ReAct: Synergizing Reasoning and Acting in Language Models (Yao et al. 2022)
 * - Reflexion: Language Agents with Verbal Reinforcement Learning (Shinn et al. 2023)
 */

import fs from "node:fs/promises";
import path from "node:path";
import type { DistillationStep } from "./algorithm-distillation.js";
import { log } from "../pi-embedded-runner/logger.js";
import { DEFAULT_AGENT_WORKSPACE_DIR } from "../workspace.js";
import { getDistillationSystem } from "./algorithm-distillation.js";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type TrajectoryEventType = "thought" | "action" | "observation" | "reflection";

export interface TrajectoryEvent {
  id: string;
  sessionId: string;
  runId: string;
  timestamp: string;
  type: TrajectoryEventType;
  tool?: string;
  toolCallId?: string;
  content: string;
  metadata?: Record<string, unknown>;
  success?: boolean;
  durationMs?: number;
}

export interface ReActStep {
  thought?: string;
  action: {
    tool: string;
    args?: Record<string, unknown>;
    summary: string;
  };
  observation: {
    result: string;
    success: boolean;
    durationMs?: number;
  };
}

export interface ReconstructedTrajectory {
  sessionId: string;
  runId: string;
  startTime: string;
  endTime?: string;
  steps: ReActStep[];
  toolsUsed: string[];
  totalDuration: number;
  successRate: number;
  chainText: string; // Human-readable Thought → Action → Observation chain
}

// ─────────────────────────────────────────────────────────────────────────────
// In-memory trajectory buffer for active sessions
// ─────────────────────────────────────────────────────────────────────────────

interface ActiveSession {
  sessionId: string;
  runId: string;
  startTime: string;
  events: TrajectoryEvent[];
  pendingThought?: string;
  pendingToolCallId?: string;
}

const activeSessions: Map<string, ActiveSession> = new Map();
const MAX_EVENTS_PER_SESSION = 500;

function getSessionKey(sessionId: string, runId: string): string {
  return `${sessionId}:${runId}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Core logging functions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Start tracking a new session/run
 */
export function startTrajectory(sessionId: string, runId: string): void {
  const key = getSessionKey(sessionId, runId);
  activeSessions.set(key, {
    sessionId,
    runId,
    startTime: new Date().toISOString(),
    events: [],
  });
  log.debug(`[trajectory] Started tracking: ${key}`);
}

/**
 * Log a thought before a tool call
 *
 * Format: [Thought] Calling {tool} because: {reasoning}
 */
export function logThought(
  sessionId: string,
  runId: string,
  tool: string,
  reasoning: string,
  toolCallId?: string,
): void {
  const key = getSessionKey(sessionId, runId);
  let session = activeSessions.get(key);

  if (!session) {
    // Auto-start if not tracking
    startTrajectory(sessionId, runId);
    session = activeSessions.get(key)!;
  }

  const event: TrajectoryEvent = {
    id: crypto.randomUUID(),
    sessionId,
    runId,
    timestamp: new Date().toISOString(),
    type: "thought",
    tool,
    toolCallId,
    content: reasoning,
  };

  session.events.push(event);
  session.pendingThought = reasoning;
  session.pendingToolCallId = toolCallId;

  // Trim if too many events
  if (session.events.length > MAX_EVENTS_PER_SESSION) {
    session.events.splice(0, session.events.length - MAX_EVENTS_PER_SESSION);
  }

  log.debug(`[Thought] Calling ${tool} because: ${reasoning.slice(0, 100)}...`);
}

/**
 * Log a tool action (start of execution)
 */
export function logAction(
  sessionId: string,
  runId: string,
  tool: string,
  toolCallId: string,
  args?: Record<string, unknown>,
  meta?: string,
): void {
  const key = getSessionKey(sessionId, runId);
  let session = activeSessions.get(key);

  if (!session) {
    startTrajectory(sessionId, runId);
    session = activeSessions.get(key)!;
  }

  const argsSummary = args ? summarizeArgs(args) : "";
  const content = meta ? `${tool}(${argsSummary}) [${meta}]` : `${tool}(${argsSummary})`;

  const event: TrajectoryEvent = {
    id: crypto.randomUUID(),
    sessionId,
    runId,
    timestamp: new Date().toISOString(),
    type: "action",
    tool,
    toolCallId,
    content,
    metadata: args,
  };

  session.events.push(event);
  log.debug(`[Action] ${content}`);
}

/**
 * Log an observation (tool result)
 *
 * Format: [Observation] {tool} returned: {summary}
 */
export function logObservation(
  sessionId: string,
  runId: string,
  tool: string,
  toolCallId: string,
  result: string,
  success: boolean,
  durationMs?: number,
): void {
  const key = getSessionKey(sessionId, runId);
  const session = activeSessions.get(key);

  if (!session) {
    log.warn(`[trajectory] No active session for observation: ${key}`);
    return;
  }

  const summary = summarizeResult(result, success);

  const event: TrajectoryEvent = {
    id: crypto.randomUUID(),
    sessionId,
    runId,
    timestamp: new Date().toISOString(),
    type: "observation",
    tool,
    toolCallId,
    content: result,
    success,
    durationMs,
  };

  session.events.push(event);
  session.pendingThought = undefined;
  session.pendingToolCallId = undefined;

  log.debug(`[Observation] ${tool} returned: ${summary}`);
}

/**
 * Log a reflection (for failed attempts or learning)
 */
export function logReflection(
  sessionId: string,
  runId: string,
  reflection: string,
  metadata?: Record<string, unknown>,
): void {
  const key = getSessionKey(sessionId, runId);
  const session = activeSessions.get(key);

  if (!session) {
    log.warn(`[trajectory] No active session for reflection: ${key}`);
    return;
  }

  const event: TrajectoryEvent = {
    id: crypto.randomUUID(),
    sessionId,
    runId,
    timestamp: new Date().toISOString(),
    type: "reflection",
    content: reflection,
    metadata,
  };

  session.events.push(event);
  log.debug(`[Reflection] ${reflection.slice(0, 100)}...`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Trajectory Reconstruction
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Reconstruct the full reasoning chain from logged events
 *
 * Output format: Thought → Action → Observation → Thought → ...
 */
export function reconstructTrajectory(
  sessionId: string,
  runId: string,
): ReconstructedTrajectory | null {
  const key = getSessionKey(sessionId, runId);
  const session = activeSessions.get(key);

  if (!session || session.events.length === 0) {
    return null;
  }

  const steps: ReActStep[] = [];
  const toolsUsed: Set<string> = new Set();
  let successCount = 0;
  let totalCount = 0;

  // Group events by tool call
  const eventsByToolCall: Map<string, TrajectoryEvent[]> = new Map();
  const orphanEvents: TrajectoryEvent[] = [];

  for (const event of session.events) {
    if (event.toolCallId) {
      const existing = eventsByToolCall.get(event.toolCallId) ?? [];
      existing.push(event);
      eventsByToolCall.set(event.toolCallId, existing);
    } else {
      orphanEvents.push(event);
    }
  }

  // Build steps from grouped events
  for (const [toolCallId, events] of eventsByToolCall) {
    const thought = events.find((e) => e.type === "thought");
    const action = events.find((e) => e.type === "action");
    const observation = events.find((e) => e.type === "observation");

    if (action) {
      const tool = action.tool ?? "unknown";
      toolsUsed.add(tool);
      totalCount++;

      const step: ReActStep = {
        thought: thought?.content,
        action: {
          tool,
          args: action.metadata as Record<string, unknown> | undefined,
          summary: action.content,
        },
        observation: {
          result: observation?.content ?? "(no result)",
          success: observation?.success ?? false,
          durationMs: observation?.durationMs,
        },
      };

      if (observation?.success) {
        successCount++;
      }

      steps.push(step);
    }
  }

  // Calculate total duration
  const startTime = new Date(session.startTime).getTime();
  const endEvent = session.events[session.events.length - 1];
  const endTime = endEvent ? new Date(endEvent.timestamp).getTime() : Date.now();
  const totalDuration = endTime - startTime;

  // Build human-readable chain
  const chainText = buildChainText(steps);

  return {
    sessionId,
    runId,
    startTime: session.startTime,
    endTime: endEvent?.timestamp,
    steps,
    toolsUsed: [...toolsUsed],
    totalDuration,
    successRate: totalCount > 0 ? successCount / totalCount : 1,
    chainText,
  };
}

/**
 * Build human-readable chain text
 */
function buildChainText(steps: ReActStep[]): string {
  const lines: string[] = [];

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const stepNum = i + 1;

    if (step.thought) {
      lines.push(`[Step ${stepNum}] Thought: ${step.thought}`);
    }

    lines.push(`[Step ${stepNum}] Action: ${step.action.summary}`);
    lines.push(
      `[Step ${stepNum}] Observation: ${step.observation.success ? "✓" : "✗"} ${summarizeResult(step.observation.result, step.observation.success)}`,
    );
    lines.push("");
  }

  return lines.join("\n");
}

// ─────────────────────────────────────────────────────────────────────────────
// Distillation Integration
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Finalize trajectory and wire to distillation system
 *
 * High-quality trajectories (success + high fitness) get captured for few-shot learning.
 */
export async function finalizeTrajectory(
  sessionId: string,
  runId: string,
  taskDescription: string,
  success: boolean,
  fitness?: number,
): Promise<void> {
  const trajectory = reconstructTrajectory(sessionId, runId);

  if (!trajectory) {
    log.debug(`[trajectory] No trajectory to finalize: ${sessionId}:${runId}`);
    return;
  }

  // Only capture high-quality trajectories for distillation
  const effectiveFitness = fitness ?? trajectory.successRate;
  const isHighQuality = success && effectiveFitness >= 0.8;

  if (isHighQuality) {
    try {
      const distillation = await getDistillationSystem();

      // Convert to distillation format
      const steps: DistillationStep[] = trajectory.steps.map((s) => ({
        thought: s.thought,
        action: s.action.summary,
        tool: s.action.tool,
        observation: summarizeResult(s.observation.result, s.observation.success),
        success: s.observation.success,
      }));

      await distillation.logSuccessfulTrajectory(taskDescription, steps, {
        duration: trajectory.totalDuration,
        fitness: effectiveFitness,
      });

      log.info(
        `[trajectory] Captured high-quality trajectory for distillation: ${trajectory.steps.length} steps, fitness=${effectiveFitness.toFixed(2)}`,
      );
    } catch (error) {
      log.error(`[trajectory] Failed to log to distillation: ${error}`);
    }
  }

  // Persist trajectory log
  await persistTrajectory(trajectory, taskDescription, success, effectiveFitness);

  // Clean up active session
  const key = getSessionKey(sessionId, runId);
  activeSessions.delete(key);
}

/**
 * Persist trajectory to disk for later analysis
 */
async function persistTrajectory(
  trajectory: ReconstructedTrajectory,
  taskDescription: string,
  success: boolean,
  fitness: number,
): Promise<void> {
  const logPath = path.join(DEFAULT_AGENT_WORKSPACE_DIR, "memory", "trajectory-log.jsonl");

  const entry = {
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    sessionId: trajectory.sessionId,
    runId: trajectory.runId,
    taskDescription: taskDescription.slice(0, 500),
    success,
    fitness,
    duration: trajectory.totalDuration,
    stepCount: trajectory.steps.length,
    toolsUsed: trajectory.toolsUsed,
    successRate: trajectory.successRate,
    chainText: trajectory.chainText,
  };

  try {
    await fs.mkdir(path.dirname(logPath), { recursive: true });
    await fs.appendFile(logPath, JSON.stringify(entry) + "\n");
  } catch (error) {
    log.error(`[trajectory] Failed to persist: ${error}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Thought Inference
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Infer reasoning for a tool call based on tool name and arguments
 *
 * Used when explicit thought is not available (e.g., in standard tool execution flow).
 */
export function inferThought(tool: string, args: Record<string, unknown>): string {
  const toolPatterns: Record<string, (args: Record<string, unknown>) => string> = {
    Read: (a) => {
      const filePath = (a.path ?? a.file_path ?? "") as string;
      return `Reading file to understand ${filePath.split("/").pop() || "contents"}`;
    },
    Edit: (a) => {
      const filePath = (a.path ?? a.file_path ?? "") as string;
      return `Modifying ${filePath.split("/").pop() || "file"} to update code`;
    },
    Write: (a) => {
      const filePath = (a.path ?? a.file_path ?? "") as string;
      return `Creating/writing ${filePath.split("/").pop() || "file"}`;
    },
    exec: (a) => {
      const cmd = (a.command ?? "") as string;
      const cmdParts = cmd.split(" ");
      return `Executing ${cmdParts[0]} to ${inferExecPurpose(cmd)}`;
    },
    browser: (a) => {
      const action = (a.action ?? "interact") as string;
      return `Using browser to ${action} with web content`;
    },
    web_search: (a) => {
      const query = (a.query ?? "") as string;
      return `Searching web for: "${query.slice(0, 50)}"`;
    },
    web_fetch: (a) => {
      const url = (a.url ?? "") as string;
      return `Fetching content from ${new URL(url).hostname || url}`;
    },
    message: (a) => {
      const action = (a.action ?? "send") as string;
      const target = (a.target ?? "") as string;
      return `Sending ${action} message to ${target || "recipient"}`;
    },
    episodic_recall: (a) => {
      const query = (a.query ?? "") as string;
      return `Recalling past experiences related to: "${query.slice(0, 50)}"`;
    },
    semantic_query: (a) => {
      const query = (a.query ?? "") as string;
      return `Querying semantic memory for: "${query.slice(0, 50)}"`;
    },
    goal_push: () => "Setting up a goal to track progress",
    goal_pop: () => "Completing current goal",
    calibration_helper: (a) => {
      const action = (a.action ?? "") as string;
      return `Recording calibration ${action} for meta-learning`;
    },
    evolution_propose_patch: () => "Proposing a self-modification patch",
    evolution_run_dojo_test: () => "Running Dojo validation for code changes",
    meta_learning: (a) => {
      const action = (a.action ?? "") as string;
      return `Updating meta-learning: ${action}`;
    },
  };

  const inferFn = toolPatterns[tool];
  if (inferFn) {
    return inferFn(args);
  }

  // Generic fallback
  return `Using ${tool} tool to complete the task`;
}

function inferExecPurpose(command: string): string {
  const cmd = command.toLowerCase();

  if (cmd.includes("npm") || cmd.includes("yarn") || cmd.includes("pnpm")) {
    return "manage dependencies";
  }
  if (cmd.includes("git")) {
    return "interact with version control";
  }
  if (cmd.includes("test")) {
    return "run tests";
  }
  if (cmd.includes("build")) {
    return "build the project";
  }
  if (cmd.includes("ls") || cmd.includes("find") || cmd.includes("tree")) {
    return "explore file system";
  }
  if (cmd.includes("grep") || cmd.includes("rg") || cmd.includes("ag")) {
    return "search for patterns";
  }
  if (cmd.includes("cat") || cmd.includes("head") || cmd.includes("tail")) {
    return "view file contents";
  }
  if (cmd.includes("mkdir") || cmd.includes("cp") || cmd.includes("mv") || cmd.includes("rm")) {
    return "manipulate files/directories";
  }

  return "complete the operation";
}

// ─────────────────────────────────────────────────────────────────────────────
// Utility Functions
// ─────────────────────────────────────────────────────────────────────────────

function summarizeArgs(args: Record<string, unknown>): string {
  const important = ["path", "file_path", "command", "query", "action", "url", "target"];
  const parts: string[] = [];

  for (const key of important) {
    if (key in args && args[key]) {
      const value = String(args[key]).slice(0, 50);
      parts.push(`${key}="${value}${String(args[key]).length > 50 ? "..." : ""}"`);
      if (parts.length >= 2) break;
    }
  }

  return parts.join(", ");
}

function summarizeResult(result: string, success: boolean): string {
  if (!result) {
    return success ? "(completed successfully)" : "(failed)";
  }

  // Truncate long results
  const maxLen = 150;
  const cleaned = result.replace(/\n+/g, " ").replace(/\s+/g, " ").trim();

  if (cleaned.length <= maxLen) {
    return cleaned;
  }

  return cleaned.slice(0, maxLen) + "...";
}

// ─────────────────────────────────────────────────────────────────────────────
// Query Functions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Get all active sessions (for monitoring)
 */
export function getActiveSessions(): Array<{
  sessionId: string;
  runId: string;
  eventCount: number;
  startTime: string;
}> {
  return Array.from(activeSessions.values()).map((s) => ({
    sessionId: s.sessionId,
    runId: s.runId,
    eventCount: s.events.length,
    startTime: s.startTime,
  }));
}

/**
 * Get events for a session (for debugging)
 */
export function getSessionEvents(sessionId: string, runId: string): TrajectoryEvent[] {
  const key = getSessionKey(sessionId, runId);
  return activeSessions.get(key)?.events ?? [];
}

/**
 * Clear a specific session
 */
export function clearSession(sessionId: string, runId: string): void {
  const key = getSessionKey(sessionId, runId);
  activeSessions.delete(key);
}

/**
 * Clear all sessions (for testing)
 */
export function clearAllSessions(): void {
  activeSessions.clear();
}
