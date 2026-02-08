/**
 * Tests for Reflexion System
 *
 * Validates the core functionality of the Reflexion pattern implementation
 * for self-reflection and iterative improvement from failures.
 */

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  ReflexionSystem,
  ReflexionEpisode,
  TrajectoryStep,
  EpisodeOutcome,
  ReflexionEntry,
} from "./reflexion.js";

describe("ReflexionSystem", () => {
  let tempDir: string;
  let reflexion: ReflexionSystem;

  beforeEach(async () => {
    // Create temp directory for test data
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "reflexion-test-"));
    reflexion = new ReflexionSystem(tempDir);
  });

  afterEach(async () => {
    // Cleanup temp directory
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  // Helper to create test episodes
  function createEpisode(overrides: Partial<ReflexionEpisode> = {}): ReflexionEpisode {
    return {
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      task: "Test task",
      trajectory: [],
      outcome: "success" as EpisodeOutcome,
      heuristic: 0.9,
      duration: 5000,
      toolsUsed: [],
      ...overrides,
    };
  }

  // Helper to create trajectory steps
  function createStep(overrides: Partial<TrajectoryStep> = {}): TrajectoryStep {
    return {
      action: "Test action",
      timestamp: new Date().toISOString(),
      success: true,
      ...overrides,
    };
  }

  describe("calculateHeuristic", () => {
    it("should return 1.0 for optimal trajectory", () => {
      const steps = [
        createStep({ action: "step1", success: true }),
        createStep({ action: "step2", success: true }),
        createStep({ action: "step3", success: true }),
      ];
      const score = reflexion.calculateHeuristic(steps, 10000);
      expect(score).toBeCloseTo(1.0, 1);
    });

    it("should penalize repeated identical actions", () => {
      const steps = [
        createStep({ action: "same", tool: "exec" }),
        createStep({ action: "same", tool: "exec" }),
        createStep({ action: "same", tool: "exec" }),
      ];
      const score = reflexion.calculateHeuristic(steps, 10000);
      // With 2 repeats out of 3 steps, penalty is 0.2 * 2 = 0.4, so repeatedActions = 0.6
      // Average of 4 heuristics: (0.6 + 1.0 + 1.0 + 1.0) / 4 = 0.9
      expect(score).toBeLessThanOrEqual(0.9);
    });

    it("should penalize failed steps", () => {
      const steps = [
        createStep({ action: "step1", success: true }),
        createStep({ action: "step2", success: false }),
        createStep({ action: "step3", success: false }),
      ];
      const score = reflexion.calculateHeuristic(steps, 10000);
      // 1/3 success rate = 0.33 toolEfficiency
      // Average of 4 heuristics includes this, so score should be < 0.85
      expect(score).toBeLessThan(0.85);
    });

    it("should penalize overly long trajectories", () => {
      const steps = Array(30)
        .fill(null)
        .map((_, i) => createStep({ action: `step${i}`, success: true }));
      const score = reflexion.calculateHeuristic(steps, 10000);
      expect(score).toBeLessThan(0.9);
    });

    it("should penalize slow execution", () => {
      const steps = [createStep({ success: true })];
      const score = reflexion.calculateHeuristic(steps, 120000); // 2 minutes
      expect(score).toBeLessThan(0.9);
    });

    it("should return 1.0 for empty trajectory", () => {
      const score = reflexion.calculateHeuristic([], 1000);
      expect(score).toBeCloseTo(1.0, 1);
    });
  });

  describe("shouldReflect", () => {
    it("should return true for failures", () => {
      const episode = createEpisode({ outcome: "failure", heuristic: 0.9 });
      expect(reflexion.shouldReflect(episode)).toBe(true);
    });

    it("should return true for aborted episodes", () => {
      const episode = createEpisode({ outcome: "aborted", heuristic: 0.8 });
      expect(reflexion.shouldReflect(episode)).toBe(true);
    });

    it("should return true for low heuristic scores", () => {
      const episode = createEpisode({ outcome: "success", heuristic: 0.5 });
      expect(reflexion.shouldReflect(episode)).toBe(true);
    });

    it("should return true for partial success with low score", () => {
      const episode = createEpisode({ outcome: "partial", heuristic: 0.6 });
      expect(reflexion.shouldReflect(episode)).toBe(true);
    });

    it("should return false for successful high-quality episodes", () => {
      const episode = createEpisode({ outcome: "success", heuristic: 0.95 });
      expect(reflexion.shouldReflect(episode)).toBe(false);
    });

    it("should return false for partial success with good score", () => {
      const episode = createEpisode({ outcome: "partial", heuristic: 0.85 });
      expect(reflexion.shouldReflect(episode)).toBe(false);
    });
  });

  describe("generateReflectionPrompt", () => {
    it("should generate prompt with task and outcome", () => {
      const episode = createEpisode({
        task: "Fix the bug",
        outcome: "failure",
        heuristic: 0.4,
      });
      const prompt = reflexion.generateReflectionPrompt(episode);
      expect(prompt).toContain("Fix the bug");
      expect(prompt).toContain("failure");
      expect(prompt).toContain("40.0%");
    });

    it("should include trajectory steps", () => {
      const episode = createEpisode({
        trajectory: [
          createStep({ tool: "exec", action: "run command", success: true }),
          createStep({ tool: "Read", action: "read file", success: false }),
        ],
      });
      const prompt = reflexion.generateReflectionPrompt(episode);
      expect(prompt).toContain("[exec]");
      expect(prompt).toContain("[Read]");
      expect(prompt).toContain("✓");
      expect(prompt).toContain("✗");
    });

    it("should include reflection questions", () => {
      const episode = createEpisode({ outcome: "failure" });
      const prompt = reflexion.generateReflectionPrompt(episode);
      expect(prompt).toContain("What went wrong");
      expect(prompt).toContain("root cause");
      expect(prompt).toContain("differently next time");
    });
  });

  describe("logEpisode", () => {
    it("should create episode log file", async () => {
      const episode = createEpisode();
      await reflexion.logEpisode(episode);

      const logPath = path.join(tempDir, "memory", "reflexion-episodes.jsonl");
      const exists = await fs
        .access(logPath)
        .then(() => true)
        .catch(() => false);
      expect(exists).toBe(true);
    });

    it("should append episode to log", async () => {
      const episode1 = createEpisode({ id: "ep1" });
      const episode2 = createEpisode({ id: "ep2" });

      await reflexion.logEpisode(episode1);
      await reflexion.logEpisode(episode2);

      const logPath = path.join(tempDir, "memory", "reflexion-episodes.jsonl");
      const content = await fs.readFile(logPath, "utf-8");
      const lines = content.trim().split("\n");
      expect(lines).toHaveLength(2);
    });

    it("should add failed episodes to working memory", async () => {
      const episode = createEpisode({ outcome: "failure" });
      await reflexion.logEpisode(episode);

      const needsReflection = reflexion.getEpisodesNeedingReflection();
      expect(needsReflection).toHaveLength(1);
      expect(needsReflection[0].id).toBe(episode.id);
    });

    it("should not add successful episodes to working memory", async () => {
      const episode = createEpisode({ outcome: "success", heuristic: 0.95 });
      await reflexion.logEpisode(episode);

      const needsReflection = reflexion.getEpisodesNeedingReflection();
      expect(needsReflection).toHaveLength(0);
    });

    it("should limit working memory size", async () => {
      // Log 5 failed episodes (max is 3)
      for (let i = 0; i < 5; i++) {
        await reflexion.logEpisode(
          createEpisode({
            id: `ep${i}`,
            outcome: "failure",
          }),
        );
      }

      const needsReflection = reflexion.getEpisodesNeedingReflection();
      expect(needsReflection).toHaveLength(3);
      // Should keep the most recent ones
      expect(needsReflection.map((e) => e.id)).toEqual(["ep2", "ep3", "ep4"]);
    });
  });

  describe("logHindsight", () => {
    it("should create hindsight log file", async () => {
      await reflexion.logHindsight({
        originalPrompt: "Do something",
        failedResponse: "Wrong answer",
        feedback: "Should have done X instead",
        category: "wrong-approach",
      });

      const logPath = path.join(tempDir, "memory", "hindsight-log.jsonl");
      const exists = await fs
        .access(logPath)
        .then(() => true)
        .catch(() => false);
      expect(exists).toBe(true);
    });

    it("should store hindsight with auto-generated id and timestamp", async () => {
      await reflexion.logHindsight({
        originalPrompt: "Test prompt",
        failedResponse: "Bad response",
        feedback: "Learn from this",
        category: "tool-misuse",
      });

      const logPath = path.join(tempDir, "memory", "hindsight-log.jsonl");
      const content = await fs.readFile(logPath, "utf-8");
      const entry = JSON.parse(content.trim());

      expect(entry.id).toBeDefined();
      expect(entry.timestamp).toBeDefined();
      expect(entry.category).toBe("tool-misuse");
    });
  });

  describe("addReflection", () => {
    it("should add reflection to episode in working memory", async () => {
      const episode = createEpisode({ outcome: "failure" });
      await reflexion.logEpisode(episode);

      const reflection: ReflexionEntry = {
        whatWentWrong: "Used wrong tool",
        rootCause: "Misread the error message",
        lessonsLearned: ["Read errors carefully", "Check tool docs"],
        avoidInFuture: ["Guessing at solutions"],
        repeatInFuture: ["Systematic debugging"],
      };

      const result = await reflexion.addReflection(episode.id, reflection);
      expect(result).toBe(true);

      const needsReflection = reflexion.getEpisodesNeedingReflection();
      expect(needsReflection).toHaveLength(0); // Now has reflection
    });

    it("should return false for unknown episode", async () => {
      const result = await reflexion.addReflection("unknown-id", {
        lessonsLearned: ["test"],
      });
      expect(result).toBe(false);
    });
  });

  describe("getRecentEpisodes", () => {
    it("should return empty array for no episodes", async () => {
      const episodes = await reflexion.getRecentEpisodes();
      expect(episodes).toEqual([]);
    });

    it("should return logged episodes", async () => {
      await reflexion.logEpisode(createEpisode({ id: "ep1" }));
      await reflexion.logEpisode(createEpisode({ id: "ep2" }));

      const episodes = await reflexion.getRecentEpisodes();
      expect(episodes).toHaveLength(2);
    });

    it("should respect limit parameter", async () => {
      for (let i = 0; i < 10; i++) {
        await reflexion.logEpisode(createEpisode({ id: `ep${i}` }));
      }

      const episodes = await reflexion.getRecentEpisodes(5);
      expect(episodes).toHaveLength(5);
    });
  });

  describe("getHindsightExamples", () => {
    it("should return empty array for no entries", async () => {
      const examples = await reflexion.getHindsightExamples();
      expect(examples).toEqual([]);
    });

    it("should filter by category", async () => {
      await reflexion.logHindsight({
        originalPrompt: "p1",
        failedResponse: "r1",
        feedback: "f1",
        category: "tool-misuse",
      });
      await reflexion.logHindsight({
        originalPrompt: "p2",
        failedResponse: "r2",
        feedback: "f2",
        category: "hallucination",
      });

      const toolMisuse = await reflexion.getHindsightExamples("tool-misuse");
      expect(toolMisuse).toHaveLength(1);
      expect(toolMisuse[0].category).toBe("tool-misuse");
    });
  });

  describe("analyzeFailurePatterns", () => {
    it("should return zeros for empty episodes", async () => {
      const analysis = await reflexion.analyzeFailurePatterns();
      expect(analysis.totalEpisodes).toBe(0);
      expect(analysis.failureRate).toBe(0);
      expect(analysis.averageHeuristic).toBe(0);
    });

    it("should calculate failure rate correctly", async () => {
      await reflexion.logEpisode(createEpisode({ outcome: "success" }));
      await reflexion.logEpisode(createEpisode({ outcome: "success" }));
      await reflexion.logEpisode(createEpisode({ outcome: "failure" }));
      await reflexion.logEpisode(createEpisode({ outcome: "failure" }));

      const analysis = await reflexion.analyzeFailurePatterns();
      expect(analysis.totalEpisodes).toBe(4);
      expect(analysis.failureRate).toBe(0.5);
    });

    it("should calculate average heuristic", async () => {
      await reflexion.logEpisode(createEpisode({ heuristic: 0.8 }));
      await reflexion.logEpisode(createEpisode({ heuristic: 0.6 }));

      const analysis = await reflexion.analyzeFailurePatterns();
      expect(analysis.averageHeuristic).toBe(0.7);
    });

    it("should track tool failure rates", async () => {
      await reflexion.logEpisode(
        createEpisode({
          outcome: "failure",
          toolsUsed: ["exec", "Read"],
        }),
      );
      await reflexion.logEpisode(
        createEpisode({
          outcome: "success",
          toolsUsed: ["exec"],
        }),
      );

      const analysis = await reflexion.analyzeFailurePatterns();
      expect(analysis.toolFailureRates["exec"]).toBe(0.5);
      expect(analysis.toolFailureRates["Read"]).toBe(1.0);
    });

    it("should extract lessons from reflections", async () => {
      const episode = createEpisode({
        outcome: "failure",
        reflection: {
          lessonsLearned: ["Lesson 1", "Lesson 2"],
        },
      });
      await reflexion.logEpisode(episode);

      const analysis = await reflexion.analyzeFailurePatterns();
      expect(analysis.lessonsExtracted).toContain("Lesson 1");
      expect(analysis.lessonsExtracted).toContain("Lesson 2");
    });
  });

  describe("generateImprovementSuggestions", () => {
    it("should return empty array for perfect episodes", async () => {
      await reflexion.logEpisode(
        createEpisode({
          outcome: "success",
          heuristic: 0.95,
          toolsUsed: ["exec"],
        }),
      );

      const suggestions = await reflexion.generateImprovementSuggestions();
      // Should not have failure rate or heuristic warnings
      expect(suggestions.filter((s) => s.includes("failure rate"))).toHaveLength(0);
      expect(suggestions.filter((s) => s.includes("heuristic"))).toHaveLength(0);
    });

    it("should suggest review for high failure rate", async () => {
      // Create 50% failure rate
      await reflexion.logEpisode(createEpisode({ outcome: "success" }));
      await reflexion.logEpisode(createEpisode({ outcome: "failure" }));

      const suggestions = await reflexion.generateImprovementSuggestions();
      expect(suggestions.some((s) => s.includes("failure rate"))).toBe(true);
    });

    it("should flag tools with high failure rates", async () => {
      await reflexion.logEpisode(
        createEpisode({
          outcome: "failure",
          toolsUsed: ["problematic-tool"],
        }),
      );
      await reflexion.logEpisode(
        createEpisode({
          outcome: "failure",
          toolsUsed: ["problematic-tool"],
        }),
      );

      const suggestions = await reflexion.generateImprovementSuggestions();
      expect(suggestions.some((s) => s.includes("problematic-tool"))).toBe(true);
    });
  });
});
