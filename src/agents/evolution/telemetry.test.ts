import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { SessionStats } from "./telemetry.js";
import {
  calculateFitness,
  getAggregatedStats,
  logSessionStats,
  classifyError,
  isExpectedError,
  filterErrorsBySeverity,
  getErrorSummary,
  type ErrorSeverity,
} from "./telemetry.js";

describe("Evolution Telemetry", () => {
  let tempDir: string;
  let statsDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "evolution-test-"));
    statsDir = path.join(tempDir, "stats");
    await fs.mkdir(statsDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe("logSessionStats", () => {
    it("should log session stats to JSONL file", async () => {
      const statsFile = path.join(statsDir, "session_stats.jsonl");

      await logSessionStats({
        sessionId: "session-123",
        sessionKey: "main",
        meta: {
          aborted: false,
          error: undefined,
          durationMs: 5000,
        },
        agentMeta: {
          model: "claude-opus-4-5",
          provider: "anthropic",
          usage: {
            input: 1000,
            output: 500,
            total: 1500,
          },
        },
        toolCallCount: 5,
        userSatisfaction: 0.8,
        generation: 1,
        genotypeId: "gen-1",
        statsDir,
      });

      const content = await fs.readFile(statsFile, "utf-8");
      const lines = content.trim().split("\n");
      expect(lines.length).toBe(1);

      const entry = JSON.parse(lines[0]!);
      expect(entry.sessionId).toBe("session-123");
      expect(entry.sessionKey).toBe("main");
      expect(entry.success).toBe(true);
      expect(entry.tokenUsage.input).toBe(1000);
      expect(entry.tokenUsage.output).toBe(500);
      expect(entry.toolCalls).toBe(5);
      expect(entry.model).toBe("claude-opus-4-5");
      expect(entry.provider).toBe("anthropic");
      expect(entry.userSatisfaction).toBe(0.8);
      expect(entry.generation).toBe(1);
      expect(entry.genotypeId).toBe("gen-1");
      expect(entry.fitness).toBeDefined();
    });

    it("should calculate fitness when userSatisfaction is provided", async () => {
      const statsFile = path.join(statsDir, "session_stats.jsonl");

      await logSessionStats({
        sessionId: "session-123",
        meta: {
          aborted: false,
          error: undefined,
          durationMs: 1000,
        },
        agentMeta: {
          model: "claude-haiku",
          provider: "anthropic",
          usage: {
            input: 500,
            output: 200,
            total: 700,
          },
        },
        toolCallCount: 2,
        userSatisfaction: 0.9,
        statsDir,
      });

      const content = await fs.readFile(statsFile, "utf-8");
      const entry = JSON.parse(content.trim().split("\n")[0]!);
      expect(entry.fitness).toBeGreaterThan(0);
      expect(entry.fitness).toBeLessThanOrEqual(1.0);
    });

    it("should not calculate fitness when userSatisfaction is missing", async () => {
      const statsFile = path.join(statsDir, "session_stats.jsonl");

      await logSessionStats({
        sessionId: "session-123",
        meta: {
          aborted: false,
          error: undefined,
          durationMs: 1000,
        },
        agentMeta: {
          model: "claude-haiku",
          provider: "anthropic",
          usage: {
            input: 500,
            output: 200,
            total: 700,
          },
        },
        toolCallCount: 2,
        statsDir,
      });

      const content = await fs.readFile(statsFile, "utf-8");
      const entry = JSON.parse(content.trim().split("\n")[0]!);
      expect(entry.fitness).toBeUndefined();
    });

    it("should log tool errors", async () => {
      const statsFile = path.join(statsDir, "session_stats.jsonl");

      await logSessionStats({
        sessionId: "session-123",
        meta: {
          aborted: false,
          error: undefined,
          durationMs: 1000,
        },
        agentMeta: {
          model: "claude-haiku",
          provider: "anthropic",
          usage: {
            input: 500,
            output: 200,
            total: 700,
          },
        },
        toolCallCount: 3,
        toolErrors: {
          read: {
            count: 2,
            errors: ["File not found", "Permission denied"],
            lastError: "Permission denied",
            lastErrorTimestamp: Date.now(),
          },
        },
        statsDir,
      });

      const content = await fs.readFile(statsFile, "utf-8");
      const entry = JSON.parse(content.trim().split("\n")[0]!);
      expect(entry.toolErrors).toBeDefined();
      expect(entry.toolErrors.read.count).toBe(2);
      expect(entry.toolErrors.read.errors.length).toBe(2);
    });

    it("should append multiple sessions to same file", async () => {
      const statsFile = path.join(statsDir, "session_stats.jsonl");

      await logSessionStats({
        sessionId: "session-1",
        meta: { aborted: false, durationMs: 1000 },
        agentMeta: {
          model: "claude-haiku",
          provider: "anthropic",
          usage: { input: 100, output: 50, total: 150 },
        },
        toolCallCount: 1,
        statsDir,
      });

      await logSessionStats({
        sessionId: "session-2",
        meta: { aborted: false, durationMs: 2000 },
        agentMeta: {
          model: "claude-sonnet",
          provider: "anthropic",
          usage: { input: 200, output: 100, total: 300 },
        },
        toolCallCount: 2,
        statsDir,
      });

      const content = await fs.readFile(statsFile, "utf-8");
      const lines = content.trim().split("\n");
      expect(lines.length).toBe(2);

      const entry1 = JSON.parse(lines[0]!);
      const entry2 = JSON.parse(lines[1]!);
      expect(entry1.sessionId).toBe("session-1");
      expect(entry2.sessionId).toBe("session-2");
    });
  });

  describe("calculateFitness", () => {
    it("should calculate fitness from success, efficiency, and user satisfaction", () => {
      const stats: SessionStats = {
        sessionId: "test",
        timestamp: Date.now(),
        success: true,
        aborted: false,
        tokenUsage: { input: 1000, output: 500, total: 1500 },
        toolCalls: 5,
        durationMs: 2000,
        model: "claude-opus",
        provider: "anthropic",
        userSatisfaction: 0.9,
      };

      const fitness = calculateFitness(stats);
      expect(fitness).toBeGreaterThan(0);
      expect(fitness).toBeLessThanOrEqual(1.0);
    });

    it("should penalize failed sessions", () => {
      const successStats: SessionStats = {
        sessionId: "test-success",
        timestamp: Date.now(),
        success: true,
        aborted: false,
        tokenUsage: { input: 1000, output: 500, total: 1500 },
        toolCalls: 5,
        durationMs: 2000,
        model: "claude-opus",
        provider: "anthropic",
        userSatisfaction: 0.8,
      };

      const failedStats: SessionStats = {
        sessionId: "test-failed",
        timestamp: Date.now(),
        success: false,
        aborted: false,
        error: "Test error",
        tokenUsage: { input: 1000, output: 500, total: 1500 },
        toolCalls: 5,
        durationMs: 2000,
        model: "claude-opus",
        provider: "anthropic",
        userSatisfaction: 0.8,
      };

      const successFitness = calculateFitness(successStats);
      const failedFitness = calculateFitness(failedStats);

      expect(successFitness).toBeGreaterThan(failedFitness);
    });

    it("should reward efficiency (lower token usage)", () => {
      const efficientStats: SessionStats = {
        sessionId: "test-efficient",
        timestamp: Date.now(),
        success: true,
        aborted: false,
        tokenUsage: { input: 500, output: 200, total: 700 },
        toolCalls: 2,
        durationMs: 1000,
        model: "claude-haiku",
        provider: "anthropic",
        userSatisfaction: 0.8,
      };

      const inefficientStats: SessionStats = {
        sessionId: "test-inefficient",
        timestamp: Date.now(),
        success: true,
        aborted: false,
        tokenUsage: { input: 5000, output: 2000, total: 7000 },
        toolCalls: 20,
        durationMs: 10000,
        model: "claude-opus",
        provider: "anthropic",
        userSatisfaction: 0.8,
      };

      const efficientFitness = calculateFitness(efficientStats);
      const inefficientFitness = calculateFitness(inefficientStats);

      expect(efficientFitness).toBeGreaterThan(inefficientFitness);
    });
  });

  describe("getAggregatedStats", () => {
    it("should aggregate stats from multiple sessions", async () => {
      // Log multiple sessions
      for (let i = 0; i < 5; i++) {
        await logSessionStats({
          sessionId: `session-${i}`,
          meta: {
            aborted: false,
            error: undefined,
            durationMs: 1000 + i * 100,
          },
          agentMeta: {
            model: "claude-haiku",
            provider: "anthropic",
            usage: {
              input: 500 + i * 50,
              output: 200 + i * 20,
              total: 700 + i * 70,
            },
          },
          toolCallCount: 2 + i,
          userSatisfaction: 0.7 + i * 0.05,
          generation: 1,
          genotypeId: "gen-1",
          statsDir,
        });
      }

      const aggregated = await getAggregatedStats({
        genotypeId: "gen-1",
        statsDir,
      });

      expect(aggregated.count).toBe(5);
      expect(aggregated.successRate).toBe(1.0); // All succeeded
      expect(aggregated.avgTokens).toBeGreaterThan(0);
      expect(aggregated.avgToolCalls).toBeGreaterThan(0);
      expect(aggregated.avgFitness).toBeGreaterThan(0);
      expect(aggregated.avgFitness).toBeLessThanOrEqual(1.0);
    });

    it("should filter by generation", async () => {
      await logSessionStats({
        sessionId: "session-gen1",
        meta: { aborted: false, durationMs: 1000 },
        agentMeta: {
          model: "claude-haiku",
          provider: "anthropic",
          usage: { input: 500, output: 200, total: 700 },
        },
        toolCallCount: 2,
        generation: 1,
        genotypeId: "gen-1",
        statsDir,
      });

      await logSessionStats({
        sessionId: "session-gen2",
        meta: { aborted: false, durationMs: 1000 },
        agentMeta: {
          model: "claude-haiku",
          provider: "anthropic",
          usage: { input: 500, output: 200, total: 700 },
        },
        toolCallCount: 2,
        generation: 2,
        genotypeId: "gen-2",
        statsDir,
      });

      const aggregated = await getAggregatedStats({
        generation: 1,
        statsDir,
      });

      expect(aggregated.count).toBe(1);
    });

    it("should return empty stats when no sessions found", async () => {
      const aggregated = await getAggregatedStats({
        genotypeId: "nonexistent",
        statsDir,
      });

      expect(aggregated.count).toBe(0);
      expect(aggregated.successRate).toBe(0);
      expect(aggregated.avgTokens).toBe(0);
      expect(aggregated.avgFitness).toBe(0);
    });
  });

  describe("classifyError", () => {
    it("should classify expected errors correctly", () => {
      const exitCodeError = classifyError("Command exited with code 1");
      expect(exitCodeError.severity).toBe("expected");
      expect(exitCodeError.category).toBe("shell");

      const notDueError = classifyError("not-due");
      expect(notDueError.severity).toBe("expected");
      expect(notDueError.category).toBe("cron");

      const rateLimitError = classifyError("Rate limit exceeded, 429 Too Many Requests");
      expect(rateLimitError.severity).toBe("expected");
      expect(rateLimitError.isTransient).toBe(true);
    });

    it("should classify warning errors correctly", () => {
      const networkError = classifyError("ECONNREFUSED: Connection refused");
      expect(networkError.severity).toBe("warning");
      expect(networkError.category).toBe("network");
      expect(networkError.isTransient).toBe(true);

      const authError = classifyError("Authentication failed: 401 Unauthorized");
      expect(authError.severity).toBe("warning");
      expect(authError.category).toBe("auth");

      const tsError = classifyError("error TS2345: Argument of type 'string'");
      expect(tsError.severity).toBe("warning");
      expect(tsError.category).toBe("typescript");
    });

    it("should classify critical errors correctly", () => {
      const crashError = classifyError("Fatal error: Process crashed");
      expect(crashError.severity).toBe("critical");
      expect(crashError.category).toBe("crash");

      const unhandledError = classifyError("Unhandled promise rejection: TypeError");
      expect(unhandledError.severity).toBe("critical");
      expect(unhandledError.category).toBe("unhandled");

      const stackError = classifyError("Maximum call stack size exceeded");
      expect(stackError.severity).toBe("critical");
      expect(stackError.category).toBe("recursion");
    });

    it("should default unknown errors to warning", () => {
      const unknownError = classifyError("Some random error message");
      expect(unknownError.severity).toBe("warning");
      expect(unknownError.category).toBe("unknown");
    });
  });

  describe("isExpectedError", () => {
    it("should return true for expected errors", () => {
      expect(isExpectedError("Command exited with code 0")).toBe(true);
      expect(isExpectedError("not-due")).toBe(true);
      expect(isExpectedError("ENOENT: .env file not found")).toBe(true);
      expect(isExpectedError("nothing to commit")).toBe(true);
    });

    it("should return false for real errors", () => {
      expect(isExpectedError("Fatal error")).toBe(false);
      expect(isExpectedError("ECONNREFUSED")).toBe(false);
      expect(isExpectedError("Permission denied")).toBe(false);
    });
  });

  describe("filterErrorsBySeverity", () => {
    it("should filter errors by minimum severity", () => {
      const errors = [
        "Command exited with code 1", // expected
        "deprecated API warning", // info
        "ECONNREFUSED", // warning
        "Fatal crash", // critical
      ];

      const warningsAndAbove = filterErrorsBySeverity(errors, "warning");
      expect(warningsAndAbove).toHaveLength(2);
      expect(warningsAndAbove).toContain("ECONNREFUSED");
      expect(warningsAndAbove).toContain("Fatal crash");

      const criticalOnly = filterErrorsBySeverity(errors, "critical");
      expect(criticalOnly).toHaveLength(1);
      expect(criticalOnly).toContain("Fatal crash");
    });
  });

  describe("getErrorSummary", () => {
    it("should provide correct summary statistics", () => {
      const errors = [
        "Command exited with code 1", // expected
        "not-due", // expected
        "deprecated API", // info
        "ECONNREFUSED", // warning
        "Fatal crash", // critical
        "Unhandled rejection", // critical
      ];

      const summary = getErrorSummary(errors);

      expect(summary.total).toBe(6);
      expect(summary.bySeverity.expected).toBe(2);
      expect(summary.bySeverity.info).toBe(1);
      expect(summary.bySeverity.warning).toBe(1);
      expect(summary.bySeverity.critical).toBe(2);
      expect(summary.actionableCount).toBe(3); // warning + critical
    });

    it("should track categories correctly", () => {
      const errors = ["ECONNREFUSED", "ETIMEDOUT", "socket hang up"];

      const summary = getErrorSummary(errors);

      expect(summary.byCategory.network).toBe(3);
    });
  });
});
