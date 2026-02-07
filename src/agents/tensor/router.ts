/**
 * Tensor Router
 *
 * Routes between System 1 (cached pattern replay) and System 2 (LLM call)
 * by combining pattern recall confidence with fuzzy cognitive allocation.
 */

import type { EmbeddingProvider } from "../../memory/embeddings.js";
import type { TensorConfig, TensorRouteDecision } from "./types.js";
import { decideCognitiveAllocation, type CognitiveEconomyInputs } from "../fuzzy/inference.js";
import { log } from "./logger.js";
import { recallPattern } from "./pattern-recall.js";
import { PatternStore } from "./pattern-store.js";

export type TensorRouterParams = {
  store: PatternStore;
  embeddingProvider: EmbeddingProvider;
  config: TensorConfig;
};

/**
 * Stateless router that decides whether to use System 1 or System 2
 * for a given prompt.
 */
export class TensorRouter {
  private store: PatternStore;
  private embeddingProvider: EmbeddingProvider;
  private config: TensorConfig;

  constructor(params: TensorRouterParams) {
    this.store = params.store;
    this.embeddingProvider = params.embeddingProvider;
    this.config = params.config;
  }

  /**
   * Route a prompt to System 1 or System 2.
   *
   * @param prompt - The user prompt to route
   * @param fsmState - Current FSM state (optional)
   * @param contextRemaining - Fraction of context window remaining (0-1)
   * @param forceSystem2 - Force System 2 (e.g. --thinking high)
   */
  async route(params: {
    prompt: string;
    fsmState?: string;
    contextRemaining?: number;
    forceSystem2?: boolean;
  }): Promise<TensorRouteDecision> {
    const { prompt, contextRemaining = 1.0, forceSystem2 = false } = params;

    // Hard override: explicit System 2 request
    if (forceSystem2) {
      return {
        route: "system2",
        confidence: 0,
        rationale: "System 2 forced by user override",
      };
    }

    // Step 1: recall best pattern
    const recall = await recallPattern({
      store: this.store,
      embeddingProvider: this.embeddingProvider,
      prompt,
      config: this.config,
    });

    if (!recall.matched || !recall.shouldBypass) {
      return {
        route: "system2",
        pattern: recall.pattern,
        confidence: recall.confidence,
        rationale: recall.rationale,
      };
    }

    // Step 2: cross-check with fuzzy cognitive allocation
    const cogInputs: CognitiveEconomyInputs = {
      contextRemaining,
      taskComplexity: estimateComplexityFromPrompt(prompt),
      urgency: 0.5,
      previousAttempts: 0,
      confidence: recall.confidence,
    };
    const cogDecision = decideCognitiveAllocation(cogInputs);

    // If cognitive allocation says defer or use opus, prefer System 2
    if (cogDecision.shouldDefer) {
      return {
        route: "system2",
        pattern: recall.pattern,
        confidence: recall.confidence,
        rationale: "Fuzzy engine recommends deferral despite high pattern confidence",
      };
    }

    // System 1 bypass approved
    log.debug(
      `Tensor bypass approved: pattern=${recall.pattern?.id} confidence=${recall.confidence.toFixed(3)}`,
    );

    return {
      route: "system1",
      pattern: recall.pattern,
      confidence: recall.confidence,
      rationale: recall.rationale,
    };
  }
}

/** Quick complexity estimate from prompt length and structure. */
function estimateComplexityFromPrompt(prompt: string): number {
  const length = prompt.length;
  const hasCode = /```|function|class|import|export/.test(prompt);
  const hasMultiStep = /and|then|after|next|also/i.test(prompt);

  let complexity = 0;
  complexity += Math.min(0.3, length / 1000);
  if (hasCode) {
    complexity += 0.2;
  }
  if (hasMultiStep) {
    complexity += 0.2;
  }
  return Math.min(1, complexity);
}
