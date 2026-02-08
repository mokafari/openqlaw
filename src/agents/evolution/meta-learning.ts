/**
 * Meta-Learning System: Learning how to learn better
 *
 * Tracks predictions, calibration, learning patterns, and evolves strategies.
 */

import { promises as fs } from "node:fs";
import { join } from "node:path";
import { resolveStateDir } from "../../config/paths.js";
import { log } from "../pi-embedded-runner/logger.js";

export type Prediction = {
  taskId: string;
  taskType: string;
  predictedSuccess: number; // 0.0 - 1.0 (calibration-adjusted)
  predictedDifficulty: number; // 0.0 - 1.0
  predictedDurationMs: number;
  timestamp: number;
  // Calibration tracking (optional for backward compatibility)
  rawPredictedSuccess?: number; // Raw prediction before calibration boost
  calibrationBoost?: number; // Amount of boost applied
};

export type Outcome = {
  taskId: string;
  actualSuccess: boolean;
  actualDurationMs: number;
  actualDifficulty?: number; // Optional post-hoc assessment
  timestamp: number;
};

export type CalibrationMetrics = {
  taskType: string;
  predictionCount: number;
  meanPredictedSuccess: number;
  actualSuccessRate: number;
  calibrationError: number; // |predicted - actual|
  brierScore: number; // Lower is better
  overconfident: boolean; // predicted > actual
  underconfident: boolean; // predicted < actual
};

export type LearningJournalEntry = {
  date: string; // YYYY-MM-DD
  whatWorked: string[];
  whatFailed: string[];
  patterns: string[];
  insights: string[];
  strategyChanges: string[];
};

export class MetaLearningSystem {
  private readonly stateDir: string;
  private readonly predictionsFile: string;
  private readonly outcomesFile: string;
  private readonly journalDir: string;

  constructor() {
    this.stateDir = join(resolveStateDir(), "evolution", "meta-learning");
    this.predictionsFile = join(this.stateDir, "predictions.jsonl");
    this.outcomesFile = join(this.stateDir, "outcomes.jsonl");
    this.journalDir = join(this.stateDir, "journal");
  }

  /**
   * Log a prediction before starting a task.
   */
  async logPrediction(prediction: Prediction): Promise<void> {
    await fs.mkdir(this.stateDir, { recursive: true });
    const line = JSON.stringify(prediction) + "\n";
    await fs.appendFile(this.predictionsFile, line, "utf-8");
    log.debug(`[meta-learning] Logged prediction for task ${prediction.taskId}`);
  }

  /**
   * Log an outcome after completing a task.
   */
  async logOutcome(outcome: Outcome): Promise<void> {
    await fs.mkdir(this.stateDir, { recursive: true });
    const line = JSON.stringify(outcome) + "\n";
    await fs.appendFile(this.outcomesFile, line, "utf-8");
    log.debug(`[meta-learning] Logged outcome for task ${outcome.taskId}`);
  }

  /**
   * Calculate calibration metrics for a task type.
   */
  async getCalibrationMetrics(taskType: string): Promise<CalibrationMetrics | null> {
    console.log(`[meta-learning] getCalibrationMetrics called with taskType=${taskType}`);
    const predictions = await this.loadPredictions(taskType);
    const outcomes = await this.loadOutcomes(taskType);
    console.log(
      `[meta-learning] loaded ${predictions.length} predictions, ${outcomes.length} outcomes`,
    );

    if (predictions.length === 0 || outcomes.length === 0) {
      console.log(`[meta-learning] early return: no predictions or outcomes`);
      return null;
    }

    // Match predictions to outcomes by taskId
    const matched: Array<{ prediction: Prediction; outcome: Outcome }> = [];
    const outcomeMap = new Map(outcomes.map((o) => [o.taskId, o]));

    for (const pred of predictions) {
      const outcome = outcomeMap.get(pred.taskId);
      if (outcome) {
        matched.push({ prediction: pred, outcome });
      }
    }

    console.log(`[meta-learning] matched ${matched.length} predictions to outcomes`);
    if (matched.length === 0) {
      console.log(`[meta-learning] no matches found, returning null`);
      return null;
    }

    const meanPredicted =
      matched.reduce((sum, m) => sum + m.prediction.predictedSuccess, 0) / matched.length;
    const actualSuccessRate =
      matched.filter((m) => m.outcome.actualSuccess).length / matched.length;
    const calibrationError = Math.abs(meanPredicted - actualSuccessRate);

    // Brier score: mean squared error of predictions
    const brierScore =
      matched.reduce((sum, m) => {
        const error = m.prediction.predictedSuccess - (m.outcome.actualSuccess ? 1 : 0);
        return sum + error * error;
      }, 0) / matched.length;

    return {
      taskType,
      predictionCount: matched.length,
      meanPredictedSuccess: meanPredicted,
      actualSuccessRate,
      calibrationError,
      brierScore,
      overconfident: meanPredicted > actualSuccessRate,
      underconfident: meanPredicted < actualSuccessRate,
    };
  }

  /**
   * Add an entry to the learning journal.
   */
  async addJournalEntry(entry: LearningJournalEntry): Promise<void> {
    await fs.mkdir(this.journalDir, { recursive: true });
    const filePath = join(this.journalDir, `${entry.date}.md`);

    const content = `# Learning Journal - ${entry.date}

## What Worked
${entry.whatWorked.map((item) => `- ${item}`).join("\n")}

## What Failed
${entry.whatFailed.map((item) => `- ${item}`).join("\n")}

## Patterns Detected
${entry.patterns.map((item) => `- ${item}`).join("\n")}

## Insights
${entry.insights.map((item) => `- ${item}`).join("\n")}

## Strategy Changes
${entry.strategyChanges.map((item) => `- ${item}`).join("\n")}
`;

    await fs.writeFile(filePath, content, "utf-8");
    log.info(`[meta-learning] Added journal entry for ${entry.date}`);
  }

  /**
   * Get recent learning journal entries.
   */
  async getRecentJournalEntries(days: number = 7): Promise<LearningJournalEntry[]> {
    const entries: LearningJournalEntry[] = [];
    const today = new Date();

    for (let i = 0; i < days; i++) {
      const date = new Date(today);
      date.setDate(date.getDate() - i);
      const dateStr = date.toISOString().split("T")[0]; // YYYY-MM-DD

      const filePath = join(this.journalDir, `${dateStr}.md`);
      try {
        const content = await fs.readFile(filePath, "utf-8");
        const entry = this.parseJournalEntry(content, dateStr);
        if (entry) {
          entries.push(entry);
        }
      } catch {
        // File doesn't exist, skip
      }
    }

    return entries;
  }

  /**
   * Analyze patterns across journal entries and generate insights.
   */
  async analyzePatterns(): Promise<{
    recurringFailures: string[];
    successfulStrategies: string[];
    improvementTrends: string[];
  }> {
    const entries = await this.getRecentJournalEntries(30);

    const allFailures = entries.flatMap((e) => e.whatFailed);
    const allSuccesses = entries.flatMap((e) => e.whatWorked);
    const allPatterns = entries.flatMap((e) => e.patterns);

    // Count occurrences
    const failureCounts = new Map<string, number>();
    for (const failure of allFailures) {
      failureCounts.set(failure, (failureCounts.get(failure) || 0) + 1);
    }

    const successCounts = new Map<string, number>();
    for (const success of allSuccesses) {
      successCounts.set(success, (successCounts.get(success) || 0) + 1);
    }

    const recurringFailures = Array.from(failureCounts.entries())
      .filter(([, count]) => count >= 3)
      .sort(([, a], [, b]) => b - a)
      .map(([failure]) => failure);

    const successfulStrategies = Array.from(successCounts.entries())
      .filter(([, count]) => count >= 2)
      .sort(([, a], [, b]) => b - a)
      .map(([strategy]) => strategy);

    return {
      recurringFailures,
      successfulStrategies,
      improvementTrends: allPatterns.filter((p, i, arr) => arr.indexOf(p) === i), // Unique patterns
    };
  }

  private async loadPredictions(taskType?: string): Promise<Prediction[]> {
    try {
      const content = await fs.readFile(this.predictionsFile, "utf-8");
      const lines = content.trim().split("\n").filter(Boolean);
      const predictions: Prediction[] = [];
      for (const line of lines) {
        try {
          const pred = JSON.parse(line) as Prediction;
          // "all" or undefined means no filter
          if (!taskType || taskType === "all" || pred.taskType === taskType) {
            predictions.push(pred);
          }
        } catch {
          // Skip malformed lines
        }
      }
      return predictions;
    } catch {
      return [];
    }
  }

  private async loadOutcomes(taskType?: string): Promise<Outcome[]> {
    try {
      const content = await fs.readFile(this.outcomesFile, "utf-8");
      const lines = content.trim().split("\n").filter(Boolean);
      const outcomes: Outcome[] = [];
      for (const line of lines) {
        try {
          const outcome = JSON.parse(line) as Outcome;
          // Match by taskType from predictions if needed
          if (!taskType) {
            outcomes.push(outcome);
          } else {
            // We'd need to match via taskId, so include all for now
            outcomes.push(outcome);
          }
        } catch {
          // Skip malformed lines
        }
      }
      return outcomes;
    } catch {
      return [];
    }
  }

  private parseJournalEntry(content: string, date: string): LearningJournalEntry | null {
    const entry: LearningJournalEntry = {
      date,
      whatWorked: [],
      whatFailed: [],
      patterns: [],
      insights: [],
      strategyChanges: [],
    };

    let currentSection: keyof LearningJournalEntry | null = null;

    for (const line of content.split("\n")) {
      if (line.startsWith("## ")) {
        const section = line.replace("## ", "").trim().toLowerCase();
        if (section.includes("worked")) {
          currentSection = "whatWorked";
        } else if (section.includes("failed")) {
          currentSection = "whatFailed";
        } else if (section.includes("pattern")) {
          currentSection = "patterns";
        } else if (section.includes("insight")) {
          currentSection = "insights";
        } else if (section.includes("strategy")) {
          currentSection = "strategyChanges";
        } else {
          currentSection = null;
        }
        continue;
      }

      if (line.startsWith("- ") && currentSection && currentSection !== "date") {
        const item = line.replace("- ", "").trim();
        if (item) {
          (entry[currentSection] as string[]).push(item);
        }
      }
    }

    return entry;
  }
}
