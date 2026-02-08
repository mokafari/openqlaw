/**
 * Auto-Satisfaction Derivation
 *
 * Automatically derives user satisfaction scores from observable signals:
 * - Goal completion success
 * - Pattern fitness and reuse
 * - Execution quality (errors, efficiency, speed)
 *
 * This enables production fitness tracking without manual user feedback.
 */

import type { EmbeddingProvider } from "../../memory/embeddings.js";
import type { Goal } from "../goals/types.js";
import type { PatternStore } from "../tensor/pattern-store.js";
import type { ActionPattern } from "../tensor/types.js";
import type { ToolErrorInfo } from "./telemetry.js";

export type SatisfactionSignals = {
  /** Goals at session start/end for completion analysis */
  goals?: {
    initial: Goal[];
    final: Goal[];
  };

  /** Similar patterns from tensor store (for pattern fitness analysis) */
  similarPatterns?: ActionPattern[];

  /** Execution quality signals */
  execution: {
    success: boolean;
    aborted: boolean;
    errorCount: number;
    durationMs: number;
    tokenUsage: { input: number; output: number; total: number };
    toolCalls: number;
    toolErrors?: Record<string, ToolErrorInfo>;
  };

  /** Optional: context for pattern similarity search */
  contextText?: string;
};

/**
 * Derive satisfaction score from observable signals.
 *
 * Formula: Satisfaction = (wG * G) + (wP * P) + (wE * E)
 * Where:
 * - G = Goal completion score (0.0 - 1.0)
 * - P = Pattern fitness score (0.0 - 1.0)
 * - E = Execution quality score (0.0 - 1.0)
 *
 * Weights are dynamically adjusted: when goals or patterns are not tracked,
 * execution quality gets more weight to avoid penalizing good execution
 * when we simply lack signal data.
 */
export function deriveSatisfactionScore(signals: SatisfactionSignals): number {
  const hasGoals = signals.goals && signals.goals.initial.length > 0;
  const hasPatterns = signals.similarPatterns && signals.similarPatterns.length > 0;

  // Dynamic weights: redistribute from missing signals
  // When all signals available: balanced weights
  // When signals missing: adjust to avoid penalizing good execution
  let weights = { goal: 0.4, pattern: 0.3, execution: 0.3 };

  if (!hasGoals && !hasPatterns) {
    // No goal or pattern data: rely primarily on execution quality
    weights = { goal: 0.1, pattern: 0.1, execution: 0.8 };
  } else if (!hasGoals) {
    // No goal data: shift goal weight to pattern and execution
    weights = { goal: 0.1, pattern: 0.4, execution: 0.5 };
  } else if (!hasPatterns) {
    // No pattern data: goal completion is primary signal
    weights = { goal: 0.65, pattern: 0.1, execution: 0.25 };
  }

  // --- Goal Completion Score (G) ---
  const G = calculateGoalScore(signals.goals);

  // --- Pattern Fitness Score (P) ---
  const P = calculatePatternScore(signals.similarPatterns);

  // --- Execution Quality Score (E) ---
  const E = calculateExecutionScore(signals.execution);

  const satisfaction = weights.goal * G + weights.pattern * P + weights.execution * E;

  // Clamp to 0-1 range
  return Math.max(0, Math.min(1, satisfaction));
}

/**
 * Calculate goal completion score from goal state changes.
 *
 * Scoring:
 * - All goals completed: 1.0
 * - Some goals completed: 0.5 + (completionRatio * 0.5)
 * - Goals blocked/failed: 0.3
 * - No goals tracked: 0.6 (neutral-positive)
 */
function calculateGoalScore(goals?: { initial: Goal[]; final: Goal[] }): number {
  if (!goals || goals.initial.length === 0) {
    // No goal tracking: assume neutral-positive (most tasks succeed)
    return 0.6;
  }

  const initialActive = goals.initial.filter(
    (g) => g.status === "active" || g.status === "pending",
  ).length;
  const finalCompleted = goals.final.filter((g) => g.status === "completed").length;
  const finalBlocked = goals.final.filter((g) => g.status === "blocked").length;
  const finalFailed = goals.final.filter((g) => g.status === "failed").length;

  // If any goals failed, cap satisfaction
  if (finalFailed > 0) {
    return 0.2;
  }

  // If goals blocked, reduce satisfaction
  if (finalBlocked > 0) {
    return 0.3;
  }

  // Calculate completion ratio
  if (initialActive === 0) {
    return 0.6;
  }

  const completionRatio = finalCompleted / initialActive;

  // All completed = 1.0, partial = 0.5 to 1.0 range
  return 0.5 + completionRatio * 0.5;
}

/**
 * Calculate pattern fitness score from similar historical patterns.
 *
 * Scoring:
 * - High fitness patterns exist (>0.7): Use avg fitness
 * - No similar patterns: 0.5 (neutral)
 * - Low fitness patterns (<0.5): 0.3 (learned negative)
 */
function calculatePatternScore(patterns?: ActionPattern[]): number {
  if (!patterns || patterns.length === 0) {
    // No patterns: neutral score (new context)
    return 0.5;
  }

  // Calculate average fitness of similar patterns
  const totalFitness = patterns.reduce((sum, p) => sum + p.fitness, 0);
  const avgFitness = totalFitness / patterns.length;

  // Weight by usage count (patterns that get reused are more satisfactory)
  const totalUsage = patterns.reduce((sum, p) => sum + p.usageCount, 0);
  const usageBonus = Math.min(0.2, totalUsage * 0.01); // Up to +0.2 for high-usage patterns

  return Math.min(1.0, avgFitness + usageBonus);
}

/**
 * Calculate execution quality score.
 *
 * Factors:
 * - Success/failure
 * - Errors
 * - Efficiency (tokens, tool calls)
 * - Speed
 */
function calculateExecutionScore(exec: SatisfactionSignals["execution"]): number {
  let score = 0.5; // Start neutral

  // Success/failure (±0.3)
  if (exec.success && !exec.aborted) {
    score += 0.3;
  } else if (exec.aborted) {
    score -= 0.3;
  } else {
    score -= 0.2;
  }

  // Error penalty (-0.2 for errors)
  if (exec.errorCount > 0 || (exec.toolErrors && Object.keys(exec.toolErrors).length > 0)) {
    score -= 0.2;
  }

  // Efficiency bonus (±0.1)
  const tokenEfficiency = Math.max(0, 1 - exec.tokenUsage.total / 100_000); // Assume 100K is baseline
  const efficiencyBonus = tokenEfficiency * 0.1;
  score += efficiencyBonus;

  // Speed bonus (±0.1)
  if (exec.durationMs < 5000) {
    score += 0.1; // Fast execution
  } else if (exec.durationMs > 30_000) {
    score -= 0.1; // Slow execution
  }

  // Tool call efficiency (±0.1)
  if (exec.toolCalls > 0 && exec.toolCalls < 10) {
    score += 0.1; // Efficient tool use
  } else if (exec.toolCalls > 30) {
    score -= 0.1; // Excessive tool calls
  }

  // Clamp to 0-1
  return Math.max(0, Math.min(1, score));
}

/**
 * Fetch similar patterns for satisfaction derivation.
 *
 * Uses tensor pattern store to find historically successful similar contexts.
 */
export async function fetchSimilarPatternsForSatisfaction(params: {
  contextText: string;
  embeddingProvider: EmbeddingProvider;
  patternStore: PatternStore;
  limit?: number;
}): Promise<ActionPattern[]> {
  const { contextText, embeddingProvider, patternStore, limit = 5 } = params;

  try {
    // Embed the context
    const embedding = await embeddingProvider.embedQuery(contextText.slice(0, 2000));

    // Search for similar patterns
    const results = await patternStore.searchByVector(embedding, limit);

    return results;
  } catch (err) {
    // If search fails, return empty (neutral pattern score)
    return [];
  }
}
