/**
 * Fuzzy Inference Engine
 *
 * Implements fuzzy logic inference for cognitive economy decisions.
 */

import type { ThinkLevel } from "../../auto-reply/thinking.js";
import {
  CONTEXT_REMAINING,
  TASK_COMPLEXITY,
  URGENCY,
  CONFIDENCE,
  PATTERN_CONFIDENCE,
  getMembershipValue,
} from "./variables.js";

export type CognitiveEconomyDecision = {
  model: "opus" | "sonnet" | "haiku" | "flash";
  thinkingLevel: ThinkLevel;
  toolDepth: "full" | "summary" | "minimal";
  shouldDefer: boolean; // Defer to camping/cron
  usePatternBypass: boolean; // Tensor System 1 bypass recommended
};

export type CognitiveEconomyInputs = {
  contextRemaining: number; // 0-1 (percentage of context window remaining)
  taskComplexity: number; // 0-1 (estimated complexity)
  urgency: number; // 0-1 (how urgent is this task)
  previousAttempts: number; // Number of previous attempts
  confidence?: number; // 0-1 (confidence in current approach)
  patternRecallConfidence?: number; // 0-1 (tensor pattern recall confidence)
};

/**
 * Estimate task complexity from message characteristics
 */
export function estimateTaskComplexity(message: string, toolCount: number): number {
  const length = message.length;
  const hasCode = /```|`|function|class|import|export/.test(message);
  const hasMultiStep = /and|then|after|next|also/.test(message.toLowerCase());
  const hasQuestions = (message.match(/\?/g) || []).length;

  let complexity = 0;

  // Length factor (0-0.3)
  complexity += Math.min(0.3, length / 1000);

  // Code factor (0-0.2)
  if (hasCode) {
    complexity += 0.2;
  }

  // Multi-step factor (0-0.2)
  if (hasMultiStep) {
    complexity += 0.2;
  }

  // Question factor (0-0.1)
  complexity += Math.min(0.1, hasQuestions * 0.05);

  // Tool count factor (0-0.2)
  complexity += Math.min(0.2, toolCount / 10);

  return Math.min(1, complexity);
}

/**
 * Fuzzy inference for cognitive economy decision
 */
export function decideCognitiveAllocation(
  inputs: CognitiveEconomyInputs,
): CognitiveEconomyDecision {
  const {
    contextRemaining,
    taskComplexity,
    urgency,
    previousAttempts,
    confidence = 0.5,
    patternRecallConfidence,
  } = inputs;

  // Calculate membership values
  const ctxLow = getMembershipValue(CONTEXT_REMAINING, contextRemaining, "low");
  const ctxMed = getMembershipValue(CONTEXT_REMAINING, contextRemaining, "medium");
  const ctxHigh = getMembershipValue(CONTEXT_REMAINING, contextRemaining, "high");

  const taskSimple = getMembershipValue(TASK_COMPLEXITY, taskComplexity, "simple");
  const taskModerate = getMembershipValue(TASK_COMPLEXITY, taskComplexity, "moderate");
  const taskComplex = getMembershipValue(TASK_COMPLEXITY, taskComplexity, "complex");

  const urgLow = getMembershipValue(URGENCY, urgency, "low");
  const urgMed = getMembershipValue(URGENCY, urgency, "medium");
  const urgHigh = getMembershipValue(URGENCY, urgency, "high");

  const confLow = getMembershipValue(CONFIDENCE, confidence, "low");
  const confHigh = getMembershipValue(CONFIDENCE, confidence, "high");

  // Fuzzy rules for model selection
  // Rule 1: If context is low AND task is simple -> use flash
  const rule1 = Math.min(ctxLow, taskSimple);

  // Rule 2: If context is low AND task is moderate -> use haiku
  const rule2 = Math.min(ctxLow, taskModerate);

  // Rule 3: If context is medium AND task is simple -> use haiku
  const rule3 = Math.min(ctxMed, taskSimple);

  // Rule 4: If context is medium AND task is moderate -> use sonnet
  const rule4 = Math.min(ctxMed, taskModerate);

  // Rule 5: If context is high AND task is complex -> use opus
  const rule5 = Math.min(ctxHigh, taskComplex);

  // Rule 6: If task is complex AND urgency is high -> use opus
  const rule6 = Math.min(taskComplex, urgHigh);

  // Rule 7: If context is high AND task is moderate -> use sonnet
  const rule7 = Math.min(ctxHigh, taskModerate);

  // Defuzzification: weighted average
  let flashScore = rule1;
  let haikuScore = Math.max(rule2, rule3);
  let sonnetScore = Math.max(rule4, rule7);
  let opusScore = Math.max(rule5, rule6);

  // Adjust based on previous attempts (more attempts -> need smarter model)
  if (previousAttempts > 0) {
    opusScore += previousAttempts * 0.1;
    sonnetScore += previousAttempts * 0.05;
  }

  // Adjust based on confidence (low confidence -> need smarter model)
  if (confLow > 0.5) {
    opusScore += 0.2;
    sonnetScore += 0.1;
  }

  // Select model with highest score
  const scores = [
    { model: "flash" as const, score: flashScore },
    { model: "haiku" as const, score: haikuScore },
    { model: "sonnet" as const, score: sonnetScore },
    { model: "opus" as const, score: opusScore },
  ];

  scores.sort((a, b) => b.score - a.score);
  const selectedModel = scores[0].model;

  // Determine thinking level
  let thinkingLevel: ThinkLevel = "off";
  if (selectedModel === "opus" || selectedModel === "sonnet") {
    if (taskComplex > 0.7 || urgency > 0.7) {
      thinkingLevel = "high";
    } else if (taskModerate > 0.5) {
      thinkingLevel = "medium";
    } else {
      thinkingLevel = "low";
    }
  } else if (selectedModel === "haiku") {
    thinkingLevel = taskComplex > 0.5 ? "low" : "off";
  }

  // Determine tool depth
  let toolDepth: "full" | "summary" | "minimal" = "full";
  if (contextRemaining < 0.2) {
    toolDepth = "minimal";
  } else if (contextRemaining < 0.5) {
    toolDepth = "summary";
  }

  // Determine if should defer
  const shouldDefer = contextRemaining < 0.1 && urgency < 0.3 && previousAttempts === 0;

  // Tensor pattern bypass rules
  let usePatternBypass = false;
  if (patternRecallConfidence !== undefined) {
    const patHigh = getMembershipValue(PATTERN_CONFIDENCE, patternRecallConfidence, "high");
    const patMed = getMembershipValue(PATTERN_CONFIDENCE, patternRecallConfidence, "medium");

    // Rule T1: high pattern confidence + simple task -> bypass
    const ruleT1 = Math.min(patHigh, taskSimple);
    // Rule T2: high pattern confidence + moderate task + high urgency -> bypass
    const ruleT2 = Math.min(patHigh, taskModerate, urgHigh);
    // Rule T3: medium pattern confidence + simple task + low context -> bypass
    const ruleT3 = Math.min(patMed, taskSimple, ctxLow);

    usePatternBypass = Math.max(ruleT1, ruleT2, ruleT3) > 0.5;
  }

  return {
    model: selectedModel,
    thinkingLevel,
    toolDepth,
    shouldDefer,
    usePatternBypass,
  };
}
