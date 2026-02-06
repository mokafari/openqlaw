import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AgentGenotype } from "./genotype.js";
import { Breeder } from "./breeder.js";
import { saveGenotype } from "./genotype.js";
import { logSessionStats } from "./telemetry.js";

describe("Evolution Breeder", () => {
  let tempDir: string;
  let genotypeDir: string;
  let statsDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "evolution-test-"));
    genotypeDir = path.join(tempDir, "genotypes");
    statsDir = path.join(tempDir, "stats");
    await fs.mkdir(genotypeDir, { recursive: true });
    await fs.mkdir(statsDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe("createVariants", () => {
    it("should create variants from base genotype", async () => {
      const base: AgentGenotype = {
        generation: 1,
        genotypeId: "base",
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

      await saveGenotype(base, { genotypeDir });

      const breeder = new Breeder({ genotypeDir, statsDir });
      const variants = await breeder.createVariants("base");

      expect(variants.length).toBe(3);
      expect(variants[0]?.genotypeId).not.toBe("base");
      expect(variants[1]?.genotypeId).not.toBe("base");
      expect(variants[2]?.genotypeId).not.toBe("base");

      // Variants should have different traits
      const toolEagernessValues = variants.map((v) => v.traits.toolEagerness);
      expect(new Set(toolEagernessValues).size).toBeGreaterThan(1); // At least some variation
    });

    it("should create variants with different characteristics", async () => {
      const base: AgentGenotype = {
        generation: 1,
        genotypeId: "base",
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

      await saveGenotype(base, { genotypeDir });

      const breeder = new Breeder({ genotypeDir, statsDir });
      const variants = await breeder.createVariants("base");

      // Variant A should have higher tool eagerness
      expect(variants[0]?.traits.toolEagerness).toBeGreaterThan(base.traits.toolEagerness);

      // Variant B should have different system prompt
      expect(variants[1]?.systemPrompt.tone).not.toBe(base.systemPrompt.tone);

      // Variant C should be a mutation of base
      expect(variants[2]?.generation).toBe(base.generation + 1);
    });
  });

  describe("evaluateGenotypes", () => {
    it("should evaluate genotypes using aggregated stats", async () => {
      const genotype1: AgentGenotype = {
        generation: 1,
        genotypeId: "gen-1",
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

      const genotype2: AgentGenotype = {
        generation: 1,
        genotypeId: "gen-2",
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

      await saveGenotype(genotype1, { genotypeDir });
      await saveGenotype(genotype2, { genotypeDir });

      // Log some stats for genotype 1
      await logSessionStats({
        sessionId: "session-1",
        meta: { aborted: false, durationMs: 1000 },
        agentMeta: {
          model: "claude-haiku",
          provider: "anthropic",
          usage: { input: 500, output: 200, total: 700 },
        },
        toolCallCount: 2,
        userSatisfaction: 0.9,
        generation: 1,
        genotypeId: "gen-1",
        statsDir,
      });

      const breeder = new Breeder({ genotypeDir, statsDir });
      const evaluations = await breeder.evaluateGenotypes(["gen-1", "gen-2"]);

      expect(evaluations.length).toBeGreaterThan(0);
      expect(evaluations[0]?.genotype.genotypeId).toBe("gen-1");
      expect(evaluations[0]?.fitness).toBeGreaterThan(0);
    });

    it("should sort evaluations by fitness descending", async () => {
      const genotype1: AgentGenotype = {
        generation: 1,
        genotypeId: "gen-1",
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

      const genotype2: AgentGenotype = {
        generation: 1,
        genotypeId: "gen-2",
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

      await saveGenotype(genotype1, { genotypeDir });
      await saveGenotype(genotype2, { genotypeDir });

      // Log stats with different fitness scores
      await logSessionStats({
        sessionId: "session-1",
        meta: { aborted: false, durationMs: 1000 },
        agentMeta: {
          model: "claude-haiku",
          provider: "anthropic",
          usage: { input: 500, output: 200, total: 700 },
        },
        toolCallCount: 2,
        userSatisfaction: 0.9, // High satisfaction
        generation: 1,
        genotypeId: "gen-1",
        statsDir,
      });

      await logSessionStats({
        sessionId: "session-2",
        meta: { aborted: false, durationMs: 2000 },
        agentMeta: {
          model: "claude-haiku",
          provider: "anthropic",
          usage: { input: 2000, output: 1000, total: 3000 },
        },
        toolCallCount: 10,
        userSatisfaction: 0.5, // Lower satisfaction
        generation: 1,
        genotypeId: "gen-2",
        statsDir,
      });

      const breeder = new Breeder({ genotypeDir, statsDir });
      const evaluations = await breeder.evaluateGenotypes(["gen-1", "gen-2"]);

      // Should be sorted by fitness descending
      for (let i = 0; i < evaluations.length - 1; i++) {
        expect(evaluations[i]!.fitness).toBeGreaterThanOrEqual(evaluations[i + 1]!.fitness);
      }
    });
  });

  describe("evolve", () => {
    it("should run full evolution cycle", async () => {
      const base: AgentGenotype = {
        generation: 1,
        genotypeId: "base",
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

      await saveGenotype(base, { genotypeDir });

      const breeder = new Breeder({ genotypeDir, statsDir });
      const result = await breeder.evolve({
        baseGenotypeId: "base",
        populationSize: 3,
        mutationRate: 0.1,
      });

      expect(result.generation).toBeGreaterThan(base.generation);
      expect(result.winner.genotypeId).toBe("current");
      expect(result.nextGeneration.length).toBe(3);
      expect(result.nextGeneration[0]?.generation).toBeGreaterThan(base.generation);
    });

    it("should create next generation from winner", async () => {
      const base: AgentGenotype = {
        generation: 1,
        genotypeId: "base",
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

      await saveGenotype(base, { genotypeDir });

      const breeder = new Breeder({ genotypeDir, statsDir });
      const result = await breeder.evolve({
        baseGenotypeId: "base",
        populationSize: 2,
      });

      // Next generation should have winner as parent
      expect(result.nextGeneration.length).toBe(2);
      for (const child of result.nextGeneration) {
        expect(child.generation).toBeGreaterThan(base.generation);
      }
    });
  });
});
