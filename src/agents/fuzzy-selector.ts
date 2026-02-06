/**
 * Fuzzy Model Selector
 *
 * Uses fuzzy logic to select models based on task complexity,
 * context budget, and user urgency. Inspired by Quake III Bot's
 * weapon selection system (Preference * Effectiveness).
 */

import type { ModelRef } from "./model-selection.js";
import { DEFAULT_MODEL, DEFAULT_PROVIDER } from "./defaults.js";

export type TaskComplexity = number; // 0.0 (simple) to 1.0 (complex)
export type ContextBudget = number; // 0.0 (low) to 1.0 (high)
export type UserUrgency = number; // 0.0 (low) to 1.0 (high)

export type FuzzySelectionParams = {
  taskComplexity: TaskComplexity;
  contextBudget: ContextBudget;
  userUrgency?: UserUrgency;
  defaultProvider?: string;
  defaultModel?: string;
};

/**
 * Analyze task complexity from prompt text
 *
 * Returns a value between 0.0 (simple) and 1.0 (complex).
 */
export function analyzeTaskComplexity(prompt: string): TaskComplexity {
  if (!prompt || prompt.trim().length === 0) {
    return 0.1; // Very simple
  }

  const text = prompt.toLowerCase();
  let complexity = 0.3; // Base complexity

  // Simple task indicators (reduce complexity)
  const simpleIndicators = [
    "time",
    "date",
    "what time",
    "what date",
    "read",
    "show",
    "list",
    "status",
    "check",
  ];
  const simpleCount = simpleIndicators.filter((indicator) => text.includes(indicator)).length;
  complexity -= simpleCount * 0.1;

  // Complex task indicators (increase complexity)
  const complexIndicators = [
    "refactor",
    "architecture",
    "redesign",
    "migrate",
    "rewrite",
    "implement",
    "create",
    "build",
    "design",
    "optimize",
    "debug",
    "fix",
    "multiple",
    "several",
    "complex",
    "complicated",
  ];
  const complexCount = complexIndicators.filter((indicator) => text.includes(indicator)).length;
  complexity += complexCount * 0.15;

  // Length-based complexity (longer prompts tend to be more complex)
  const wordCount = text.split(/\s+/).length;
  if (wordCount > 100) {
    complexity += 0.2;
  } else if (wordCount > 50) {
    complexity += 0.1;
  }

  // Clamp between 0.0 and 1.0
  return Math.max(0.0, Math.min(1.0, complexity));
}

/**
 * Calculate context budget from context window info
 *
 * Returns a value between 0.0 (low budget) and 1.0 (high budget).
 */
export function calculateContextBudget(contextWindow: number, usedTokens: number): ContextBudget {
  if (contextWindow <= 0) {
    return 0.5; // Default medium budget
  }

  const remaining = contextWindow - usedTokens;
  const budget = remaining / contextWindow;

  // Clamp between 0.0 and 1.0
  return Math.max(0.0, Math.min(1.0, budget));
}

/**
 * Select model using fuzzy logic
 *
 * Uses switch/case style fuzzy logic similar to Quake III Bot's
 * weapon selection system.
 */
export function selectModelFuzzy(params: FuzzySelectionParams): ModelRef {
  const {
    taskComplexity,
    contextBudget,
    userUrgency = 0.5,
    defaultProvider = DEFAULT_PROVIDER,
    defaultModel = DEFAULT_MODEL,
  } = params;

  // Model tier mapping (inspired by Quake weapon tiers)
  // High complexity + high budget → "BFG10K" (opus)
  // Low complexity → "Machine Gun" (haiku-flash)
  // Medium complexity → default (sonnet)

  // Weight calculation: complexity * budget * urgency
  const weight = taskComplexity * contextBudget * (0.5 + userUrgency * 0.5);

  // High-end model selection (BFG10K tier)
  if (taskComplexity > 0.8 && contextBudget > 0.5) {
    return {
      provider: defaultProvider,
      model: "claude-opus-4-5", // BFG10K - most powerful
    };
  }

  // Low-end model selection (Machine Gun tier)
  if (taskComplexity < 0.2 || weight < 0.1) {
    return {
      provider: defaultProvider,
      model: "claude-haiku-3-5", // Machine Gun - fast and cheap
    };
  }

  // Medium complexity with urgency → use faster model
  if (taskComplexity < 0.5 && userUrgency > 0.7) {
    return {
      provider: defaultProvider,
      model: "claude-haiku-3-5", // Fast response for urgent simple tasks
    };
  }

  // Medium complexity → default model (Sonnet tier)
  if (taskComplexity < 0.7) {
    return {
      provider: defaultProvider,
      model: defaultModel, // Default balanced model
    };
  }

  // High complexity but low budget → use efficient model
  if (contextBudget < 0.3) {
    return {
      provider: defaultProvider,
      model: "claude-sonnet-4-5", // Efficient for high complexity
    };
  }

  // Default to high-end for complex tasks
  return {
    provider: defaultProvider,
    model: "claude-opus-4-5",
  };
}

/**
 * Get model selection reasoning (for debugging/logging)
 */
export function getFuzzySelectionReasoning(params: FuzzySelectionParams): string {
  const selection = selectModelFuzzy(params);
  const { taskComplexity, contextBudget, userUrgency = 0.5 } = params;

  const reasons: string[] = [];

  if (taskComplexity > 0.8) {
    reasons.push("high complexity");
  } else if (taskComplexity < 0.2) {
    reasons.push("low complexity");
  }

  if (contextBudget > 0.5) {
    reasons.push("high context budget");
  } else if (contextBudget < 0.3) {
    reasons.push("low context budget");
  }

  if (userUrgency > 0.7) {
    reasons.push("high urgency");
  }

  return `Selected ${selection.provider}/${selection.model} (${reasons.join(", ")})`;
}
