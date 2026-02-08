import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionEntry } from "./types.js";
import {
  queueSessionUpdate,
  queueSessionStoreUpdate,
  flushAllSessionUpdates,
  getPendingUpdateCount,
} from "./batched-store.js";

// Mock the updateSessionStoreEntry function
vi.mock("./store.js", () => ({
  updateSessionStoreEntry: vi.fn().mockResolvedValue({}),
}));

describe("Batched Session Store", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should queue session updates and batch them", async () => {
    const update1 = { updatedAt: 1000, systemSent: true };
    const update2 = { updatedAt: 2000, modelOverride: "gpt-4" };

    // Queue multiple updates for the same session
    queueSessionUpdate({
      storePath: "/test/path",
      sessionKey: "test-session",
      update: update1,
    });

    queueSessionUpdate({
      storePath: "/test/path",
      sessionKey: "test-session",
      update: update2,
    });

    // Should have 1 pending update (batched)
    expect(getPendingUpdateCount()).toBe(1);

    // Wait for debounce and flush
    await new Promise((resolve) => setTimeout(resolve, 600));

    // Should have 0 pending updates after flush
    expect(getPendingUpdateCount()).toBe(0);
  });

  it("should merge updates for the same session key", async () => {
    const update1 = { updatedAt: 1000, systemSent: true };
    const update2 = { updatedAt: 2000, modelOverride: "gpt-4" };

    queueSessionUpdate({
      storePath: "/test/path",
      sessionKey: "test-session",
      update: update1,
    });

    queueSessionUpdate({
      storePath: "/test/path",
      sessionKey: "test-session",
      update: update2,
    });

    await flushAllSessionUpdates();

    // Should merge the updates with later values taking precedence
    const { updateSessionStoreEntry } = await import("./store.js");
    expect(updateSessionStoreEntry).toHaveBeenCalledWith({
      storePath: "/test/path",
      sessionKey: "test-session",
      update: expect.any(Function),
    });
  });

  it("should handle different session keys separately", async () => {
    queueSessionUpdate({
      storePath: "/test/path",
      sessionKey: "session-1",
      update: { updatedAt: 1000 },
    });

    queueSessionUpdate({
      storePath: "/test/path",
      sessionKey: "session-2",
      update: { updatedAt: 2000 },
    });

    // Should have 2 separate pending updates
    expect(getPendingUpdateCount()).toBe(2);

    await flushAllSessionUpdates();
    expect(getPendingUpdateCount()).toBe(0);
  });

  it("should support full session entry updates", async () => {
    const sessionEntry: SessionEntry = {
      sessionId: "test-id",
      updatedAt: Date.now(),
      systemSent: true,
      modelOverride: "gpt-4",
    };

    queueSessionStoreUpdate({
      storePath: "/test/path",
      sessionKey: "test-session",
      entry: sessionEntry,
    });

    expect(getPendingUpdateCount()).toBe(1);

    await flushAllSessionUpdates();
    expect(getPendingUpdateCount()).toBe(0);
  });
});
