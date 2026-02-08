/**
 * Calibration System - Track prediction accuracy for self-assessment
 * Part of AGI 2026 TIER 2: Perfect Calibration
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";

const DATA_DIR =
  process.env.OPENCLAW_WORKSPACE || path.join(process.env.HOME || "", ".openclaw", "workspace");
const PREDICTIONS_FILE = path.join(DATA_DIR, "data", "calibration-predictions.jsonl");
const OUTCOMES_FILE = path.join(DATA_DIR, "data", "calibration-outcomes.jsonl");

// Types
export interface Prediction {
  taskId: string;
  taskType: string;
  predictedSuccess: number;
  predictedDurationMs: number;
  predictedTokens: number;
  timestamp: number;
}

export interface Outcome {
  taskId: string;
  actualSuccess: boolean;
  actualDurationMs: number;
  actualTokens: number;
  timestamp: number;
}

export interface CalibrationReport {
  totalTasks: number;
  matchedTasks: number;
  successCalibration: number;
  durationBias: number;
  tokenBias: number;
  byTaskType: Record<
    string,
    {
      count: number;
      avgPredictedSuccess: number;
      actualSuccessRate: number;
      calibrationError: number;
    }
  >;
  overconfidentTasks: number;
  underconfidentTasks: number;
}

// Load entries from JSONL file
async function loadEntries<T>(filepath: string): Promise<T[]> {
  try {
    const content = await fs.readFile(filepath, "utf-8");
    return content
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .filter((x): x is T => x !== null);
  } catch {
    return [];
  }
}

// Append entry to JSONL file
async function appendEntry(filepath: string, entry: object): Promise<void> {
  await fs.mkdir(path.dirname(filepath), { recursive: true });
  await fs.appendFile(filepath, JSON.stringify(entry) + "\n");
}

// Log a prediction before task execution
export async function logPrediction(
  taskId: string,
  predictedSuccess: number,
  predictedDurationMs: number = 0,
  predictedTokens: number = 0,
  taskType: string = "general",
): Promise<void> {
  const prediction: Prediction = {
    taskId,
    taskType,
    predictedSuccess: Math.max(0, Math.min(1, predictedSuccess)),
    predictedDurationMs,
    predictedTokens,
    timestamp: Date.now(),
  };

  await appendEntry(PREDICTIONS_FILE, prediction);
}

// Log outcome after task execution
export async function logOutcome(
  taskId: string,
  actualSuccess: boolean,
  actualDurationMs: number = 0,
  actualTokens: number = 0,
): Promise<void> {
  const outcome: Outcome = {
    taskId,
    actualSuccess,
    actualDurationMs,
    actualTokens,
    timestamp: Date.now(),
  };

  await appendEntry(OUTCOMES_FILE, outcome);
}

// Get calibration report
export async function getCalibrationReport(
  taskTypeFilter?: string,
  sinceDays: number = 7,
): Promise<CalibrationReport> {
  const cutoffMs = Date.now() - sinceDays * 24 * 60 * 60 * 1000;

  const predictions = await loadEntries<Prediction>(PREDICTIONS_FILE);
  const outcomes = await loadEntries<Outcome>(OUTCOMES_FILE);

  // Filter by time
  const recentPredictions = predictions.filter((p) => p.timestamp > cutoffMs);
  const outcomeMap = new Map(outcomes.map((o) => [o.taskId, o]));

  // Match predictions with outcomes
  const matched: Array<{
    prediction: Prediction;
    outcome: Outcome;
  }> = [];

  for (const pred of recentPredictions) {
    if (taskTypeFilter && pred.taskType !== taskTypeFilter) continue;
    const outcome = outcomeMap.get(pred.taskId);
    if (outcome) {
      matched.push({ prediction: pred, outcome });
    }
  }

  if (matched.length === 0) {
    return {
      totalTasks: recentPredictions.length,
      matchedTasks: 0,
      successCalibration: 0,
      durationBias: 0,
      tokenBias: 0,
      byTaskType: {},
      overconfidentTasks: 0,
      underconfidentTasks: 0,
    };
  }

  // Calculate metrics
  let successCalibrationSum = 0;
  let durationBiasSum = 0;
  let tokenBiasSum = 0;
  let durationCount = 0;
  let tokenCount = 0;
  let overconfident = 0;
  let underconfident = 0;

  const byType: Record<string, { predictions: number[]; outcomes: boolean[] }> = {};

  for (const { prediction, outcome } of matched) {
    const actualSuccess = outcome.actualSuccess ? 1 : 0;
    const predError = prediction.predictedSuccess - actualSuccess;
    successCalibrationSum += Math.abs(predError);

    if (predError > 0.2) overconfident++;
    if (predError < -0.2) underconfident++;

    if (prediction.predictedDurationMs > 0 && outcome.actualDurationMs > 0) {
      durationBiasSum +=
        (prediction.predictedDurationMs - outcome.actualDurationMs) / outcome.actualDurationMs;
      durationCount++;
    }

    if (prediction.predictedTokens > 0 && outcome.actualTokens > 0) {
      tokenBiasSum += (prediction.predictedTokens - outcome.actualTokens) / outcome.actualTokens;
      tokenCount++;
    }

    if (!byType[prediction.taskType]) {
      byType[prediction.taskType] = { predictions: [], outcomes: [] };
    }
    byType[prediction.taskType].predictions.push(prediction.predictedSuccess);
    byType[prediction.taskType].outcomes.push(outcome.actualSuccess);
  }

  // Calculate per-type stats
  const byTaskType: CalibrationReport["byTaskType"] = {};
  for (const [type, data] of Object.entries(byType)) {
    const avgPred = data.predictions.reduce((a, b) => a + b, 0) / data.predictions.length;
    const actualRate = data.outcomes.filter(Boolean).length / data.outcomes.length;
    byTaskType[type] = {
      count: data.predictions.length,
      avgPredictedSuccess: avgPred,
      actualSuccessRate: actualRate,
      calibrationError: Math.abs(avgPred - actualRate),
    };
  }

  return {
    totalTasks: recentPredictions.length,
    matchedTasks: matched.length,
    successCalibration: successCalibrationSum / matched.length,
    durationBias: durationCount > 0 ? durationBiasSum / durationCount : 0,
    tokenBias: tokenCount > 0 ? tokenBiasSum / tokenCount : 0,
    byTaskType,
    overconfidentTasks: overconfident,
    underconfidentTasks: underconfident,
  };
}

// Quick assessment
export async function getConfidenceAssessment(): Promise<{
  status: "calibrated" | "overconfident" | "underconfident" | "insufficient_data";
  recommendation: string;
}> {
  const report = await getCalibrationReport(undefined, 7);

  if (report.matchedTasks < 10) {
    return {
      status: "insufficient_data",
      recommendation: "Not enough data yet. Keep logging predictions and outcomes.",
    };
  }

  if (report.overconfidentTasks > report.underconfidentTasks * 2) {
    return {
      status: "overconfident",
      recommendation:
        "Reduce confidence estimates by 10-20%. Predicting success more often than achieved.",
    };
  }

  if (report.underconfidentTasks > report.overconfidentTasks * 2) {
    return {
      status: "underconfident",
      recommendation:
        "Increase confidence estimates by 10-20%. More capable than predictions suggest.",
    };
  }

  return {
    status: "calibrated",
    recommendation: "Predictions are well-calibrated. Maintain current estimation approach.",
  };
}
