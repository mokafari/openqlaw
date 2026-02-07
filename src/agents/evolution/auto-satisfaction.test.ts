/**
 * Auto-Satisfaction Tests
 *
 * Verify that satisfaction scores are derived correctly from observable signals.
 */

import { describe, it, expect } from "vitest";
import type { Goal } from "../goals/types.js";
import type { ActionPattern } from "../tensor/types.js";
import { deriveSatisfactionScore, type SatisfactionSignals } from "./auto-satisfaction.js";

describe("deriveSatisfactionScore", () => {
  it("should return neutral score with no signals", () => {
    const signals: SatisfactionSignals = {
      execution: {
        success: true,
        aborted: false,
        errorCount: 0,
        durationMs: 5000,
        tokenUsage: { input: 1000, output: 500, total: 1500 },
        toolCalls: 5,
      },
    };

    const score = deriveSatisfactionScore(signals);
    expect(score).toBeGreaterThan(0.5); // Success should boost above neutral
    expect(score).toBeLessThan(1.0);
  });

  it("should score high for successful goal completion", () => {
    const initialGoals: Goal[] = [
      {
        id: "1",
        type: "task",
        description: "Test task",
        status: "active",
        createdAt: Date.now(),
      },
    ];

    const finalGoals: Goal[] = [
      {
        ...initialGoals[0],
        status: "completed",
        resolvedAt: Date.now(),
      },
    ];

    const signals: SatisfactionSignals = {
      goals: { initial: initialGoals, final: finalGoals },
      execution: {
        success: true,
        aborted: false,
        errorCount: 0,
        durationMs: 3000,
        tokenUsage: { input: 1000, output: 500, total: 1500 },
        toolCalls: 5,
      },
    };

    const score = deriveSatisfactionScore(signals);
    expect(score).toBeGreaterThan(0.7); // Good completion
  });

  it("should score low for failed goals", () => {
    const initialGoals: Goal[] = [
      {
        id: "1",
        type: "task",
        description: "Test task",
        status: "active",
        createdAt: Date.now(),
      },
    ];

    const finalGoals: Goal[] = [
      {
        ...initialGoals[0],
        status: "failed",
        resolvedAt: Date.now(),
      },
    ];

    const signals: SatisfactionSignals = {
      goals: { initial: initialGoals, final: finalGoals },
      execution: {
        success: false,
        aborted: false,
        errorCount: 1,
        durationMs: 5000,
        tokenUsage: { input: 1000, output: 500, total: 1500 },
        toolCalls: 5,
      },
    };

    const score = deriveSatisfactionScore(signals);
    expect(score).toBeLessThan(0.4); // Failed goals = low satisfaction
  });

  it("should boost score for high-fitness similar patterns", () => {
    const highFitnessPatterns: ActionPattern[] = [
      {
        id: "p1",
        contextEmbedding: [],
        contextText: "similar context",
        actionSummary: "test action",
        actionToolCalls: [],
        outcome: { success: true, durationMs: 1000 },
        fitness: 0.9,
        usageCount: 10, // High reuse
        lastUsedAt: Date.now(),
        createdAt: Date.now() - 86400000,
      },
    ];

    const signals: SatisfactionSignals = {
      similarPatterns: highFitnessPatterns,
      execution: {
        success: true,
        aborted: false,
        errorCount: 0,
        durationMs: 2000,
        tokenUsage: { input: 1000, output: 500, total: 1500 },
        toolCalls: 5,
      },
    };

    const score = deriveSatisfactionScore(signals);
    expect(score).toBeGreaterThan(0.7); // High pattern fitness boosts score
  });

  it("should penalize errors and aborted runs", () => {
    const signals: SatisfactionSignals = {
      execution: {
        success: false,
        aborted: true,
        errorCount: 5,
        durationMs: 10000,
        tokenUsage: { input: 50000, output: 5000, total: 55000 },
        toolCalls: 50,
      },
    };

    const score = deriveSatisfactionScore(signals);
    expect(score).toBeLessThan(0.4); // Multiple issues = low score
  });

  it("should reward fast, efficient execution", () => {
    const signals: SatisfactionSignals = {
      execution: {
        success: true,
        aborted: false,
        errorCount: 0,
        durationMs: 2000, // Fast
        tokenUsage: { input: 500, output: 200, total: 700 }, // Efficient
        toolCalls: 3, // Few tools
      },
    };

    const score = deriveSatisfactionScore(signals);
    expect(score).toBeGreaterThan(0.8); // Fast + efficient = high score
  });

  it("should handle partial goal completion", () => {
    const initialGoals: Goal[] = [
      {
        id: "1",
        type: "task",
        description: "Task 1",
        status: "active",
        createdAt: Date.now(),
      },
      {
        id: "2",
        type: "task",
        description: "Task 2",
        status: "active",
        createdAt: Date.now(),
      },
    ];

    const finalGoals: Goal[] = [
      {
        ...initialGoals[0],
        status: "completed",
        resolvedAt: Date.now(),
      },
      {
        ...initialGoals[1],
        status: "active", // Still in progress
      },
    ];

    const signals: SatisfactionSignals = {
      goals: { initial: initialGoals, final: finalGoals },
      execution: {
        success: true,
        aborted: false,
        errorCount: 0,
        durationMs: 5000,
        tokenUsage: { input: 2000, output: 1000, total: 3000 },
        toolCalls: 8,
      },
    };

    const score = deriveSatisfactionScore(signals);
    expect(score).toBeGreaterThan(0.6); // Partial completion
    expect(score).toBeLessThan(0.8);
  });

  it("should clamp scores to 0-1 range", () => {
    // Test extreme low scenario
    const lowSignals: SatisfactionSignals = {
      execution: {
        success: false,
        aborted: true,
        errorCount: 100,
        durationMs: 60000,
        tokenUsage: { input: 200000, output: 50000, total: 250000 },
        toolCalls: 200,
        toolErrors: {
          exec: { count: 50, errors: ["error"], lastError: "error", lastErrorTimestamp: 0 },
        },
      },
    };

    const lowScore = deriveSatisfactionScore(lowSignals);
    expect(lowScore).toBeGreaterThanOrEqual(0.0);
    expect(lowScore).toBeLessThanOrEqual(1.0);

    // Test extreme high scenario
    const highSignals: SatisfactionSignals = {
      similarPatterns: [
        {
          id: "p1",
          contextEmbedding: [],
          contextText: "context",
          actionSummary: "action",
          actionToolCalls: [],
          outcome: { success: true, durationMs: 500 },
          fitness: 1.0,
          usageCount: 100,
          lastUsedAt: Date.now(),
          createdAt: Date.now(),
        },
      ],
      execution: {
        success: true,
        aborted: false,
        errorCount: 0,
        durationMs: 500,
        tokenUsage: { input: 100, output: 50, total: 150 },
        toolCalls: 1,
      },
    };

    const highScore = deriveSatisfactionScore(highSignals);
    expect(highScore).toBeGreaterThanOrEqual(0.0);
    expect(highScore).toBeLessThanOrEqual(1.0);
  });
});
