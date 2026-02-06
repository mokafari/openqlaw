import { describe, expect, it } from "vitest";
import {
  analyzeTaskComplexity,
  calculateContextBudget,
  selectModelFuzzy,
} from "./fuzzy-selector.js";

describe("FuzzySelector", () => {
  describe("analyzeTaskComplexity", () => {
    it("should return low complexity for simple tasks", () => {
      const complexity = analyzeTaskComplexity("What time is it?");
      expect(complexity).toBeLessThan(0.3);
    });

    it("should return high complexity for complex tasks", () => {
      const complexity = analyzeTaskComplexity(
        "Refactor the entire architecture to use microservices and implement a new authentication system",
      );
      expect(complexity).toBeGreaterThan(0.5);
    });

    it("should handle empty prompts", () => {
      const complexity = analyzeTaskComplexity("");
      expect(complexity).toBeGreaterThanOrEqual(0.0);
      expect(complexity).toBeLessThanOrEqual(1.0);
    });
  });

  describe("calculateContextBudget", () => {
    it("should return high budget when most tokens available", () => {
      const budget = calculateContextBudget(100000, 10000);
      expect(budget).toBeGreaterThan(0.8);
    });

    it("should return low budget when most tokens used", () => {
      const budget = calculateContextBudget(100000, 90000);
      expect(budget).toBeLessThan(0.2);
    });

    it("should handle edge cases", () => {
      expect(calculateContextBudget(0, 0)).toBe(0.5);
      expect(calculateContextBudget(1000, 1000)).toBe(0.0);
      expect(calculateContextBudget(1000, 0)).toBe(1.0);
    });
  });

  describe("selectModelFuzzy", () => {
    it("should select high-end model for complex tasks", () => {
      const selection = selectModelFuzzy({
        taskComplexity: 0.9,
        contextBudget: 0.8,
      });
      expect(selection.model).toContain("opus");
      expect(selection.tier).toBe("BFG10K");
      expect(selection.scores).toBeDefined();
      expect(selection.scores?.complexity).toBe(0.9);
      expect(selection.scores?.budget).toBe(0.8);
    });

    it("should select low-end model for simple tasks", () => {
      const selection = selectModelFuzzy({
        taskComplexity: 0.1,
        contextBudget: 0.5,
      });
      expect(selection.model).toContain("haiku");
      expect(selection.tier).toBe("Machine Gun");
      expect(selection.scores).toBeDefined();
    });

    it("should handle default provider", () => {
      const selection = selectModelFuzzy({
        taskComplexity: 0.5,
        contextBudget: 0.5,
        defaultProvider: "anthropic",
      });
      expect(selection.provider).toBe("anthropic");
      expect(selection.tier).toBeDefined();
      expect(selection.scores).toBeDefined();
    });

    it("should include tier in response", () => {
      const selection = selectModelFuzzy({
        taskComplexity: 0.6,
        contextBudget: 0.6,
      });
      expect(selection.tier).toBeDefined();
      expect(["BFG10K", "Sonnet", "Machine Gun"]).toContain(selection.tier);
    });
  });
});
