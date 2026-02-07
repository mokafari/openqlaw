import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  createSession,
  loadSessionState,
  saveSessionState,
  updateSessionState,
  deleteSession,
  createCheckpoint,
  listCheckpoints,
  restoreFromCheckpoint,
  findRecoverableSessions,
  markSessionCrashed,
  recoverSession,
  setSharedState,
  getSharedState,
  deleteSharedState,
  listSharedStateKeys,
  createSessionSandbox,
  getSessionSandbox,
  isPathAllowed,
  hasCapability,
  loadSessionIndex,
  getSessionStats,
  cleanupOldSessions,
  type SessionState,
} from "./session-persistence.js";

describe("Session Persistence Layer", () => {
  // Note: These tests use the actual state directory
  // In a production setup, you'd mock the resolveStateDir function

  describe("Session CRUD", () => {
    let testSessionId: string;

    afterEach(async () => {
      if (testSessionId) {
        await deleteSession(testSessionId);
      }
    });

    it("should create a new session", async () => {
      const session = await createSession({
        channel: "test-channel",
        model: "gpt-4",
        provider: "openai",
        metadata: { testKey: "testValue" },
      });

      testSessionId = session.sessionId;

      expect(session.sessionId).toBeDefined();
      expect(session.channel).toBe("test-channel");
      expect(session.status).toBe("active");
      expect(session.context.model).toBe("gpt-4");
    });

    it("should load saved session state", async () => {
      const session = await createSession({
        channel: "test-channel",
        model: "gpt-4",
        provider: "openai",
      });
      testSessionId = session.sessionId;

      const loaded = await loadSessionState(session.sessionId);

      expect(loaded).not.toBeNull();
      expect(loaded?.sessionId).toBe(session.sessionId);
      expect(loaded?.channel).toBe("test-channel");
    });

    it("should update session state", async () => {
      const session = await createSession({
        channel: "test-channel",
        model: "gpt-4",
        provider: "openai",
      });
      testSessionId = session.sessionId;

      const updated = await updateSessionState(session.sessionId, {
        status: "suspended",
        metadata: { updated: true },
      });

      expect(updated?.status).toBe("suspended");
      expect(updated?.metadata.updated).toBe(true);
    });

    it("should delete session", async () => {
      const session = await createSession({
        channel: "test-channel",
        model: "gpt-4",
        provider: "openai",
      });
      testSessionId = session.sessionId;

      await deleteSession(session.sessionId);
      testSessionId = ""; // Clear since already deleted

      const loaded = await loadSessionState(session.sessionId);
      expect(loaded).toBeNull();
    });
  });

  describe("Checkpointing", () => {
    let testSessionId: string;

    afterEach(async () => {
      if (testSessionId) {
        await deleteSession(testSessionId);
      }
    });

    it("should create checkpoint", async () => {
      const session = await createSession({
        channel: "test-channel",
        model: "gpt-4",
        provider: "openai",
      });
      testSessionId = session.sessionId;

      const checkpoint = await createCheckpoint(session.sessionId, "test checkpoint");

      expect(checkpoint).not.toBeNull();
      expect(checkpoint?.sessionId).toBe(session.sessionId);
      expect(checkpoint?.reason).toBe("test checkpoint");
    });

    it("should list checkpoints", async () => {
      const session = await createSession({
        channel: "test-channel",
        model: "gpt-4",
        provider: "openai",
      });
      testSessionId = session.sessionId;

      await createCheckpoint(session.sessionId, "checkpoint 1");
      await createCheckpoint(session.sessionId, "checkpoint 2");

      const checkpoints = await listCheckpoints(session.sessionId);

      expect(checkpoints.length).toBeGreaterThanOrEqual(2);
    });

    it("should restore from checkpoint", async () => {
      const session = await createSession({
        channel: "test-channel",
        model: "gpt-4",
        provider: "openai",
        metadata: { original: true },
      });
      testSessionId = session.sessionId;

      await createCheckpoint(session.sessionId, "before changes");

      // Modify session
      await updateSessionState(session.sessionId, {
        metadata: { original: false, modified: true },
      });

      // Restore from checkpoint
      const restored = await restoreFromCheckpoint(session.sessionId);

      expect(restored).not.toBeNull();
      expect(restored?.metadata.original).toBe(true);
      expect(restored?.status).toBe("active");
    });
  });

  describe("Session Recovery", () => {
    let testSessionId: string;

    afterEach(async () => {
      if (testSessionId) {
        await deleteSession(testSessionId);
      }
    });

    it("should mark session as crashed", async () => {
      const session = await createSession({
        channel: "test-channel",
        model: "gpt-4",
        provider: "openai",
      });
      testSessionId = session.sessionId;

      await markSessionCrashed(session.sessionId, "Test crash error");

      const loaded = await loadSessionState(session.sessionId);
      expect(loaded?.status).toBe("crashed");
      expect(loaded?.metadata.crashError).toBe("Test crash error");
    });

    it("should find recoverable sessions", async () => {
      const session = await createSession({
        channel: "test-channel",
        model: "gpt-4",
        provider: "openai",
      });
      testSessionId = session.sessionId;

      await markSessionCrashed(session.sessionId, "crash");

      const recoverable = await findRecoverableSessions();

      expect(recoverable.some((s) => s.sessionId === session.sessionId)).toBe(true);
    });

    it("should recover crashed session", async () => {
      const session = await createSession({
        channel: "test-channel",
        model: "gpt-4",
        provider: "openai",
      });
      testSessionId = session.sessionId;

      await markSessionCrashed(session.sessionId, "crash");

      const recovered = await recoverSession(session.sessionId);

      expect(recovered).not.toBeNull();
      expect(recovered?.status).toBe("active");
      expect(recovered?.metadata.recovered).toBe(true);
    });

    it("should recover from checkpoint if available", async () => {
      const session = await createSession({
        channel: "test-channel",
        model: "gpt-4",
        provider: "openai",
        metadata: { checkpoint: true },
      });
      testSessionId = session.sessionId;

      await createCheckpoint(session.sessionId, "before crash");

      // Modify and crash
      await updateSessionState(session.sessionId, {
        metadata: { checkpoint: false, corrupted: true },
      });
      await markSessionCrashed(session.sessionId, "crash");

      const recovered = await recoverSession(session.sessionId);

      expect(recovered).not.toBeNull();
      // Should restore from checkpoint
      expect(recovered?.metadata.checkpoint).toBe(true);
    });
  });

  describe("Shared State", () => {
    const testKey = `test-key-${Date.now()}`;

    afterEach(async () => {
      await deleteSharedState(testKey);
    });

    it("should set and get shared state", async () => {
      await setSharedState(testKey, { value: 42, nested: { data: "test" } });

      const state = await getSharedState(testKey);

      expect(state).not.toBeNull();
      expect((state?.value as { value: number }).value).toBe(42);
    });

    it("should handle TTL expiration", async () => {
      await setSharedState(testKey, "short-lived", { ttlMs: 1 });

      // Wait for expiration
      await new Promise((resolve) => setTimeout(resolve, 10));

      const state = await getSharedState(testKey);

      expect(state).toBeNull();
    });

    it("should list shared state keys", async () => {
      await setSharedState(testKey, "test value");

      const keys = await listSharedStateKeys();

      expect(keys.includes(testKey)).toBe(true);
    });

    it("should delete shared state", async () => {
      await setSharedState(testKey, "to delete");
      await deleteSharedState(testKey);

      const state = await getSharedState(testKey);

      expect(state).toBeNull();
    });
  });

  describe("Session Sandboxing", () => {
    it("should create session sandbox", () => {
      const sandbox = createSessionSandbox("test-session", {
        workspaceDir: "/tmp/test-workspace",
        allowedPaths: ["/allowed/path"],
        deniedPaths: ["/denied/path"],
        capabilities: ["read", "write"],
      });

      expect(sandbox.sessionId).toBe("test-session");
      expect(sandbox.workspaceDir).toBe("/tmp/test-workspace");
      expect(sandbox.allowedPaths).toContain("/allowed/path");
      expect(sandbox.capabilities.has("read")).toBe(true);
    });

    it("should check path permissions", () => {
      createSessionSandbox("test-session-2", {
        workspaceDir: "/workspace",
        allowedPaths: ["/allowed"],
        deniedPaths: ["/denied"],
      });

      // Within workspace
      expect(isPathAllowed("test-session-2", "/workspace/file.ts")).toBe(true);

      // Allowed path
      expect(isPathAllowed("test-session-2", "/allowed/file.ts")).toBe(true);

      // Denied path
      expect(isPathAllowed("test-session-2", "/denied/secret.ts")).toBe(false);
    });

    it("should check capabilities", () => {
      createSessionSandbox("test-session-3", {
        capabilities: ["read", "write"],
      });

      expect(hasCapability("test-session-3", "read")).toBe(true);
      expect(hasCapability("test-session-3", "exec")).toBe(false);
    });

    it("should allow all for sessions without sandbox", () => {
      // Session without sandbox
      expect(isPathAllowed("no-sandbox-session", "/any/path")).toBe(true);
      expect(hasCapability("no-sandbox-session", "anything")).toBe(true);
    });
  });

  describe("Session Statistics", () => {
    let testSessionId: string;

    afterEach(async () => {
      if (testSessionId) {
        await deleteSession(testSessionId);
      }
    });

    it("should get session statistics", async () => {
      const session = await createSession({
        channel: "test-channel",
        model: "gpt-4",
        provider: "openai",
      });
      testSessionId = session.sessionId;

      const stats = await getSessionStats();

      expect(stats.totalSessions).toBeGreaterThanOrEqual(1);
      expect(stats.activeSessions).toBeGreaterThanOrEqual(1);
    });

    it("should load session index", async () => {
      const session = await createSession({
        channel: "test-channel",
        model: "gpt-4",
        provider: "openai",
      });
      testSessionId = session.sessionId;

      const index = await loadSessionIndex();

      expect(index.sessions[session.sessionId]).toBeDefined();
      expect(index.sessions[session.sessionId].channel).toBe("test-channel");
    });
  });

  describe("Cleanup", () => {
    it("should cleanup old sessions", async () => {
      const session = await createSession({
        channel: "cleanup-test",
        model: "gpt-4",
        provider: "openai",
      });

      // Force update lastActiveAt to be old
      const state = await loadSessionState(session.sessionId);
      if (state) {
        state.lastActiveAt = Date.now() - 30 * 24 * 60 * 60 * 1000; // 30 days ago
        await saveSessionState(state);
      }

      const result = await cleanupOldSessions({ maxAgeMs: 24 * 60 * 60 * 1000 }); // 1 day

      expect(result.deleted).toBeGreaterThanOrEqual(1);

      const loaded = await loadSessionState(session.sessionId);
      expect(loaded).toBeNull();
    });
  });
});
