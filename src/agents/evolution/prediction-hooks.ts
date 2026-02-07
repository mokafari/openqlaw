/**
 * Prediction Logging Hooks
 *
 * Integrates meta-learning predictions with agent runs.
 * Logs predictions before runs and outcomes after.
 */

import { randomUUID } from "node:crypto";
import { log } from "../pi-embedded-runner/logger.js";
import { MetaLearningSystem, type Prediction, type Outcome } from "./meta-learning.js";

// Store active predictions by session ID
const activePredictions = new Map<string, Prediction>();

const metaLearning = new MetaLearningSystem();

/**
 * Classify task type based on user message and context.
 */
function classifyTaskType(message: string): string {
  const lower = message.toLowerCase();

  if (/\b(fix|bug|error|broken|issue)\b/.test(lower)) {
    return "debugging";
  }
  if (/\b(create|build|implement|add|write)\b/.test(lower)) {
    return "coding";
  }
  if (/\b(explain|what|how|why|describe)\b/.test(lower)) {
    return "explanation";
  }
  if (/\b(search|find|look|research)\b/.test(lower)) {
    return "research";
  }
  if (/\b(refactor|improve|optimize|clean)\b/.test(lower)) {
    return "refactoring";
  }
  if (/\b(test|verify|check|validate)\b/.test(lower)) {
    return "testing";
  }
  if (/\b(review|analyze|examine)\b/.test(lower)) {
    return "analysis";
  }
  if (/\b(remind|schedule|cron|timer)\b/.test(lower)) {
    return "scheduling";
  }
  if (/\b(send|message|email|notify)\b/.test(lower)) {
    return "messaging";
  }

  return "general";
}

/**
 * Estimate task difficulty based on message complexity.
 */
function estimateDifficulty(message: string): number {
  const factors = {
    length: Math.min(message.length / 500, 1) * 0.2,
    codeBlocks: (message.match(/```/g)?.length ?? 0) * 0.1,
    multiStep: /\b(then|after|next|finally|first)\b/i.test(message) ? 0.2 : 0,
    technical: /\b(api|database|server|deploy|config)\b/i.test(message) ? 0.15 : 0,
    fileOps: /\b(file|directory|folder|path)\b/i.test(message) ? 0.1 : 0,
  };

  return Math.min(
    Object.values(factors).reduce((a, b) => a + b, 0.3),
    1.0,
  );
}

/**
 * Estimate success probability based on task type and history.
 */
async function estimateSuccess(taskType: string): Promise<number> {
  try {
    const calibration = await metaLearning.getCalibrationMetrics(taskType);

    if (calibration && calibration.predictionCount >= 5) {
      // Use historical success rate with some regression to mean
      return calibration.actualSuccessRate * 0.7 + 0.65 * 0.3;
    }

    // Default success estimates by task type
    const defaults: Record<string, number> = {
      explanation: 0.9,
      research: 0.85,
      messaging: 0.85,
      scheduling: 0.8,
      analysis: 0.75,
      coding: 0.7,
      refactoring: 0.7,
      testing: 0.7,
      debugging: 0.6,
      general: 0.75,
    };

    return defaults[taskType] ?? 0.75;
  } catch {
    return 0.75;
  }
}

/**
 * Estimate duration based on task type and difficulty.
 */
function estimateDuration(taskType: string, difficulty: number): number {
  const baseDurations: Record<string, number> = {
    explanation: 5000,
    research: 15000,
    messaging: 3000,
    scheduling: 5000,
    analysis: 10000,
    coding: 30000,
    refactoring: 25000,
    testing: 20000,
    debugging: 45000,
    general: 10000,
  };

  const base = baseDurations[taskType] ?? 10000;
  return Math.round(base * (1 + difficulty));
}

/**
 * Log a prediction before an agent run starts.
 * Call this from the agent runner before starting the run.
 */
export async function logRunPrediction(params: {
  sessionId: string;
  message: string;
}): Promise<string> {
  try {
    const taskId = randomUUID();
    const taskType = classifyTaskType(params.message);
    const difficulty = estimateDifficulty(params.message);
    const predictedSuccess = await estimateSuccess(taskType);
    const predictedDurationMs = estimateDuration(taskType, difficulty);

    const prediction: Prediction = {
      taskId,
      taskType,
      predictedSuccess,
      predictedDifficulty: difficulty,
      predictedDurationMs,
      timestamp: Date.now(),
    };

    await metaLearning.logPrediction(prediction);
    activePredictions.set(params.sessionId, prediction);

    log.debug(
      `[prediction] Logged prediction for ${params.sessionId}: ${taskType} (${Math.round(predictedSuccess * 100)}% success)`,
    );

    return taskId;
  } catch (err) {
    log.debug(`[prediction] Failed to log prediction: ${String(err)}`);
    return randomUUID(); // Return a dummy ID to not break flow
  }
}

/**
 * Log an outcome after an agent run completes.
 * Call this from the agent runner after the run finishes.
 */
export async function logRunOutcome(params: {
  sessionId: string;
  success: boolean;
  durationMs: number;
  error?: string;
}): Promise<void> {
  try {
    const prediction = activePredictions.get(params.sessionId);

    if (!prediction) {
      log.debug(`[prediction] No prediction found for session ${params.sessionId}`);
      return;
    }

    const outcome: Outcome = {
      taskId: prediction.taskId,
      actualSuccess: params.success,
      actualDurationMs: params.durationMs,
      timestamp: Date.now(),
    };

    await metaLearning.logOutcome(outcome);
    activePredictions.delete(params.sessionId);

    // Log calibration feedback
    const predicted = Math.round(prediction.predictedSuccess * 100);
    const actual = params.success ? "success" : "failure";
    const durationDiff = params.durationMs - prediction.predictedDurationMs;
    const durationLabel =
      durationDiff > 0
        ? `+${Math.round(durationDiff / 1000)}s`
        : `${Math.round(durationDiff / 1000)}s`;

    log.debug(
      `[prediction] Outcome for ${params.sessionId}: predicted ${predicted}% → ${actual}, duration ${durationLabel}`,
    );
  } catch (err) {
    log.debug(`[prediction] Failed to log outcome: ${String(err)}`);
  }
}

/**
 * Clear any stale predictions (e.g., on session cleanup).
 */
export function clearPrediction(sessionId: string): void {
  activePredictions.delete(sessionId);
}

/**
 * Get count of active predictions (for diagnostics).
 */
export function getActivePredictionCount(): number {
  return activePredictions.size;
}
