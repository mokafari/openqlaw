/**
 * Session Persistence Layer
 *
 * Provides robust session state management with:
 * - Save session state to disk
 * - Restore state after crash/restart
 * - Cross-session state sharing
 * - Session isolation/sandboxing
 *
 * Enables session recovery and continuity across restarts.
 */

import crypto from "crypto";
import { promises as fs } from "fs";
import path from "path";
import { resolveStateDir } from "../../config/paths.js";

// ============================================================================
// Types
// ============================================================================

export interface SessionState {
  sessionId: string;
  sessionKey?: string;
  channel: string;
  createdAt: number;
  lastActiveAt: number;
  checkpointedAt?: number;
  status: "active" | "suspended" | "terminated" | "crashed";
  metadata: Record<string, unknown>;
  context: SessionContext;
  goals?: GoalState[];
  toolState?: Record<string, unknown>;
}

export interface SessionContext {
  model: string;
  provider: string;
  systemPrompt?: string;
  conversationHistory?: ConversationEntry[];
  workspaceDir?: string;
  currentFile?: string;
  environment?: Record<string, string>;
}

export interface ConversationEntry {
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: number;
  toolCalls?: Array<{
    name: string;
    params: Record<string, unknown>;
    result?: unknown;
  }>;
}

export interface GoalState {
  id: string;
  description: string;
  type: "task" | "obstacle" | "subgoal";
  status: "active" | "blocked" | "completed";
  parentId?: string;
  createdAt: number;
  completedAt?: number;
  metadata?: Record<string, unknown>;
}

export interface SessionCheckpoint {
  checkpointId: string;
  sessionId: string;
  timestamp: number;
  state: SessionState;
  reason?: string;
}

export interface SessionIndex {
  sessions: Record<
    string,
    {
      sessionId: string;
      sessionKey?: string;
      channel: string;
      status: SessionState["status"];
      createdAt: number;
      lastActiveAt: number;
      checkpointCount: number;
    }
  >;
  lastUpdated: number;
}

// ============================================================================
// Constants
// ============================================================================

const SESSIONS_DIR = path.join(resolveStateDir(), "sessions");
const SESSION_INDEX_FILE = path.join(SESSIONS_DIR, "index.json");
const MAX_CHECKPOINTS_PER_SESSION = 10;
const CHECKPOINT_INTERVAL_MS = 60_000; // 1 minute

// ============================================================================
// Session Directory Management
// ============================================================================

/**
 * Ensure sessions directory exists.
 */
async function ensureSessionsDir(): Promise<void> {
  await fs.mkdir(SESSIONS_DIR, { recursive: true });
}

/**
 * Get path to session directory.
 */
function getSessionDir(sessionId: string): string {
  // Use first 4 chars as subdirectory for organization
  const prefix = sessionId.slice(0, 4);
  return path.join(SESSIONS_DIR, prefix, sessionId);
}

/**
 * Get path to session state file.
 */
function getSessionStatePath(sessionId: string): string {
  return path.join(getSessionDir(sessionId), "state.json");
}

/**
 * Get path to checkpoint file.
 */
function getCheckpointPath(sessionId: string, checkpointId: string): string {
  return path.join(getSessionDir(sessionId), "checkpoints", `${checkpointId}.json`);
}

// ============================================================================
// Session Index
// ============================================================================

/**
 * Load session index.
 */
export async function loadSessionIndex(): Promise<SessionIndex> {
  try {
    const content = await fs.readFile(SESSION_INDEX_FILE, "utf-8");
    return JSON.parse(content) as SessionIndex;
  } catch {
    return { sessions: {}, lastUpdated: Date.now() };
  }
}

/**
 * Save session index.
 */
async function saveSessionIndex(index: SessionIndex): Promise<void> {
  await ensureSessionsDir();
  index.lastUpdated = Date.now();
  await fs.writeFile(SESSION_INDEX_FILE, JSON.stringify(index, null, 2), "utf-8");
}

/**
 * Update session in index.
 */
async function updateSessionInIndex(
  sessionId: string,
  updates: Partial<SessionIndex["sessions"][string]>,
): Promise<void> {
  const index = await loadSessionIndex();

  if (!index.sessions[sessionId]) {
    index.sessions[sessionId] = {
      sessionId,
      channel: "",
      status: "active",
      createdAt: Date.now(),
      lastActiveAt: Date.now(),
      checkpointCount: 0,
      ...updates,
    };
  } else {
    Object.assign(index.sessions[sessionId], updates);
  }

  await saveSessionIndex(index);
}

// ============================================================================
// Session State Management
// ============================================================================

/**
 * Create a new session.
 */
export async function createSession(params: {
  sessionId?: string;
  sessionKey?: string;
  channel: string;
  model: string;
  provider: string;
  metadata?: Record<string, unknown>;
}): Promise<SessionState> {
  const sessionId = params.sessionId ?? crypto.randomUUID();

  const state: SessionState = {
    sessionId,
    sessionKey: params.sessionKey,
    channel: params.channel,
    createdAt: Date.now(),
    lastActiveAt: Date.now(),
    status: "active",
    metadata: params.metadata ?? {},
    context: {
      model: params.model,
      provider: params.provider,
      conversationHistory: [],
    },
    goals: [],
    toolState: {},
  };

  await saveSessionState(state);
  await updateSessionInIndex(sessionId, {
    sessionId,
    sessionKey: params.sessionKey,
    channel: params.channel,
    status: "active",
    createdAt: state.createdAt,
    lastActiveAt: state.lastActiveAt,
    checkpointCount: 0,
  });

  return state;
}

/**
 * Save session state to disk.
 */
export async function saveSessionState(state: SessionState): Promise<void> {
  const sessionDir = getSessionDir(state.sessionId);
  await fs.mkdir(sessionDir, { recursive: true });

  const statePath = getSessionStatePath(state.sessionId);
  state.lastActiveAt = Date.now();

  await fs.writeFile(statePath, JSON.stringify(state, null, 2), "utf-8");

  await updateSessionInIndex(state.sessionId, {
    status: state.status,
    lastActiveAt: state.lastActiveAt,
  });
}

/**
 * Load session state from disk.
 */
export async function loadSessionState(sessionId: string): Promise<SessionState | null> {
  try {
    const statePath = getSessionStatePath(sessionId);
    const content = await fs.readFile(statePath, "utf-8");
    return JSON.parse(content) as SessionState;
  } catch {
    return null;
  }
}

/**
 * Update session state partially.
 */
export async function updateSessionState(
  sessionId: string,
  updates: Partial<Omit<SessionState, "sessionId" | "createdAt">>,
): Promise<SessionState | null> {
  const state = await loadSessionState(sessionId);
  if (!state) return null;

  Object.assign(state, updates);
  state.lastActiveAt = Date.now();

  await saveSessionState(state);
  return state;
}

/**
 * Delete session and all its data.
 */
export async function deleteSession(sessionId: string): Promise<void> {
  const sessionDir = getSessionDir(sessionId);

  try {
    await fs.rm(sessionDir, { recursive: true, force: true });
  } catch {
    // Directory might not exist
  }

  const index = await loadSessionIndex();
  delete index.sessions[sessionId];
  await saveSessionIndex(index);
}

// ============================================================================
// Checkpointing
// ============================================================================

/**
 * Create a checkpoint of session state.
 */
export async function createCheckpoint(
  sessionId: string,
  reason?: string,
): Promise<SessionCheckpoint | null> {
  const state = await loadSessionState(sessionId);
  if (!state) return null;

  const checkpointId = `cp-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
  const checkpoint: SessionCheckpoint = {
    checkpointId,
    sessionId,
    timestamp: Date.now(),
    state: { ...state, checkpointedAt: Date.now() },
    reason,
  };

  const checkpointPath = getCheckpointPath(sessionId, checkpointId);
  await fs.mkdir(path.dirname(checkpointPath), { recursive: true });
  await fs.writeFile(checkpointPath, JSON.stringify(checkpoint, null, 2), "utf-8");

  // Update checkpoint count
  await updateSessionInIndex(sessionId, {
    checkpointCount: (await listCheckpoints(sessionId)).length,
  });

  // Prune old checkpoints
  await pruneCheckpoints(sessionId);

  // Update state with checkpoint time
  state.checkpointedAt = checkpoint.timestamp;
  await saveSessionState(state);

  return checkpoint;
}

/**
 * List all checkpoints for a session.
 */
export async function listCheckpoints(sessionId: string): Promise<SessionCheckpoint[]> {
  const checkpointsDir = path.join(getSessionDir(sessionId), "checkpoints");

  try {
    const files = await fs.readdir(checkpointsDir);
    const checkpoints: SessionCheckpoint[] = [];

    for (const file of files) {
      if (file.endsWith(".json")) {
        try {
          const content = await fs.readFile(path.join(checkpointsDir, file), "utf-8");
          checkpoints.push(JSON.parse(content) as SessionCheckpoint);
        } catch {
          continue;
        }
      }
    }

    return checkpoints.sort((a, b) => b.timestamp - a.timestamp);
  } catch {
    return [];
  }
}

/**
 * Restore session from a checkpoint.
 */
export async function restoreFromCheckpoint(
  sessionId: string,
  checkpointId?: string,
): Promise<SessionState | null> {
  const checkpoints = await listCheckpoints(sessionId);
  if (checkpoints.length === 0) return null;

  const checkpoint = checkpointId
    ? checkpoints.find((c) => c.checkpointId === checkpointId)
    : checkpoints[0]; // Latest checkpoint

  if (!checkpoint) return null;

  // Restore state
  const restoredState = {
    ...checkpoint.state,
    status: "active" as const,
    lastActiveAt: Date.now(),
  };

  await saveSessionState(restoredState);
  return restoredState;
}

/**
 * Prune old checkpoints to keep only the most recent ones.
 */
async function pruneCheckpoints(sessionId: string): Promise<void> {
  const checkpoints = await listCheckpoints(sessionId);

  if (checkpoints.length <= MAX_CHECKPOINTS_PER_SESSION) return;

  const toDelete = checkpoints.slice(MAX_CHECKPOINTS_PER_SESSION);
  for (const checkpoint of toDelete) {
    const checkpointPath = getCheckpointPath(sessionId, checkpoint.checkpointId);
    try {
      await fs.unlink(checkpointPath);
    } catch {
      // Ignore deletion errors
    }
  }
}

// ============================================================================
// Session Recovery
// ============================================================================

/**
 * Find crashed or suspended sessions.
 */
export async function findRecoverableSessions(): Promise<SessionState[]> {
  const index = await loadSessionIndex();
  const recoverable: SessionState[] = [];

  for (const entry of Object.values(index.sessions)) {
    if (entry.status === "crashed" || entry.status === "suspended") {
      const state = await loadSessionState(entry.sessionId);
      if (state) {
        recoverable.push(state);
      }
    }
  }

  return recoverable;
}

/**
 * Mark session as crashed (for recovery detection).
 */
export async function markSessionCrashed(sessionId: string, error?: string): Promise<void> {
  const state = await loadSessionState(sessionId);
  if (!state) return;

  state.status = "crashed";
  state.metadata.crashError = error;
  state.metadata.crashTime = Date.now();

  await saveSessionState(state);
}

/**
 * Recover a crashed session.
 */
export async function recoverSession(sessionId: string): Promise<SessionState | null> {
  const state = await loadSessionState(sessionId);
  if (!state || state.status !== "crashed") return null;

  // Try to restore from latest checkpoint
  const checkpoints = await listCheckpoints(sessionId);
  if (checkpoints.length > 0) {
    return restoreFromCheckpoint(sessionId);
  }

  // No checkpoints, just mark as active
  state.status = "active";
  state.metadata.recovered = true;
  state.metadata.recoveredAt = Date.now();

  await saveSessionState(state);
  return state;
}

// ============================================================================
// Cross-Session State Sharing
// ============================================================================

export interface SharedState {
  key: string;
  value: unknown;
  createdAt: number;
  updatedAt: number;
  ownerSessionId?: string;
  expiresAt?: number;
}

const SHARED_STATE_DIR = path.join(SESSIONS_DIR, "_shared");

/**
 * Set shared state accessible by all sessions.
 */
export async function setSharedState(
  key: string,
  value: unknown,
  options?: { ownerSessionId?: string; ttlMs?: number },
): Promise<void> {
  await fs.mkdir(SHARED_STATE_DIR, { recursive: true });

  const state: SharedState = {
    key,
    value,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ownerSessionId: options?.ownerSessionId,
    expiresAt: options?.ttlMs ? Date.now() + options.ttlMs : undefined,
  };

  const statePath = path.join(SHARED_STATE_DIR, `${encodeURIComponent(key)}.json`);
  await fs.writeFile(statePath, JSON.stringify(state, null, 2), "utf-8");
}

/**
 * Get shared state.
 */
export async function getSharedState(key: string): Promise<SharedState | null> {
  try {
    const statePath = path.join(SHARED_STATE_DIR, `${encodeURIComponent(key)}.json`);
    const content = await fs.readFile(statePath, "utf-8");
    const state = JSON.parse(content) as SharedState;

    // Check expiration
    if (state.expiresAt && Date.now() > state.expiresAt) {
      await deleteSharedState(key);
      return null;
    }

    return state;
  } catch {
    return null;
  }
}

/**
 * Delete shared state.
 */
export async function deleteSharedState(key: string): Promise<void> {
  try {
    const statePath = path.join(SHARED_STATE_DIR, `${encodeURIComponent(key)}.json`);
    await fs.unlink(statePath);
  } catch {
    // State doesn't exist
  }
}

/**
 * List all shared state keys.
 */
export async function listSharedStateKeys(): Promise<string[]> {
  try {
    const files = await fs.readdir(SHARED_STATE_DIR);
    return files.filter((f) => f.endsWith(".json")).map((f) => decodeURIComponent(f.slice(0, -5)));
  } catch {
    return [];
  }
}

// ============================================================================
// Session Isolation / Sandboxing
// ============================================================================

export interface SessionSandbox {
  sessionId: string;
  workspaceDir: string;
  allowedPaths: string[];
  deniedPaths: string[];
  capabilities: Set<string>;
}

const SESSION_SANDBOXES = new Map<string, SessionSandbox>();

/**
 * Create a sandbox for a session.
 */
export function createSessionSandbox(
  sessionId: string,
  options?: {
    workspaceDir?: string;
    allowedPaths?: string[];
    deniedPaths?: string[];
    capabilities?: string[];
  },
): SessionSandbox {
  const sandbox: SessionSandbox = {
    sessionId,
    workspaceDir: options?.workspaceDir ?? path.join(SESSIONS_DIR, sessionId, "workspace"),
    allowedPaths: options?.allowedPaths ?? [],
    deniedPaths: options?.deniedPaths ?? ["/etc", "/var", "/usr", "/System"],
    capabilities: new Set(options?.capabilities ?? ["read", "write", "exec"]),
  };

  SESSION_SANDBOXES.set(sessionId, sandbox);
  return sandbox;
}

/**
 * Get sandbox for a session.
 */
export function getSessionSandbox(sessionId: string): SessionSandbox | undefined {
  return SESSION_SANDBOXES.get(sessionId);
}

/**
 * Check if a path is allowed by sandbox.
 */
export function isPathAllowed(sessionId: string, targetPath: string): boolean {
  const sandbox = SESSION_SANDBOXES.get(sessionId);
  if (!sandbox) return true; // No sandbox = everything allowed

  const normalizedPath = path.normalize(targetPath);

  // Check denied paths first
  for (const denied of sandbox.deniedPaths) {
    if (normalizedPath.startsWith(denied)) {
      return false;
    }
  }

  // Check if within workspace
  if (normalizedPath.startsWith(sandbox.workspaceDir)) {
    return true;
  }

  // Check allowed paths
  for (const allowed of sandbox.allowedPaths) {
    if (normalizedPath.startsWith(allowed)) {
      return true;
    }
  }

  return false;
}

/**
 * Check if session has a capability.
 */
export function hasCapability(sessionId: string, capability: string): boolean {
  const sandbox = SESSION_SANDBOXES.get(sessionId);
  if (!sandbox) return true; // No sandbox = all capabilities
  return sandbox.capabilities.has(capability);
}

// ============================================================================
// Automatic Checkpointing
// ============================================================================

const CHECKPOINT_TIMERS = new Map<string, NodeJS.Timeout>();

/**
 * Start automatic checkpointing for a session.
 */
export function startAutoCheckpointing(
  sessionId: string,
  intervalMs: number = CHECKPOINT_INTERVAL_MS,
): void {
  // Clear existing timer
  stopAutoCheckpointing(sessionId);

  const timer = setInterval(async () => {
    const state = await loadSessionState(sessionId);
    if (state && state.status === "active") {
      await createCheckpoint(sessionId, "auto");
    } else {
      // Session no longer active, stop checkpointing
      stopAutoCheckpointing(sessionId);
    }
  }, intervalMs);

  CHECKPOINT_TIMERS.set(sessionId, timer);
}

/**
 * Stop automatic checkpointing for a session.
 */
export function stopAutoCheckpointing(sessionId: string): void {
  const timer = CHECKPOINT_TIMERS.get(sessionId);
  if (timer) {
    clearInterval(timer);
    CHECKPOINT_TIMERS.delete(sessionId);
  }
}

// ============================================================================
// Session Statistics
// ============================================================================

/**
 * Get session statistics.
 */
export async function getSessionStats(): Promise<{
  totalSessions: number;
  activeSessions: number;
  crashedSessions: number;
  suspendedSessions: number;
  totalCheckpoints: number;
  sharedStateKeys: number;
}> {
  const index = await loadSessionIndex();
  const sessions = Object.values(index.sessions);

  let totalCheckpoints = 0;
  for (const session of sessions) {
    totalCheckpoints += session.checkpointCount;
  }

  const sharedStateKeys = (await listSharedStateKeys()).length;

  return {
    totalSessions: sessions.length,
    activeSessions: sessions.filter((s) => s.status === "active").length,
    crashedSessions: sessions.filter((s) => s.status === "crashed").length,
    suspendedSessions: sessions.filter((s) => s.status === "suspended").length,
    totalCheckpoints,
    sharedStateKeys,
  };
}

// ============================================================================
// Cleanup
// ============================================================================

/**
 * Clean up old sessions.
 */
export async function cleanupOldSessions(options?: {
  maxAgeMs?: number;
  keepCrashed?: boolean;
}): Promise<{ deleted: number; kept: number }> {
  const maxAgeMs = options?.maxAgeMs ?? 7 * 24 * 60 * 60 * 1000; // 7 days
  const keepCrashed = options?.keepCrashed ?? true;
  const now = Date.now();

  const index = await loadSessionIndex();
  let deleted = 0;
  let kept = 0;

  for (const session of Object.values(index.sessions)) {
    const age = now - session.lastActiveAt;

    if (age > maxAgeMs) {
      if (keepCrashed && session.status === "crashed") {
        kept++;
        continue;
      }

      await deleteSession(session.sessionId);
      deleted++;
    } else {
      kept++;
    }
  }

  return { deleted, kept };
}
