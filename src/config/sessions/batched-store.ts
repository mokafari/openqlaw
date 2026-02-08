import type { SessionEntry } from "./types.js";
import { updateSessionStore, updateSessionStoreEntry } from "./store.js";

interface QueuedSessionUpdate {
  storePath: string;
  sessionKey: string;
  pendingUpdate: Partial<SessionEntry>;
  timer: NodeJS.Timeout;
}

// Global queue for session updates
const sessionUpdateQueue = new Map<string, QueuedSessionUpdate>();

/**
 * Queues a session update to be batched with other updates within 500ms window.
 * This reduces I/O by debouncing frequent session updates.
 */
export function queueSessionUpdate(params: {
  storePath: string;
  sessionKey: string;
  update: Partial<SessionEntry>;
}): void {
  const key = params.sessionKey;
  const existing = sessionUpdateQueue.get(key);

  if (existing) {
    clearTimeout(existing.timer);
    // Merge updates - later updates override earlier ones for the same fields
    existing.pendingUpdate = { ...existing.pendingUpdate, ...params.update };
  } else {
    sessionUpdateQueue.set(key, {
      storePath: params.storePath,
      sessionKey: params.sessionKey,
      pendingUpdate: params.update,
      timer: null as any,
    });
  }

  const timer = setTimeout(() => flushSessionUpdate(key), 500);
  sessionUpdateQueue.get(key)!.timer = timer;
}

/**
 * Immediately flushes a pending session update.
 */
async function flushSessionUpdate(key: string): Promise<void> {
  const item = sessionUpdateQueue.get(key);
  if (!item) return;
  sessionUpdateQueue.delete(key);

  try {
    await updateSessionStoreEntry({
      storePath: item.storePath,
      sessionKey: item.sessionKey,
      update: async () => item.pendingUpdate,
    });
  } catch (err) {
    console.error(`Failed to flush batched session update for ${key}:`, err);
    // Re-queue the update for retry
    queueSessionUpdate({
      storePath: item.storePath,
      sessionKey: item.sessionKey,
      update: item.pendingUpdate,
    });
  }
}

/**
 * Queues a full session entry replacement update.
 */
export function queueSessionStoreUpdate(params: {
  storePath: string;
  sessionKey: string;
  entry: SessionEntry;
}): void {
  queueSessionUpdate({
    storePath: params.storePath,
    sessionKey: params.sessionKey,
    update: params.entry,
  });
}

/**
 * Flushes all pending session updates immediately.
 * Should be called on application shutdown.
 */
export async function flushAllSessionUpdates(): Promise<void> {
  const promises: Promise<void>[] = [];
  for (const key of Array.from(sessionUpdateQueue.keys())) {
    promises.push(flushSessionUpdate(key));
  }
  await Promise.allSettled(promises);
}

/**
 * Gets the count of pending updates in the queue.
 */
export function getPendingUpdateCount(): number {
  return sessionUpdateQueue.size;
}

// Flush all updates on process termination
process.on("SIGTERM", () => {
  void flushAllSessionUpdates();
});

process.on("SIGINT", () => {
  void flushAllSessionUpdates();
});

// Flush updates before process exit
process.on("beforeExit", () => {
  void flushAllSessionUpdates();
});
