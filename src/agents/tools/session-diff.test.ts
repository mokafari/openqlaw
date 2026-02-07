/**
 * Tests for session-diff tool
 */

import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  loadSession,
  compareSessions,
  compareLatest,
  highlightDivergence,
  extractPattern,
  listSessions,
  createSessionDiffTool,
  type SessionSummary,
  type SessionDiff,
} from "./session-diff.js";

// Mock session data
function createMockSessionJsonl(options: {
  sessionId: string;
  model?: string;
  provider?: string;
  toolCalls?: Array<{
    name: string;
    turnIndex: number;
    success: boolean;
    durationMs: number;
    error?: string;
  }>;
}): string {
  const lines: string[] = [];
  const baseTime = Date.now();

  // Session header
  lines.push(
    JSON.stringify({
      type: "session",
      version: 3,
      id: options.sessionId,
      timestamp: new Date(baseTime).toISOString(),
      cwd: "/test/workspace",
    }),
  );

  // Model change
  lines.push(
    JSON.stringify({
      type: "model_change",
      id: "model1",
      parentId: null,
      timestamp: new Date(baseTime + 1).toISOString(),
      provider: options.provider ?? "anthropic",
      modelId: options.model ?? "claude-opus-4-5",
    }),
  );

  let lastId = "model1";
  let currentTurn = 0;
  let callIndex = 0;

  for (const call of options.toolCalls ?? []) {
    // Add user message if new turn
    if (call.turnIndex > currentTurn) {
      currentTurn = call.turnIndex;
      const userMsgId = `user-${currentTurn}`;
      lines.push(
        JSON.stringify({
          type: "message",
          id: userMsgId,
          parentId: lastId,
          timestamp: new Date(baseTime + callIndex * 1000).toISOString(),
          message: {
            role: "user",
            content: [{ type: "text", text: `User message turn ${currentTurn}` }],
            timestamp: baseTime + callIndex * 1000,
          },
        }),
      );
      lastId = userMsgId;
      callIndex++;
    }

    // Tool call from assistant
    const toolCallId = `call-${callIndex}`;
    const assistantMsgId = `assistant-${callIndex}`;
    lines.push(
      JSON.stringify({
        type: "message",
        id: assistantMsgId,
        parentId: lastId,
        timestamp: new Date(baseTime + callIndex * 1000).toISOString(),
        message: {
          role: "assistant",
          content: [
            {
              type: "toolCall",
              id: toolCallId,
              name: call.name,
              arguments: {},
            },
          ],
          usage: { input: 100, output: 50, cacheRead: 0, cacheWrite: 0 },
          stopReason: "toolUse",
          timestamp: baseTime + callIndex * 1000,
        },
      }),
    );
    lastId = assistantMsgId;
    callIndex++;

    // Tool result
    const resultMsgId = `result-${callIndex}`;
    lines.push(
      JSON.stringify({
        type: "message",
        id: resultMsgId,
        parentId: lastId,
        timestamp: new Date(baseTime + callIndex * 1000 + call.durationMs).toISOString(),
        message: {
          role: "toolResult",
          toolCallId: toolCallId,
          toolName: call.name,
          content: [
            {
              type: "text",
              text: call.success ? "success" : (call.error ?? "error occurred"),
            },
          ],
        },
        details: {
          status: call.success ? "completed" : "error",
          durationMs: call.durationMs,
          error: call.error,
        },
        isError: !call.success,
      }),
    );
    lastId = resultMsgId;
    callIndex++;
  }

  return lines.join("\n");
}

describe("session-diff", () => {
  let tempDir: string;
  let basePath: string;
  let sessionsDir: string;

  beforeEach(async () => {
    // Create temp directory structure
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "session-diff-test-"));
    basePath = tempDir;
    sessionsDir = path.join(tempDir, "agents", "main", "sessions");
    await fs.mkdir(sessionsDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe("listSessions", () => {
    it("should list available sessions sorted by mtime", async () => {
      // Create test sessions
      await fs.writeFile(
        path.join(sessionsDir, "session-a.jsonl"),
        createMockSessionJsonl({ sessionId: "session-a" }),
      );
      await new Promise((r) => setTimeout(r, 10)); // Ensure different mtime
      await fs.writeFile(
        path.join(sessionsDir, "session-b.jsonl"),
        createMockSessionJsonl({ sessionId: "session-b" }),
      );

      const sessions = await listSessions("main", basePath);

      expect(sessions.length).toBe(2);
      expect(sessions[0].sessionId).toBe("session-b"); // Most recent first
      expect(sessions[1].sessionId).toBe("session-a");
    });

    it("should exclude deleted sessions", async () => {
      await fs.writeFile(
        path.join(sessionsDir, "active.jsonl"),
        createMockSessionJsonl({ sessionId: "active" }),
      );
      await fs.writeFile(
        path.join(sessionsDir, "deleted.jsonl.deleted.2024-01-01"),
        createMockSessionJsonl({ sessionId: "deleted" }),
      );

      const sessions = await listSessions("main", basePath);

      expect(sessions.length).toBe(1);
      expect(sessions[0].sessionId).toBe("active");
    });
  });

  describe("loadSession", () => {
    it("should load and summarize a session", async () => {
      await fs.writeFile(
        path.join(sessionsDir, "test-session.jsonl"),
        createMockSessionJsonl({
          sessionId: "test-session",
          model: "claude-opus-4-5",
          provider: "anthropic",
          toolCalls: [
            { name: "exec", turnIndex: 1, success: true, durationMs: 100 },
            { name: "exec", turnIndex: 1, success: true, durationMs: 200 },
            { name: "read", turnIndex: 2, success: false, durationMs: 50, error: "File not found" },
          ],
        }),
      );

      const summary = await loadSession("test-session", "main", basePath);

      expect(summary.sessionId).toBe("test-session");
      expect(summary.turns).toBe(2);
      expect(summary.model).toBe("claude-opus-4-5");
      expect(summary.provider).toBe("anthropic");

      // Check tool call stats
      const execStats = summary.toolCalls.find((t) => t.tool === "exec");
      expect(execStats?.count).toBe(2);
      expect(execStats?.errorRate).toBe(0);
      expect(execStats?.avgDurationMs).toBe(150);

      const readStats = summary.toolCalls.find((t) => t.tool === "read");
      expect(readStats?.count).toBe(1);
      expect(readStats?.errorRate).toBe(1);

      // Check errors
      expect(summary.errors.length).toBe(1);
      expect(summary.errors[0]).toContain("File not found");
    });

    it("should handle empty sessions", async () => {
      await fs.writeFile(
        path.join(sessionsDir, "empty.jsonl"),
        createMockSessionJsonl({
          sessionId: "empty",
          toolCalls: [],
        }),
      );

      const summary = await loadSession("empty", "main", basePath);

      expect(summary.sessionId).toBe("empty");
      expect(summary.turns).toBe(0);
      expect(summary.toolCalls.length).toBe(0);
      expect(summary.errors.length).toBe(0);
    });
  });

  describe("compareSessions", () => {
    it("should detect tool usage differences", async () => {
      await fs.writeFile(
        path.join(sessionsDir, "session-a.jsonl"),
        createMockSessionJsonl({
          sessionId: "session-a",
          toolCalls: [
            { name: "exec", turnIndex: 1, success: true, durationMs: 100 },
            { name: "read", turnIndex: 2, success: true, durationMs: 50 },
          ],
        }),
      );
      await fs.writeFile(
        path.join(sessionsDir, "session-b.jsonl"),
        createMockSessionJsonl({
          sessionId: "session-b",
          toolCalls: [
            { name: "exec", turnIndex: 1, success: true, durationMs: 100 },
            { name: "write", turnIndex: 2, success: true, durationMs: 50 },
          ],
        }),
      );

      const diff = await compareSessions("session-a", "session-b", "main", basePath);

      expect(diff.sessionA.sessionId).toBe("session-a");
      expect(diff.sessionB.sessionId).toBe("session-b");

      // Check tool usage changes
      expect(diff.behaviorShift.toolUsage.added).toContain("write");
      expect(diff.behaviorShift.toolUsage.removed).toContain("read");
    });

    it("should detect error rate changes", async () => {
      await fs.writeFile(
        path.join(sessionsDir, "good-session.jsonl"),
        createMockSessionJsonl({
          sessionId: "good-session",
          toolCalls: [
            { name: "exec", turnIndex: 1, success: true, durationMs: 100 },
            { name: "exec", turnIndex: 2, success: true, durationMs: 100 },
          ],
        }),
      );
      await fs.writeFile(
        path.join(sessionsDir, "bad-session.jsonl"),
        createMockSessionJsonl({
          sessionId: "bad-session",
          toolCalls: [
            { name: "exec", turnIndex: 1, success: false, durationMs: 100, error: "Failed" },
            { name: "exec", turnIndex: 2, success: true, durationMs: 100 },
          ],
        }),
      );

      const diff = await compareSessions("good-session", "bad-session", "main", basePath);

      expect(diff.behaviorShift.errorRate.sessionA).toBe(0);
      expect(diff.behaviorShift.errorRate.sessionB).toBe(0.5);
      expect(diff.behaviorShift.errorRate.direction).toBe("worse");
    });

    it("should detect latency regressions", async () => {
      await fs.writeFile(
        path.join(sessionsDir, "fast-session.jsonl"),
        createMockSessionJsonl({
          sessionId: "fast-session",
          toolCalls: [{ name: "exec", turnIndex: 1, success: true, durationMs: 100 }],
        }),
      );
      await fs.writeFile(
        path.join(sessionsDir, "slow-session.jsonl"),
        createMockSessionJsonl({
          sessionId: "slow-session",
          toolCalls: [{ name: "exec", turnIndex: 1, success: true, durationMs: 5000 }],
        }),
      );

      const diff = await compareSessions("fast-session", "slow-session", "main", basePath);

      expect(diff.behaviorShift.avgLatency.sessionA).toBe(100);
      expect(diff.behaviorShift.avgLatency.sessionB).toBe(5000);
      expect(diff.behaviorShift.avgLatency.direction).toBe("worse");
    });

    it("should identify divergence points", async () => {
      await fs.writeFile(
        path.join(sessionsDir, "success-session.jsonl"),
        createMockSessionJsonl({
          sessionId: "success-session",
          toolCalls: [{ name: "exec", turnIndex: 1, success: true, durationMs: 100 }],
        }),
      );
      await fs.writeFile(
        path.join(sessionsDir, "failure-session.jsonl"),
        createMockSessionJsonl({
          sessionId: "failure-session",
          toolCalls: [
            {
              name: "exec",
              turnIndex: 1,
              success: false,
              durationMs: 100,
              error: "Command failed",
            },
          ],
        }),
      );

      const diff = await compareSessions("success-session", "failure-session", "main", basePath);

      expect(diff.divergencePoints.length).toBeGreaterThan(0);
      const point = diff.divergencePoints[0];
      expect(point.turnIndex).toBe(1);
      expect(point.sessionA.result).toBe("success");
      expect(point.sessionB.result).toBe("error");
    });
  });

  describe("compareLatest", () => {
    it("should compare latest N sessions", async () => {
      await fs.writeFile(
        path.join(sessionsDir, "oldest.jsonl"),
        createMockSessionJsonl({ sessionId: "oldest" }),
      );
      await new Promise((r) => setTimeout(r, 10));
      await fs.writeFile(
        path.join(sessionsDir, "middle.jsonl"),
        createMockSessionJsonl({ sessionId: "middle" }),
      );
      await new Promise((r) => setTimeout(r, 10));
      await fs.writeFile(
        path.join(sessionsDir, "newest.jsonl"),
        createMockSessionJsonl({ sessionId: "newest" }),
      );

      const diffs = await compareLatest(3, undefined, "main", basePath);

      expect(diffs.length).toBe(2); // Comparing consecutive pairs
      expect(diffs[0].sessionA.sessionId).toBe("newest");
      expect(diffs[0].sessionB.sessionId).toBe("middle");
      expect(diffs[1].sessionA.sessionId).toBe("middle");
      expect(diffs[1].sessionB.sessionId).toBe("oldest");
    });

    it("should filter sessions by pattern", async () => {
      await fs.writeFile(
        path.join(sessionsDir, "test-a.jsonl"),
        createMockSessionJsonl({ sessionId: "test-a" }),
      );
      await fs.writeFile(
        path.join(sessionsDir, "prod-b.jsonl"),
        createMockSessionJsonl({ sessionId: "prod-b" }),
      );
      await new Promise((r) => setTimeout(r, 10));
      await fs.writeFile(
        path.join(sessionsDir, "test-c.jsonl"),
        createMockSessionJsonl({ sessionId: "test-c" }),
      );

      const diffs = await compareLatest(10, "test", "main", basePath);

      expect(diffs.length).toBe(1);
      expect(diffs[0].sessionA.sessionId).toBe("test-c");
      expect(diffs[0].sessionB.sessionId).toBe("test-a");
    });
  });

  describe("highlightDivergence", () => {
    it("should generate formatted markdown report", async () => {
      await fs.writeFile(
        path.join(sessionsDir, "session-a.jsonl"),
        createMockSessionJsonl({
          sessionId: "session-a",
          toolCalls: [{ name: "exec", turnIndex: 1, success: true, durationMs: 100 }],
        }),
      );
      await fs.writeFile(
        path.join(sessionsDir, "session-b.jsonl"),
        createMockSessionJsonl({
          sessionId: "session-b",
          toolCalls: [
            { name: "exec", turnIndex: 1, success: false, durationMs: 100, error: "Error" },
          ],
        }),
      );

      const diff = await compareSessions("session-a", "session-b", "main", basePath);
      const report = highlightDivergence(diff);

      expect(report).toContain("# Session Comparison Report");
      expect(report).toContain("session-a");
      expect(report).toContain("session-b");
      expect(report).toContain("Behavior Shift Summary");
      expect(report).toContain("Divergence Points");
    });
  });

  describe("extractPattern", () => {
    it("should identify error rate regression pattern", async () => {
      await fs.writeFile(
        path.join(sessionsDir, "good.jsonl"),
        createMockSessionJsonl({
          sessionId: "good",
          toolCalls: [{ name: "exec", turnIndex: 1, success: true, durationMs: 100 }],
        }),
      );
      await fs.writeFile(
        path.join(sessionsDir, "bad.jsonl"),
        createMockSessionJsonl({
          sessionId: "bad",
          toolCalls: [
            { name: "exec", turnIndex: 1, success: false, durationMs: 100, error: "Error" },
          ],
        }),
      );

      const diff = await compareSessions("good", "bad", "main", basePath);
      const pattern = extractPattern(diff);

      expect(pattern).toContain("Error Rate Regression");
    });

    it("should identify improvement pattern", async () => {
      await fs.writeFile(
        path.join(sessionsDir, "old.jsonl"),
        createMockSessionJsonl({
          sessionId: "old",
          toolCalls: [
            { name: "exec", turnIndex: 1, success: false, durationMs: 1000, error: "Error" },
          ],
        }),
      );
      await fs.writeFile(
        path.join(sessionsDir, "new.jsonl"),
        createMockSessionJsonl({
          sessionId: "new",
          toolCalls: [{ name: "exec", turnIndex: 1, success: true, durationMs: 100 }],
        }),
      );

      const diff = await compareSessions("old", "new", "main", basePath);
      const pattern = extractPattern(diff);

      expect(pattern).toContain("Overall Improvement");
    });
  });

  describe("createSessionDiffTool", () => {
    it("should create a valid tool", () => {
      const tool = createSessionDiffTool();

      expect(tool.name).toBe("session_diff");
      expect(tool.label).toBe("Session Diff");
      expect(typeof tool.execute).toBe("function");
    });

    it("should list sessions via tool action", async () => {
      await fs.writeFile(
        path.join(sessionsDir, "test.jsonl"),
        createMockSessionJsonl({ sessionId: "test" }),
      );

      const tool = createSessionDiffTool({ basePath });
      const result = await tool.execute("test-call", { action: "list_sessions" });

      expect(result.details).toHaveProperty("sessions");
      expect((result.details as { sessions: unknown[] }).sessions.length).toBe(1);
    });

    it("should compare sessions via tool action", async () => {
      await fs.writeFile(
        path.join(sessionsDir, "a.jsonl"),
        createMockSessionJsonl({ sessionId: "a" }),
      );
      await fs.writeFile(
        path.join(sessionsDir, "b.jsonl"),
        createMockSessionJsonl({ sessionId: "b" }),
      );

      const tool = createSessionDiffTool({ basePath });
      const result = await tool.execute("test-call", {
        action: "compare",
        sessionA: "a",
        sessionB: "b",
      });

      expect(result.details).toHaveProperty("sessionA");
      expect(result.details).toHaveProperty("sessionB");
      expect(result.details).toHaveProperty("divergencePoints");
      expect(result.details).toHaveProperty("behaviorShift");
    });

    it("should handle missing session gracefully", async () => {
      const tool = createSessionDiffTool({ basePath });
      const result = await tool.execute("test-call", {
        action: "compare",
        sessionA: "nonexistent",
        sessionB: "also-nonexistent",
      });

      expect(result.details).toHaveProperty("success", false);
      expect(result.details).toHaveProperty("error");
    });

    it("should compare latest sessions via tool action", async () => {
      await fs.writeFile(
        path.join(sessionsDir, "old.jsonl"),
        createMockSessionJsonl({ sessionId: "old" }),
      );
      await new Promise((r) => setTimeout(r, 10));
      await fs.writeFile(
        path.join(sessionsDir, "new.jsonl"),
        createMockSessionJsonl({ sessionId: "new" }),
      );

      const tool = createSessionDiffTool({ basePath });
      const result = await tool.execute("test-call", {
        action: "compare_latest",
        count: 5,
      });

      expect(result.details).toHaveProperty("diffs");
      const details = result.details as { diffs: SessionDiff[] };
      expect(details.diffs.length).toBe(1);
      expect(details.diffs[0].sessionA.sessionId).toBe("new");
      expect(details.diffs[0].sessionB.sessionId).toBe("old");
    });

    it("should highlight divergence via tool action", async () => {
      await fs.writeFile(
        path.join(sessionsDir, "good.jsonl"),
        createMockSessionJsonl({
          sessionId: "good",
          toolCalls: [{ name: "exec", turnIndex: 1, success: true, durationMs: 100 }],
        }),
      );
      await fs.writeFile(
        path.join(sessionsDir, "bad.jsonl"),
        createMockSessionJsonl({
          sessionId: "bad",
          toolCalls: [
            { name: "exec", turnIndex: 1, success: false, durationMs: 100, error: "Failed" },
          ],
        }),
      );

      const tool = createSessionDiffTool({ basePath });
      const result = await tool.execute("test-call", {
        action: "highlight",
        sessionA: "good",
        sessionB: "bad",
      });

      expect(result.content).toBeDefined();
      expect(result.content[0]).toHaveProperty("type", "text");
      const text = (result.content[0] as { type: string; text: string }).text;
      expect(text).toContain("# Session Comparison Report");
      expect(text).toContain("good");
      expect(text).toContain("bad");
    });

    it("should extract pattern via tool action", async () => {
      await fs.writeFile(
        path.join(sessionsDir, "before.jsonl"),
        createMockSessionJsonl({
          sessionId: "before",
          toolCalls: [{ name: "exec", turnIndex: 1, success: true, durationMs: 100 }],
        }),
      );
      await fs.writeFile(
        path.join(sessionsDir, "after.jsonl"),
        createMockSessionJsonl({
          sessionId: "after",
          toolCalls: [
            { name: "exec", turnIndex: 1, success: false, durationMs: 100, error: "Err" },
          ],
        }),
      );

      const tool = createSessionDiffTool({ basePath });
      const result = await tool.execute("test-call", {
        action: "extract_pattern",
        sessionA: "before",
        sessionB: "after",
      });

      expect(result.content).toBeDefined();
      expect(result.content[0]).toHaveProperty("type", "text");
      const text = (result.content[0] as { type: string; text: string }).text;
      expect(text).toContain("Error Rate Regression");
    });

    it("should handle unknown action", async () => {
      const tool = createSessionDiffTool({ basePath });
      const result = await tool.execute("test-call", {
        action: "unknown_action",
      });

      expect(result.details).toHaveProperty("success", false);
      expect(result.details).toHaveProperty("error");
      expect((result.details as { error: string }).error).toContain("Unknown action");
    });
  });
});
