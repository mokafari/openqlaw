import crypto from "crypto";
import { promises as fs } from "fs";
import path from "path";
import { readPromptSessions, type PromptSessionOutcome } from "../evolution/prompt-metrics.js";
import {
  loadExperimentRegistry,
  saveExperimentRegistry,
  createExperiment,
  completeExperiment,
  getActiveExperiments,
  type PromptExperiment,
} from "./registry.js";

export interface ABTestResults {
  experimentId: string;
  baselineMetrics: {
    successRate: number;
    tokenEfficiency: number;
    errorRate: number;
    sampleSize: number;
  };
  candidateMetrics: {
    successRate: number;
    tokenEfficiency: number;
    errorRate: number;
    sampleSize: number;
  };
  significance: {
    pValue: number;
    isSignificant: boolean;
    confidenceLevel: number;
  };
  winner: "baseline" | "candidate" | "inconclusive";
  improvement: number; // Percentage improvement of winner
}

/**
 * Create a new A/B test experiment.
 */
export async function startABTest(params: {
  name: string;
  baselinePromptId: string;
  candidatePromptId: string;
  trafficSplit?: { baseline: number; candidate: number };
  minSampleSize?: number;
  targetMetrics?: string[];
}): Promise<string> {
  const experimentId = await createExperiment({
    name: params.name,
    baselinePromptId: params.baselinePromptId,
    candidatePromptId: params.candidatePromptId,
    allocation: params.trafficSplit || { baseline: 0.5, candidate: 0.5 },
    successCriteria: {
      minSampleSize: params.minSampleSize || 100,
      metrics: params.targetMetrics || ["successRate", "tokenEfficiency", "errorRate"],
    },
  });

  console.log(`Started A/B test: ${params.name} (${experimentId})`);
  console.log(`Baseline: ${params.baselinePromptId}`);
  console.log(`Candidate: ${params.candidatePromptId}`);
  console.log(
    `Traffic split: ${JSON.stringify(params.trafficSplit || { baseline: 0.5, candidate: 0.5 })}`,
  );

  return experimentId;
}

/**
 * Analyze A/B test results using statistical significance testing.
 */
export async function analyzeABTest(experimentId: string): Promise<ABTestResults | null> {
  const experiments = await loadExperimentRegistry();
  const experiment = experiments[experimentId];

  if (!experiment || experiment.status !== "active") {
    return null;
  }

  // Get sessions for both variants
  const allSessions = await readPromptSessions();
  const baselineSessions = allSessions.filter(
    (s) => s.experimentId === experimentId && s.promptId === experiment.baseline.promptId,
  );
  const candidateSessions = allSessions.filter(
    (s) => s.experimentId === experimentId && s.promptId === experiment.candidate.promptId,
  );

  if (baselineSessions.length === 0 || candidateSessions.length === 0) {
    console.log(
      `Insufficient data for experiment ${experimentId}: baseline=${baselineSessions.length}, candidate=${candidateSessions.length}`,
    );
    return null;
  }

  // Calculate metrics for each variant
  const baselineMetrics = calculateMetrics(baselineSessions);
  const candidateMetrics = calculateMetrics(candidateSessions);

  // Check if we have minimum sample size
  const minSampleSize = experiment.successCriteria.minSampleSize;
  if (baselineMetrics.sampleSize < minSampleSize || candidateMetrics.sampleSize < minSampleSize) {
    console.log(
      `Insufficient sample size for experiment ${experimentId}: need ${minSampleSize}, have baseline=${baselineMetrics.sampleSize}, candidate=${candidateMetrics.sampleSize}`,
    );
    return null;
  }

  // Perform statistical significance test
  const significance = calculateSignificance(baselineSessions, candidateSessions);

  // Determine winner based on primary metric (success rate)
  let winner: "baseline" | "candidate" | "inconclusive";
  let improvement: number;

  if (!significance.isSignificant) {
    winner = "inconclusive";
    improvement = 0;
  } else if (candidateMetrics.successRate > baselineMetrics.successRate) {
    winner = "candidate";
    improvement =
      ((candidateMetrics.successRate - baselineMetrics.successRate) / baselineMetrics.successRate) *
      100;
  } else {
    winner = "baseline";
    improvement =
      ((baselineMetrics.successRate - candidateMetrics.successRate) /
        candidateMetrics.successRate) *
      100;
  }

  return {
    experimentId,
    baselineMetrics,
    candidateMetrics,
    significance,
    winner,
    improvement,
  };
}

/**
 * Calculate metrics for a set of sessions.
 */
function calculateMetrics(sessions: PromptSessionOutcome[]): ABTestResults["baselineMetrics"] {
  if (sessions.length === 0) {
    return {
      successRate: 0,
      tokenEfficiency: 1,
      errorRate: 0,
      sampleSize: 0,
    };
  }

  const successCount = sessions.filter((s) => s.success).length;
  const successRate = successCount / sessions.length;

  const avgTokenEfficiency =
    sessions.reduce((sum, s) => sum + s.tokenEfficiency, 0) / sessions.length;
  const avgErrorRate = sessions.reduce((sum, s) => sum + s.errorRate, 0) / sessions.length;

  return {
    successRate,
    tokenEfficiency: avgTokenEfficiency,
    errorRate: avgErrorRate,
    sampleSize: sessions.length,
  };
}

/**
 * Calculate statistical significance using chi-square test for proportions.
 * This is a simplified implementation - in production you might want more sophisticated stats.
 */
function calculateSignificance(
  baselineSessions: PromptSessionOutcome[],
  candidateSessions: PromptSessionOutcome[],
): ABTestResults["significance"] {
  const baselineSuccesses = baselineSessions.filter((s) => s.success).length;
  const baselineTotal = baselineSessions.length;
  const candidateSuccesses = candidateSessions.filter((s) => s.success).length;
  const candidateTotal = candidateSessions.length;

  // Chi-square test for proportions
  const totalSuccesses = baselineSuccesses + candidateSuccesses;
  const totalSessions = baselineTotal + candidateTotal;
  const pooledRate = totalSuccesses / totalSessions;

  // Expected values
  const expectedBaselineSuccesses = baselineTotal * pooledRate;
  const expectedBaselineFailures = baselineTotal * (1 - pooledRate);
  const expectedCandidateSuccesses = candidateTotal * pooledRate;
  const expectedCandidateFailures = candidateTotal * (1 - pooledRate);

  // Chi-square statistic
  const chiSquare =
    Math.pow(baselineSuccesses - expectedBaselineSuccesses, 2) / expectedBaselineSuccesses +
    Math.pow(baselineTotal - baselineSuccesses - expectedBaselineFailures, 2) /
      expectedBaselineFailures +
    Math.pow(candidateSuccesses - expectedCandidateSuccesses, 2) / expectedCandidateSuccesses +
    Math.pow(candidateTotal - candidateSuccesses - expectedCandidateFailures, 2) /
      expectedCandidateFailures;

  // Degrees of freedom = 1 for 2x2 contingency table
  // For df=1, critical value at p=0.05 is 3.841
  const criticalValue = 3.841;
  const isSignificant = chiSquare > criticalValue;

  // Rough p-value estimation (this is simplified)
  let pValue: number;
  if (chiSquare <= 3.841) {
    pValue = 0.05; // Not significant
  } else if (chiSquare <= 6.635) {
    pValue = 0.01; // Significant at p < 0.05
  } else if (chiSquare <= 10.828) {
    pValue = 0.001; // Highly significant
  } else {
    pValue = 0.0001; // Very highly significant
  }

  return {
    pValue,
    isSignificant,
    confidenceLevel: isSignificant ? 95 : 0,
  };
}

/**
 * Complete an A/B test and declare a winner.
 */
export async function completeABTest(experimentId: string): Promise<ABTestResults | null> {
  const results = await analyzeABTest(experimentId);

  if (!results) {
    console.log(`Cannot complete experiment ${experimentId} - insufficient data`);
    return null;
  }

  const experiments = await loadExperimentRegistry();
  const experiment = experiments[experimentId];

  if (!experiment) {
    throw new Error(`Experiment ${experimentId} not found`);
  }

  const winnerPromptId =
    results.winner === "baseline"
      ? experiment.baseline.promptId
      : results.winner === "candidate"
        ? experiment.candidate.promptId
        : experiment.baseline.promptId; // Default to baseline if inconclusive

  await completeExperiment(experimentId, {
    winnerPromptId,
    improvement: results.improvement,
    pValue: results.significance.pValue,
    deployedAt: new Date().toISOString(),
  });

  console.log(`Completed A/B test ${experimentId}:`);
  console.log(`Winner: ${results.winner} (${results.improvement.toFixed(1)}% improvement)`);
  console.log(`Statistical significance: p=${results.significance.pValue.toFixed(3)}`);
  console.log(
    `Sample sizes: baseline=${results.baselineMetrics.sampleSize}, candidate=${results.candidateMetrics.sampleSize}`,
  );

  return results;
}

/**
 * Stop an A/B test without declaring a winner.
 */
export async function stopABTest(
  experimentId: string,
  reason: string = "Manual stop",
): Promise<void> {
  const experiments = await loadExperimentRegistry();
  const experiment = experiments[experimentId];

  if (!experiment) {
    throw new Error(`Experiment ${experimentId} not found`);
  }

  if (experiment.status !== "active") {
    throw new Error(`Experiment ${experimentId} is not active (status: ${experiment.status})`);
  }

  experiment.status = "rolled-back";
  await saveExperimentRegistry(experiments);

  console.log(`Stopped A/B test ${experimentId}: ${reason}`);
}

/**
 * Get status of all active A/B tests.
 */
export async function getABTestStatus(): Promise<
  Array<{
    experimentId: string;
    name: string;
    status: string;
    daysRunning: number;
    sampleSizes: { baseline: number; candidate: number };
    readyToComplete: boolean;
  }>
> {
  const experiments = await getActiveExperiments();
  const allSessions = await readPromptSessions();

  const results = [];

  for (const experiment of experiments) {
    const baselineSessions = allSessions.filter(
      (s) => s.experimentId === experiment.id && s.promptId === experiment.baseline.promptId,
    );
    const candidateSessions = allSessions.filter(
      (s) => s.experimentId === experiment.id && s.promptId === experiment.candidate.promptId,
    );

    // Estimate when experiment started (from first session)
    const allExpSessions = [...baselineSessions, ...candidateSessions];
    const startTime =
      allExpSessions.length > 0 ? Math.min(...allExpSessions.map((s) => s.timestamp)) : Date.now();

    const daysRunning = (Date.now() - startTime) / (24 * 60 * 60 * 1000);

    const readyToComplete =
      baselineSessions.length >= experiment.successCriteria.minSampleSize &&
      candidateSessions.length >= experiment.successCriteria.minSampleSize;

    results.push({
      experimentId: experiment.id,
      name: experiment.name,
      status: experiment.status,
      daysRunning,
      sampleSizes: {
        baseline: baselineSessions.length,
        candidate: candidateSessions.length,
      },
      readyToComplete,
    });
  }

  return results;
}

/**
 * Generate A/B test report for the health report.
 */
export async function generateABTestReport(): Promise<
  Array<{
    experimentId: string;
    name: string;
    winner: string;
    improvement: number;
    significance: number;
    recommendation: string;
  }>
> {
  const experiments = await loadExperimentRegistry();
  const completedExperiments = Object.values(experiments).filter(
    (exp) => exp.status === "complete" && exp.results,
  );

  const recentCompletions = completedExperiments
    .filter((exp) => {
      if (!exp.results?.deployedAt) return false;
      const deployedAt = new Date(exp.results.deployedAt).getTime();
      const oneWeekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
      return deployedAt > oneWeekAgo;
    })
    .slice(-5); // Most recent 5

  const results = [];

  for (const experiment of recentCompletions) {
    const results_data = experiment.results!;

    let recommendation: string;
    if (results_data.pValue < 0.01) {
      recommendation = `Deploy ${results_data.winnerPromptId} immediately - highly significant improvement`;
    } else if (results_data.pValue < 0.05) {
      recommendation = `Deploy ${results_data.winnerPromptId} - statistically significant improvement`;
    } else {
      recommendation = `No significant difference found - continue with current prompt`;
    }

    results.push({
      experimentId: experiment.id,
      name: experiment.name,
      winner: results_data.winnerPromptId,
      improvement: results_data.improvement,
      significance: results_data.pValue,
      recommendation,
    });
  }

  return results;
}
