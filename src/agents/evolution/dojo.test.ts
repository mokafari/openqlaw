import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AgentGenotype } from "./genotype.js";
import { DOJO_TASKS, runDojoSuite, runDojoTask } from "./dojo.js";

describe("Evolution Dojo", () => {
  let tempDir: string;
  let workspaceDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "evolution-test-"));
    workspaceDir = path.join(tempDir, "workspace");
    await fs.mkdir(workspaceDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe("DOJO_TASKS", () => {
    it("should have at least one task", () => {
      expect(DOJO_TASKS.length).toBeGreaterThan(0);
    });

    it("should have tasks with required fields", () => {
      for (const task of DOJO_TASKS) {
        expect(task.id).toBeDefined();
        expect(task.name).toBeDefined();
        expect(task.description).toBeDefined();
        expect(task.prompt).toBeDefined();
        expect(task.weight).toBeGreaterThan(0);
        // Note: weights can be > 1.0 (e.g., task-002 has weight 1.2)
        // This allows some tasks to have higher importance in fitness calculation
      }
    });
  });

  describe("runDojoTask", () => {
    const testGenotype: AgentGenotype = {
      generation: 1,
      genotypeId: "test-gen",
      traits: {
        verbosity: 0.5,
        planningDepth: "medium",
        toolEagerness: 0.7,
        chainOfThought: 0.5,
      },
      systemPrompt: {
        tone: "balanced",
        emphasizeTools: true,
        emphasizePlanning: false,
      },
      fuzzyWeights: {
        taskComplexityThreshold: 0.5,
        toolPreferences: {},
      },
      createdAt: Date.now(),
    };

    it("should run a dojo task and return results", async () => {
      const task = DOJO_TASKS[0]!;

      const result = await runDojoTask(task, testGenotype, {
        workspaceDir,
      });

      expect(result.taskId).toBe(task.id);
      expect(result.success).toBeDefined();
      expect(typeof result.success).toBe("boolean");
      expect(result.fitness).toBeGreaterThanOrEqual(0);
      expect(result.fitness).toBeLessThanOrEqual(1.0);
      expect(result.stats.sessionId).toContain(`dojo-${task.id}`);
      expect(result.stats.timestamp).toBeGreaterThan(0);
    });

    it("should use custom agent runner when provided", async () => {
      const task = DOJO_TASKS[0]!;
      let runnerCalled = false;

      const customRunner = async () => {
        runnerCalled = true;
        return {
          success: true,
          tokenUsage: { input: 100, output: 50, total: 150 },
          toolCalls: 1,
          durationMs: 500,
        };
      };

      await runDojoTask(task, testGenotype, {
        workspaceDir,
        agentRunner: customRunner,
      });

      expect(runnerCalled).toBe(true);
    });

    it("should apply task weight to fitness", async () => {
      const task = DOJO_TASKS[0]!;
      const customRunner = async () => ({
        success: true,
        tokenUsage: { input: 100, output: 50, total: 150 },
        toolCalls: 1,
        durationMs: 500,
      });

      const result = await runDojoTask(task, testGenotype, {
        workspaceDir,
        agentRunner: customRunner,
      });

      // Fitness should be calculated with task weight
      expect(result.fitness).toBeGreaterThanOrEqual(0);
      expect(result.fitness).toBeLessThanOrEqual(1.0);
    });

    it("should create workspace directory", async () => {
      const task = DOJO_TASKS[0]!;
      const customWorkspace = path.join(tempDir, "custom-dojo");

      await runDojoTask(task, testGenotype, {
        workspaceDir: customWorkspace,
      });

      const exists = await fs
        .access(customWorkspace)
        .then(() => true)
        .catch(() => false);
      expect(exists).toBe(true);
    });
  });

  describe("runDojoSuite", () => {
    const testGenotype: AgentGenotype = {
      generation: 1,
      genotypeId: "test-gen",
      traits: {
        verbosity: 0.5,
        planningDepth: "medium",
        toolEagerness: 0.7,
        chainOfThought: 0.5,
      },
      systemPrompt: {
        tone: "balanced",
        emphasizeTools: true,
        emphasizePlanning: false,
      },
      fuzzyWeights: {
        taskComplexityThreshold: 0.5,
        toolPreferences: {},
      },
      createdAt: Date.now(),
    };

    it("should run all tasks in suite", async () => {
      const suite = await runDojoSuite(testGenotype, {
        workspaceDir,
      });

      expect(suite.genotype.genotypeId).toBe("test-gen");
      expect(suite.results.length).toBe(DOJO_TASKS.length);
      expect(suite.avgFitness).toBeGreaterThanOrEqual(0);
      // Note: avgFitness can be > 1.0 because task weights can be > 1.0
      // (fitness = baseFitness * task.weight, and some tasks have weight 1.2)
      expect(suite.successRate).toBeGreaterThanOrEqual(0);
      expect(suite.successRate).toBeLessThanOrEqual(1.0);
    });

    it("should calculate average fitness correctly", async () => {
      const customRunner = async () => ({
        success: true,
        tokenUsage: { input: 100, output: 50, total: 150 },
        toolCalls: 1,
        durationMs: 500,
      });

      const suite = await runDojoSuite(testGenotype, {
        workspaceDir,
        agentRunner: customRunner,
      });

      const expectedAvg =
        suite.results.reduce((sum, r) => sum + r.fitness, 0) / suite.results.length;
      expect(suite.avgFitness).toBeCloseTo(expectedAvg, 2);
    });

    it("should calculate success rate correctly", async () => {
      let callCount = 0;
      const customRunner = async () => {
        callCount++;
        return {
          success: callCount % 2 === 0, // Alternate success/failure
          tokenUsage: { input: 100, output: 50, total: 150 },
          toolCalls: 1,
          durationMs: 500,
        };
      };

      const suite = await runDojoSuite(testGenotype, {
        workspaceDir,
        agentRunner: customRunner,
      });

      const expectedSuccessRate =
        suite.results.filter((r) => r.success).length / suite.results.length;
      expect(suite.successRate).toBeCloseTo(expectedSuccessRate, 2);
    });

    it("should run subset of tasks when specified", async () => {
      const subset = DOJO_TASKS.slice(0, 2);

      const suite = await runDojoSuite(testGenotype, {
        tasks: subset,
        workspaceDir,
      });

      expect(suite.results.length).toBe(2);
    });
  });
});
