import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { SessionStats } from "./telemetry.js";
import { calculateFitness, getAggregatedStats, logSessionStats } from "./telemetry.js";

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
});
