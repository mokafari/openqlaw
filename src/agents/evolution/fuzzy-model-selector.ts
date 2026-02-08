import type { OpenClawConfig } from "../../config/config.js";
import type { AgentGenotype } from "./genotype.js";
import { loadGenotype, loadGenotypeSync } from "./genotype.js";

export interface ModelSelectionInput {
  taskComplexity: number; // 0.0 to 1.0
  remainingContextPct: number; // 0.0 to 1.0
  userUrgency: number; // 0.0 to 1.0
}

export interface FuzzyModelResult {
  modelId: string;
  provider: string;
  rationale: string;
}

/**
 * FuzzyModelSelector: Adapts Quake III Bot's weapon selection logic
 * to modern LLM model selection.
 */
export class FuzzyModelSelector {
  private readonly config: OpenClawConfig;

  constructor(config: OpenClawConfig) {
    this.config = config;
  }

  /**
   * Select the best model using fuzzy logic weighted by the agent's genotype (synchronous).
   */
  selectModelSync(input: ModelSelectionInput): FuzzyModelResult {
    const genotype = this.getCurrentGenotypeSync();
    const threshold = genotype.fuzzyWeights.taskComplexityThreshold;

    // Quake III Logic: Preferences * Effectiveness
    // Heavy models (Opus) are the "BFG10K" - high effectiveness, high cost.
    // Light models (Haiku/Flash) are the "Machine Gun" - low cost, reliable.

    if (input.taskComplexity > threshold && input.remainingContextPct > 0.2) {
      return {
        modelId: "claude-opus-4-5",
        provider: "anthropic",
        rationale: `Complexity (${input.taskComplexity.toFixed(2)}) above threshold (${threshold.toFixed(2)}) with healthy context budget.`,
      };
    }

    if (input.remainingContextPct < 0.1) {
      return {
        modelId: "claude-haiku-4-5",
        provider: "anthropic",
        rationale: "Context window critical (< 10%). Switching to high-efficiency model.",
      };
    }

    // Even with high urgency, prefer Opus for quality (user preference)
    // Only use Haiku for critical context situations
    if (input.userUrgency > 0.8 && input.remainingContextPct < 0.15) {
      return {
        modelId: "claude-haiku-4-5",
        provider: "anthropic",
        rationale: "High urgency + critical context. Using efficient model.",
      };
    }

    // Default to Opus for most tasks (user preference: quality over cost)
    return {
      modelId: "claude-opus-4-5",
      provider: "anthropic",
      rationale: "Default to Opus for quality (user preference).",
    };
  }

  /**
   * Select the best model using fuzzy logic weighted by the agent's genotype.
   */
  async selectModel(input: ModelSelectionInput): Promise<FuzzyModelResult> {
    const genotype = await this.getCurrentGenotype();
    const threshold = genotype.fuzzyWeights.taskComplexityThreshold;

    // Quake III Logic: Preferences * Effectiveness
    // Heavy models (Opus) are the "BFG10K" - high effectiveness, high cost.
    // Light models (Haiku/Flash) are the "Machine Gun" - low cost, reliable.

    if (input.taskComplexity > threshold && input.remainingContextPct > 0.2) {
      return {
        modelId: "claude-opus-4-5",
        provider: "anthropic",
        rationale: `Complexity (${input.taskComplexity.toFixed(2)}) above threshold (${threshold.toFixed(2)}) with healthy context budget.`,
      };
    }

    if (input.remainingContextPct < 0.1) {
      return {
        modelId: "claude-haiku-4-5",
        provider: "anthropic",
        rationale: "Context window critical (< 10%). Switching to high-efficiency model.",
      };
    }

    // Even with high urgency, prefer Opus for quality (user preference)
    // Only use Haiku for critical context situations
    if (input.userUrgency > 0.8 && input.remainingContextPct < 0.15) {
      return {
        modelId: "claude-haiku-4-5",
        provider: "anthropic",
        rationale: "High urgency + critical context. Using efficient model.",
      };
    }

    // Default to Opus for most tasks (user preference: quality over cost)
    return {
      modelId: "claude-opus-4-5",
      provider: "anthropic",
      rationale: "Default to Opus for quality (user preference).",
    };
  }

  private getCurrentGenotypeSync(): AgentGenotype {
    return loadGenotypeSync();
  }

  private async getCurrentGenotype(): Promise<AgentGenotype> {
    try {
      return await loadGenotype();
    } catch {
      // Fallback if evolution system not initialized
      return {
        generation: 1,
        genotypeId: "default",
        traits: {
          verbosity: 0.5,
          planningDepth: "medium",
          toolEagerness: 0.7,
          chainOfThought: 0.5,
        },
        systemPrompt: { tone: "balanced", emphasizeTools: true, emphasizePlanning: false },
        fuzzyWeights: { taskComplexityThreshold: 0.5, toolPreferences: {} },
        createdAt: Date.now(),
      };
    }
  }
}
