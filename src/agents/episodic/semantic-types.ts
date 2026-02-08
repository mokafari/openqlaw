/**
 * Semantic Memory Types
 *
 * Types for semantic fact extraction and storage.
 * Semantic facts are generalized knowledge extracted from episodes.
 */

/** A semantic fact extracted from episodes */
export type SemanticFact = {
  id: string;
  type:
    | "tool-behavior"
    | "pattern"
    | "constraint"
    | "strategy"
    | "lesson"
    | "api-usage"
    | "error-pattern";
  statement: string;
  confidence: number; // 0.0 - 1.0
  evidenceCount: number;
  evidenceEpisodeIds: string[];
  concept: string; // Primary concept this fact relates to
  subConcepts: string[]; // Secondary concepts
  embedding: number[];
  createdAt: number;
  lastUpdated: number;
  metadata?: Record<string, unknown>;
};

/** A concept cluster that groups related facts */
export type ConceptCluster = {
  id: string;
  name: string; // e.g. "read-tool", "error-handling", "optimization"
  factIds: string[];
  relationships: {
    relatedTo: string[]; // Other concept IDs
    causedBy: string[]; // What causes this concept
    enabledBy: string[]; // What enables this concept
    contradictedBy: string[]; // Concepts that contradict this
  };
  embedding: number[];
  createdAt: number;
  lastUpdated: number;
};

/** Configuration for semantic memory extraction */
export type SemanticConfig = {
  enabled: boolean;
  minConfidenceThreshold: number; // Don't store facts below this confidence
  minEvidenceCount: number; // Require at least N episodes to support a fact
  maxFacts: number; // Maximum facts to store
  factTtlDays: number; // Delete facts older than this
  extractionBatchSize: number; // How many episodes to process per extraction
  conceptSimilarityThreshold: number; // Merge concepts above this similarity
};

export const DEFAULT_SEMANTIC_CONFIG: SemanticConfig = {
  enabled: true,
  minConfidenceThreshold: 0.7,
  minEvidenceCount: 3,
  maxFacts: 10000,
  factTtlDays: 365,
  extractionBatchSize: 100,
  conceptSimilarityThreshold: 0.85,
};

/** Result of a semantic query */
export type SemanticQueryResult = {
  fact: SemanticFact;
  relevance: number;
  explanation: string;
};

/** Extraction result from episodes */
export type ExtractionResult = {
  facts: SemanticFact[];
  concepts: ConceptCluster[];
  stats: {
    episodesProcessed: number;
    factsExtracted: number;
    conceptsIdentified: number;
    avgConfidence: number;
  };
};

/** Pattern for fact extraction */
export type FactPattern = {
  name: string;
  description: string;
  matcher: (episodes: import("./types.js").Episode[]) => SemanticFact[];
  conceptExtractor: (fact: SemanticFact) => string[];
};
