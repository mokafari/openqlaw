/**
 * Tests for Goal-Meta Integration
 */

import { describe, it, expect } from "vitest";
import { extractGoalTaskType, inferPrediction, type GoalPrediction } from "./meta-integration.js";

describe("extractGoalTaskType", () => {
  it("extracts 'fix' from fix-related descriptions", () => {
    expect(extractGoalTaskType("fix the bug in parser")).toBe("fix");
    expect(extractGoalTaskType("Fix: memory leak")).toBe("fix");
  });

  it("extracts 'implement' from implementation tasks", () => {
    expect(extractGoalTaskType("implement new feature")).toBe("implement");
    expect(extractGoalTaskType("Implement OAuth login")).toBe("implement");
  });

  it("extracts 'refactor' from refactoring tasks", () => {
    expect(extractGoalTaskType("refactor the database layer")).toBe("refactor");
  });

  it("extracts 'debug' from debugging tasks", () => {
    expect(extractGoalTaskType("debug the performance issue")).toBe("debug");
  });

  it("extracts 'learn' from learning goals", () => {
    expect(extractGoalTaskType("learn linear algebra")).toBe("learn");
    expect(extractGoalTaskType("understand quantum mechanics")).toBe("understand");
  });

  it("returns 'generic' for unrecognized patterns", () => {
    expect(extractGoalTaskType("some random task")).toBe("generic");
    expect(extractGoalTaskType("")).toBe("generic");
  });
});

describe("inferPrediction", () => {
  it("returns predictions with reasonable defaults", () => {
    const pred = inferPrediction("fix a bug", "task");
    expect(pred.predictedSuccess).toBeGreaterThan(0);
    expect(pred.predictedSuccess).toBeLessThanOrEqual(1);
    expect(pred.predictedDurationMs).toBeGreaterThan(0);
    expect(pred.predictedDifficulty).toBeGreaterThan(0);
    expect(pred.predictedDifficulty).toBeLessThanOrEqual(1);
  });

  it("returns higher success for simple tasks", () => {
    const simple = inferPrediction("remove unused code", "task");
    const complex = inferPrediction("refactor the entire system", "task");
    expect(simple.predictedSuccess).toBeGreaterThan(complex.predictedSuccess);
  });

  it("adjusts for goal type", () => {
    const task = inferPrediction("implement feature", "task");
    const obstacle = inferPrediction("implement feature", "obstacle");
    const subgoal = inferPrediction("implement feature", "subgoal");

    // Obstacles should be slightly harder
    expect(obstacle.predictedSuccess).toBeLessThan(task.predictedSuccess);
    // Subgoals should be slightly easier
    expect(subgoal.predictedSuccess).toBeGreaterThan(task.predictedSuccess);
  });

  it("blends with historical calibration when provided", () => {
    const withoutHistory = inferPrediction("fix bug", "task");
    const withHistory = inferPrediction("fix bug", "task", {
      meanSuccess: 0.5,
      meanDurationMs: 120 * 60 * 1000,
    });

    // Historical data should influence the prediction
    expect(withHistory.predictedSuccess).toBeLessThan(withoutHistory.predictedSuccess);
  });

  it("handles learning/exploration goals", () => {
    const learn = inferPrediction("learn linear algebra", "task");
    expect(learn.predictedSuccess).toBeGreaterThan(0.7); // Learning should have high success rate
    expect(learn.predictedDifficulty).toBe(0.5); // Medium difficulty
  });
});

describe("prediction bounds", () => {
  it("keeps success probability in [0, 1]", () => {
    const pred = inferPrediction("test", "subgoal", {
      meanSuccess: 1.5, // Unrealistic historical data
      meanDurationMs: 1000,
    });
    expect(pred.predictedSuccess).toBeLessThanOrEqual(1);
    expect(pred.predictedSuccess).toBeGreaterThanOrEqual(0);
  });
});
