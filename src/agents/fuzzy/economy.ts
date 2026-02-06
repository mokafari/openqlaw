/**
 * Cognitive Economy Manager
 *
 * Manages token budgets and dynamic model switching based on fuzzy logic.
 */

import type { ThinkLevel } from "../../auto-reply/thinking.js";
import type { CognitiveEconomyDecision, CognitiveEconomyInputs } from "./inference.js";
import { decideCognitiveAllocation, estimateTaskComplexity } from "./inference.js";

export type TokenBudget = {
  total: number;
  used: number;
  reserved: number; // Reserved for system prompt, tools, etc.
  available: number; // Available for user content
};

export class CognitiveEconomyManager {
  private tokenBudget: TokenBudget;
  private currentDecision: CognitiveEconomyDecision | null = null;
  private decisionHistory: Array<{ decision: CognitiveEconomyDecision; timestamp: number }> = [];

  constructor(totalTokens: number, reservedTokens: number = 0) {
    this.tokenBudget = {
      total: totalTokens,
      used: 0,
      reserved: reservedTokens,
      available: totalTokens - reservedTokens,
    };
  }

  /**
   * Update token usage
   */
  updateUsage(used: number): void {
    this.tokenBudget.used = used;
    this.tokenBudget.available = this.tokenBudget.total - this.tokenBudget.reserved - used;
  }

  /**
   * Get current token budget status
   */
  getBudget(): Readonly<TokenBudget> {
    return { ...this.tokenBudget };
  }

  /**
   * Get context remaining as a percentage (0-1)
   */
  getContextRemaining(): number {
    if (this.tokenBudget.available <= 0) {
      return 0;
    }
    return Math.max(
      0,
      Math.min(
        1,
        this.tokenBudget.available / (this.tokenBudget.total - this.tokenBudget.reserved),
      ),
    );
  }

  /**
   * Make a cognitive economy decision
   */
  decide(inputs: Omit<CognitiveEconomyInputs, "contextRemaining">): CognitiveEconomyDecision {
    const contextRemaining = this.getContextRemaining();
    const fullInputs: CognitiveEconomyInputs = {
      ...inputs,
      contextRemaining,
    };

    const decision = decideCognitiveAllocation(fullInputs);
    this.currentDecision = decision;
    this.decisionHistory.push({
      decision,
      timestamp: Date.now(),
    });

    // Keep only last 100 decisions
    if (this.decisionHistory.length > 100) {
      this.decisionHistory = this.decisionHistory.slice(-100);
    }

    return decision;
  }

  /**
   * Get current decision
   */
  getCurrentDecision(): CognitiveEconomyDecision | null {
    return this.currentDecision;
  }

  /**
   * Get decision history
   */
  getDecisionHistory(): ReadonlyArray<{ decision: CognitiveEconomyDecision; timestamp: number }> {
    return this.decisionHistory;
  }

  /**
   * Estimate task complexity from message
   */
  estimateComplexity(message: string, toolCount: number): number {
    return estimateTaskComplexity(message, toolCount);
  }

  /**
   * Check if we should switch to a lighter model
   */
  shouldDowngradeModel(): boolean {
    const contextRemaining = this.getContextRemaining();
    return contextRemaining < 0.2 && this.currentDecision?.model !== "flash";
  }

  /**
   * Check if we should upgrade to a heavier model
   */
  shouldUpgradeModel(complexity: number, previousFailures: number): boolean {
    const contextRemaining = this.getContextRemaining();
    if (contextRemaining < 0.3) {
      return false; // Not enough context for upgrade
    }

    return (
      (complexity > 0.7 && this.currentDecision?.model !== "opus") ||
      (previousFailures > 2 && this.currentDecision?.model !== "opus")
    );
  }
}

// Export convenience function
export { estimateTaskComplexity };
