/**
 * Tensor Intuition Layer — shared types
 *
 * Defines action patterns, recall results, and configuration
 * for the System 1 fast-path pattern recall engine.
 */

/** Serialised tool call stored inside an action pattern. */
export type SerializedToolCall = {
  name: string;
  params: Record<string, unknown>;
};

/** A recorded {context → action → outcome} tuple. */
export type ActionPattern = {
  id: string;
  contextEmbedding: number[];
  contextText: string;
  actionSummary: string;
  actionToolCalls: SerializedToolCall[];
  outcome: {
    success: boolean;
    durationMs: number;
    tokensSaved?: number;
  };
  fitness: number;
  usageCount: number;
  lastUsedAt: number;
  createdAt: number;
  fsmState?: string;
  genotypeId?: string;
};

/** Configuration for the tensor pattern store + recall engine. */
export type TensorConfig = {
  enabled: boolean;
  bypassThreshold: number;
  maxPatterns: number;
  patternTtlDays: number;
  minFitnessForRecall: number;
};

/** Default tensor configuration values. */
export const DEFAULT_TENSOR_CONFIG: TensorConfig = {
  enabled: false,
  bypassThreshold: 0.85,
  maxPatterns: 10_000,
  patternTtlDays: 90,
  minFitnessForRecall: 0.7,
};

/** Result returned by pattern recall. */
export type PatternRecallResult = {
  matched: boolean;
  pattern?: ActionPattern;
  similarity: number;
  confidence: number;
  shouldBypass: boolean;
  rationale: string;
};

/** Routing decision from the tensor router. */
export type TensorRouteDecision = {
  route: "system1" | "system2";
  pattern?: ActionPattern;
  confidence: number;
  rationale: string;
};

/** Loop phase for the neuro-symbolic controller. */
export type LoopPhase = "plan" | "execute" | "critique" | "learn";

/** Result of a single neuro-symbolic loop iteration. */
export type LoopIterationResult = {
  phase: LoopPhase;
  success: boolean;
  patternRecorded: boolean;
  fitness: number;
  error?: string;
};
