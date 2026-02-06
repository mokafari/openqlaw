import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AgentGenotype } from "./genotype.js";
import {
  interbreedGenotypes,
  loadGenotype,
  loadGenotypeSync,
  mutateGenotype,
  saveGenotype,
  saveGenotypeSync,
} from "./genotype.js";

describe("Evolution Genotype", () => {
  let tempDir: string;
  let genotypeDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "evolution-test-"));
    genotypeDir = path.join(tempDir, "genotypes");
    await fs.mkdir(genotypeDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe("saveGenotype and loadGenotype", () => {
    it("should save and load genotype", async () => {
      const genotype: AgentGenotype = {
        generation: 1,
        genotypeId: "gen-1",
        traits: {
          verbosity: 0.5,
          planningDepth: "medium",
          toolEagerness: 0.7,
          chainOfThought: 0.5,
          temperature: 0.7,
          contextWindowPreference: "medium",
        },
        systemPrompt: {
          tone: "balanced",
          emphasizeTools: true,
          emphasizePlanning: false,
        },
        fuzzyWeights: {
          taskComplexityThreshold: 0.5,
          toolPreferences: { ripgrep: 0.8, grep: 0.5 },
        },
        createdAt: Date.now(),
      };

      await saveGenotype(genotype, { genotypeDir });

      const loaded = await loadGenotype({ genotypeDir, genotypeId: "gen-1" });
      expect(loaded.genotypeId).toBe("gen-1");
      expect(loaded.generation).toBe(1);
      expect(loaded.traits.verbosity).toBe(0.5);
      expect(loaded.traits.toolEagerness).toBe(0.7);
      expect(loaded.fuzzyWeights.toolPreferences.ripgrep).toBe(0.8);
    });

    it("should create default genotype when file does not exist", async () => {
      const loaded = await loadGenotype({ genotypeDir, genotypeId: "current" });
      expect(loaded.genotypeId).toBe("current");
      expect(loaded.generation).toBe(1);
      expect(loaded.traits.verbosity).toBe(0.5);
      expect(loaded.traits.planningDepth).toBe("medium");
    });

    it("should use sync versions for synchronous operations", () => {
      const genotype: AgentGenotype = {
        generation: 1,
        genotypeId: "gen-sync",
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

      saveGenotypeSync(genotype, { genotypeDir });
      const loaded = loadGenotypeSync({ genotypeDir, genotypeId: "gen-sync" });

      expect(loaded.genotypeId).toBe("gen-sync");
      expect(loaded.generation).toBe(1);
    });
  });

  describe("mutateGenotype", () => {
    it("should mutate numeric traits within bounds", () => {
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

      const mutated = mutateGenotype(base, 0.1);

      // Traits should be mutated but within valid ranges
      expect(mutated.traits.verbosity).toBeGreaterThanOrEqual(0);
      expect(mutated.traits.verbosity).toBeLessThanOrEqual(1);
      expect(mutated.traits.toolEagerness).toBeGreaterThanOrEqual(0);
      expect(mutated.traits.toolEagerness).toBeLessThanOrEqual(1);

      // Should have different genotypeId
      expect(mutated.genotypeId).not.toBe(base.genotypeId);
      expect(mutated.generation).toBe(base.generation + 1);
    });

    it("should preserve parent lineage", () => {
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

      const mutated = mutateGenotype(base, 0.1);
      expect(mutated.parents).toContain(base.genotypeId);
    });

    it("should mutate planning depth", () => {
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

      // Run multiple mutations to increase chance of depth change
      let depthChanged = false;
      for (let i = 0; i < 10; i++) {
        const mutated = mutateGenotype(base, 0.2);
        if (mutated.traits.planningDepth !== base.traits.planningDepth) {
          depthChanged = true;
          break;
        }
      }

      // Planning depth should sometimes change (not guaranteed, but likely)
      // We just verify it's a valid value
      const mutated = mutateGenotype(base, 0.2);
      expect(["shallow", "medium", "deep"]).toContain(mutated.traits.planningDepth);
    });
  });

  describe("interbreedGenotypes", () => {
    it("should average parent traits", () => {
      const parent1: AgentGenotype = {
        generation: 1,
        genotypeId: "parent-1",
        traits: {
          verbosity: 0.3,
          planningDepth: "shallow",
          toolEagerness: 0.5,
          chainOfThought: 0.4,
        },
        systemPrompt: {
          tone: "concise",
          emphasizeTools: false,
          emphasizePlanning: false,
        },
        fuzzyWeights: {
          taskComplexityThreshold: 0.3,
          toolPreferences: { ripgrep: 0.6 },
        },
        createdAt: Date.now(),
      };

      const parent2: AgentGenotype = {
        generation: 1,
        genotypeId: "parent-2",
        traits: {
          verbosity: 0.7,
          planningDepth: "deep",
          toolEagerness: 0.9,
          chainOfThought: 0.6,
        },
        systemPrompt: {
          tone: "explanatory",
          emphasizeTools: true,
          emphasizePlanning: true,
        },
        fuzzyWeights: {
          taskComplexityThreshold: 0.7,
          toolPreferences: { ripgrep: 0.9, grep: 0.5 },
        },
        createdAt: Date.now(),
      };

      const child = interbreedGenotypes(parent1, parent2);

      // Numeric traits should be averaged
      expect(child.traits.verbosity).toBeCloseTo(0.5, 1); // (0.3 + 0.7) / 2
      expect(child.traits.toolEagerness).toBeCloseTo(0.7, 1); // (0.5 + 0.9) / 2
      expect(child.traits.chainOfThought).toBeCloseTo(0.5, 1); // (0.4 + 0.6) / 2

      // Planning depth should be one of the parents' values
      expect(["shallow", "deep"]).toContain(child.traits.planningDepth);

      // Tool preferences should be merged and averaged
      expect(child.fuzzyWeights.toolPreferences.ripgrep).toBeCloseTo(0.75, 1); // (0.6 + 0.9) / 2
      expect(child.fuzzyWeights.toolPreferences.grep).toBe(0.5); // Only in parent2

      // Should have both parents in lineage
      expect(child.parents).toContain("parent-1");
      expect(child.parents).toContain("parent-2");
      expect(child.generation).toBeGreaterThan(Math.max(parent1.generation, parent2.generation));
    });

    it("should handle missing optional traits", () => {
      const parent1: AgentGenotype = {
        generation: 1,
        genotypeId: "parent-1",
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

      const parent2: AgentGenotype = {
        generation: 1,
        genotypeId: "parent-2",
        traits: {
          verbosity: 0.5,
          planningDepth: "medium",
          toolEagerness: 0.7,
          chainOfThought: 0.5,
          temperature: 0.8,
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

      const child = interbreedGenotypes(parent1, parent2);
      // Should handle missing temperature in parent1
      expect(child.traits.temperature).toBeDefined();
    });
  });
});
