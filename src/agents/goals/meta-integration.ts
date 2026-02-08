/**
 * Goal-Meta Integration
 *
 * Connects the goal stack to the meta-learning system.
 * When goals are pushed, we log predictions.
 * When goals are completed/failed, we log outcomes.
 *
 * This creates a closed-loop learning system for:
 * - Calibrating task success estimates
 * - Tracking time estimates vs actual
 * - Learning from goal patterns
 */

import type { Goal, GoalType } from "./types.js";
import { MetaLearningSystem } from "../evolution/meta-learning.js";
import { logNovelty, logBreakthrough, detectBreakthrough } from "../meta/emergence-metrics.js";
import { log } from "../pi-embedded-runner/logger.js";

export type GoalPrediction = {
  predictedSuccess: number; // 0.0 - 1.0
  predictedDurationMs: number;
  predictedDifficulty: number; // 0.0 - 1.0
};

const metaLearning = new MetaLearningSystem();

/**
 * Extract a task type from goal description for pattern grouping.
 * Examples: "fix bug" -> "fix", "implement feature" -> "implement"
 */
export function extractGoalTaskType(description: string): string {
  const normalized = description.toLowerCase().trim();

  // Common prefixes to extract
  const prefixes = [
    "fix",
    "implement",
    "create",
    "add",
    "remove",
    "delete",
    "update",
    "refactor",
    "debug",
    "test",
    "write",
    "design",
    "review",
    "analyze",
    "investigate",
    "resolve",
    "deploy",
    "configure",
    "setup",
    "install",
    "migrate",
    "upgrade",
    "optimize",
    "improve",
    "learn",
    "understand",
    "explore",
  ];

  for (const prefix of prefixes) {
    if (normalized.startsWith(prefix + " ") || normalized.startsWith(prefix + ":")) {
      return prefix;
    }
  }

  // Fall back to goal type mapping
  return "generic";
}

/**
 * Infer a prediction from goal description and type.
 * Uses heuristics until we have enough data for ML-based estimates.
 */
export function inferPrediction(
  description: string,
  type: GoalType,
  historicalCalibration?: { meanSuccess: number; meanDurationMs: number },
): GoalPrediction {
  const taskType = extractGoalTaskType(description);

  // Base estimates by task type
  const baseEstimates: Record<string, { success: number; durationMs: number; difficulty: number }> =
    {
      fix: { success: 0.75, durationMs: 30 * 60 * 1000, difficulty: 0.5 },
      implement: { success: 0.7, durationMs: 60 * 60 * 1000, difficulty: 0.6 },
      create: { success: 0.8, durationMs: 45 * 60 * 1000, difficulty: 0.5 },
      add: { success: 0.85, durationMs: 20 * 60 * 1000, difficulty: 0.4 },
      remove: { success: 0.9, durationMs: 10 * 60 * 1000, difficulty: 0.3 },
      delete: { success: 0.9, durationMs: 10 * 60 * 1000, difficulty: 0.3 },
      update: { success: 0.8, durationMs: 20 * 60 * 1000, difficulty: 0.4 },
      refactor: { success: 0.65, durationMs: 90 * 60 * 1000, difficulty: 0.7 },
      debug: { success: 0.6, durationMs: 60 * 60 * 1000, difficulty: 0.7 },
      test: { success: 0.85, durationMs: 30 * 60 * 1000, difficulty: 0.4 },
      write: { success: 0.8, durationMs: 45 * 60 * 1000, difficulty: 0.5 },
      design: { success: 0.7, durationMs: 60 * 60 * 1000, difficulty: 0.6 },
      review: { success: 0.9, durationMs: 20 * 60 * 1000, difficulty: 0.3 },
      analyze: { success: 0.75, durationMs: 30 * 60 * 1000, difficulty: 0.5 },
      investigate: { success: 0.65, durationMs: 45 * 60 * 1000, difficulty: 0.6 },
      resolve: { success: 0.7, durationMs: 45 * 60 * 1000, difficulty: 0.6 },
      deploy: { success: 0.8, durationMs: 30 * 60 * 1000, difficulty: 0.5 },
      configure: { success: 0.85, durationMs: 20 * 60 * 1000, difficulty: 0.4 },
      setup: { success: 0.8, durationMs: 30 * 60 * 1000, difficulty: 0.5 },
      install: { success: 0.9, durationMs: 15 * 60 * 1000, difficulty: 0.3 },
      migrate: { success: 0.6, durationMs: 120 * 60 * 1000, difficulty: 0.8 },
      upgrade: { success: 0.7, durationMs: 45 * 60 * 1000, difficulty: 0.6 },
      optimize: { success: 0.65, durationMs: 60 * 60 * 1000, difficulty: 0.7 },
      improve: { success: 0.7, durationMs: 45 * 60 * 1000, difficulty: 0.6 },
      learn: { success: 0.8, durationMs: 60 * 60 * 1000, difficulty: 0.5 },
      understand: { success: 0.75, durationMs: 45 * 60 * 1000, difficulty: 0.5 },
      explore: { success: 0.85, durationMs: 30 * 60 * 1000, difficulty: 0.4 },
      generic: { success: 0.75, durationMs: 45 * 60 * 1000, difficulty: 0.5 },
    };

  const base = baseEstimates[taskType] ?? baseEstimates.generic;

  // Adjust for goal type
  let typeMultiplier = 1.0;
  if (type === "obstacle") {
    typeMultiplier = 0.9; // Obstacles are slightly harder
  } else if (type === "subgoal") {
    typeMultiplier = 1.1; // Subgoals are slightly easier (more focused)
  }

  // Apply historical calibration if available
  if (historicalCalibration) {
    // Blend base estimates with historical data (70% historical, 30% base)
    const blendedSuccess = 0.7 * historicalCalibration.meanSuccess + 0.3 * base.success;
    const blendedDuration = 0.7 * historicalCalibration.meanDurationMs + 0.3 * base.durationMs;

    return {
      predictedSuccess: Math.min(1, Math.max(0, blendedSuccess * typeMultiplier)),
      predictedDurationMs: blendedDuration,
      predictedDifficulty: base.difficulty,
    };
  }

  return {
    predictedSuccess: Math.min(1, Math.max(0, base.success * typeMultiplier)),
    predictedDurationMs: base.durationMs,
    predictedDifficulty: base.difficulty,
  };
}

/**
 * Log a prediction when a goal is pushed.
 * Called automatically when goals are pushed via the goal_push tool.
 */
export async function logGoalPrediction(
  goal: Goal,
  explicitPrediction?: Partial<GoalPrediction>,
): Promise<void> {
  const taskType = extractGoalTaskType(goal.description);

  // Get historical calibration for this task type
  let historicalCalibration: { meanSuccess: number; meanDurationMs: number } | undefined;
  try {
    const calibration = await metaLearning.getCalibrationMetrics(taskType);
    if (calibration && calibration.predictionCount >= 3) {
      historicalCalibration = {
        meanSuccess: calibration.actualSuccessRate,
        meanDurationMs: 30 * 60 * 1000, // TODO: track actual duration history
      };
    }
  } catch {
    // Calibration lookup failed, use defaults
  }

  const inferredPrediction = inferPrediction(goal.description, goal.type, historicalCalibration);

  // Merge explicit predictions with inferred ones
  const finalPrediction: GoalPrediction = {
    predictedSuccess: explicitPrediction?.predictedSuccess ?? inferredPrediction.predictedSuccess,
    predictedDurationMs:
      explicitPrediction?.predictedDurationMs ?? inferredPrediction.predictedDurationMs,
    predictedDifficulty:
      explicitPrediction?.predictedDifficulty ?? inferredPrediction.predictedDifficulty,
  };

  await metaLearning.logPrediction({
    taskId: goal.id,
    taskType,
    predictedSuccess: finalPrediction.predictedSuccess,
    predictedDifficulty: finalPrediction.predictedDifficulty,
    predictedDurationMs: finalPrediction.predictedDurationMs,
    timestamp: goal.createdAt,
  });

  log.debug(
    `[goal-meta] Logged prediction for goal ${goal.id}: success=${finalPrediction.predictedSuccess.toFixed(2)}, type=${taskType}`,
  );
}

/**
 * Log an outcome when a goal is completed or failed.
 * Called automatically when goals are popped/completed via goal tools.
 */
export async function logGoalOutcome(goal: Goal): Promise<void> {
  if (!goal.resolvedAt) {
    log.warn(`[goal-meta] Goal ${goal.id} resolved but has no resolvedAt timestamp`);
    return;
  }

  const actualDurationMs = goal.resolvedAt - goal.createdAt;
  const actualSuccess = goal.status === "completed";

  await metaLearning.logOutcome({
    taskId: goal.id,
    actualSuccess,
    actualDurationMs,
    timestamp: goal.resolvedAt,
  });

  log.debug(
    `[goal-meta] Logged outcome for goal ${goal.id}: success=${actualSuccess}, duration=${Math.round(actualDurationMs / 1000 / 60)}min`,
  );

  // Track emergence metrics for successful goals
  if (actualSuccess) {
    const taskType = extractGoalTaskType(goal.description);

    // Check for capability breakthrough
    try {
      const calibration = await metaLearning.getCalibrationMetrics(taskType);
      if (calibration && calibration.predictionCount >= 5) {
        const successRate = calibration.actualSuccessRate;
        const breakthrough = await detectBreakthrough(
          `goal_${taskType}`,
          successRate,
          0.1, // 10% improvement threshold
        );

        if (breakthrough.isBreakthrough) {
          await logBreakthrough(
            `goal_${taskType}`,
            breakthrough.previousLevel,
            successRate,
            `Improved from ${(breakthrough.previousLevel * 100).toFixed(0)}% to ${(successRate * 100).toFixed(0)}% success on ${taskType} tasks`,
            successRate - breakthrough.previousLevel >= 0.2 ? "major" : "moderate",
          );
          log.debug(
            `[goal-meta] Breakthrough detected: ${taskType} success rate improved to ${(successRate * 100).toFixed(0)}%`,
          );
        }
      }

      // Log novelty for complex or cross-domain goals
      if (goal.type === "subgoal" && goal.description.includes(" and ")) {
        await logNovelty(
          "cross_domain",
          `Multi-domain goal completed: ${goal.description.slice(0, 100)}`,
          0.7,
          taskType,
        );
      }
    } catch (err) {
      log.debug(`[goal-meta] Failed to check emergence metrics: ${err}`);
    }
  }
}

/**
 * Get calibration summary across all goal types.
 * Useful for self-assessment and capability updates.
 */
export async function getGoalCalibrationSummary(): Promise<{
  totalGoals: number;
  overallCalibrationError: number;
  byTaskType: Record<
    string,
    {
      count: number;
      successRate: number;
      calibrationError: number;
      trend: "improving" | "stable" | "declining";
    }
  >;
  recommendations: string[];
}> {
  const taskTypes = [
    "fix",
    "implement",
    "create",
    "refactor",
    "debug",
    "test",
    "analyze",
    "generic",
  ];

  const byTaskType: Record<
    string,
    {
      count: number;
      successRate: number;
      calibrationError: number;
      trend: "improving" | "stable" | "declining";
    }
  > = {};

  let totalGoals = 0;
  let weightedError = 0;

  for (const taskType of taskTypes) {
    try {
      const calibration = await metaLearning.getCalibrationMetrics(taskType);
      if (calibration && calibration.predictionCount > 0) {
        byTaskType[taskType] = {
          count: calibration.predictionCount,
          successRate: calibration.actualSuccessRate,
          calibrationError: calibration.calibrationError,
          trend: "stable", // TODO: calculate from historical data
        };
        totalGoals += calibration.predictionCount;
        weightedError += calibration.calibrationError * calibration.predictionCount;
      }
    } catch {
      // Skip failed lookups
    }
  }

  const overallCalibrationError = totalGoals > 0 ? weightedError / totalGoals : 0;

  // Generate recommendations based on calibration data
  const recommendations: string[] = [];

  for (const [taskType, data] of Object.entries(byTaskType)) {
    if (data.calibrationError > 0.2) {
      if (data.successRate < 0.5) {
        recommendations.push(
          `Consider avoiding or decomposing "${taskType}" tasks (${Math.round(data.successRate * 100)}% success rate)`,
        );
      } else if (data.calibrationError > 0.3) {
        recommendations.push(
          `Recalibrate "${taskType}" estimates (${Math.round(data.calibrationError * 100)}% error)`,
        );
      }
    }
  }

  if (overallCalibrationError > 0.15) {
    recommendations.push(
      `Overall calibration needs work (${Math.round(overallCalibrationError * 100)}% average error)`,
    );
  }

  return {
    totalGoals,
    overallCalibrationError,
    byTaskType,
    recommendations,
  };
}
