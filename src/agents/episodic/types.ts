/**
 * Episodic Knowledge Graph Memory — Shared Types
 *
 * Structured episodes, knowledge entities, relationships,
 * and configuration for the episodic memory system.
 */

/** A structured record of an agent session or sub-task. */
export type Episode = {
  id: string;
  sessionId: string;
  summary: string;
  embedding: number[];
  fsmState: string;
  contextDepth: 0 | 1 | 2 | 3;
  goals: string[];
  toolsUsed: string[];
  outcome: "success" | "failure" | "partial";
  fitness: number;
  durationMs: number;
  tokenUsage: number;
  createdAt: number;
  genotypeId?: string;
  metadata?: Record<string, unknown>;
};

/** An entity node in the knowledge graph. */
export type KnowledgeEntity = {
  id: string;
  name: string;
  entityType: string;
  lastMentionedAt: number;
  mentionCount: number;
  metadata?: Record<string, unknown>;
};

/** A directed relationship edge between two entities. */
export type KnowledgeRelation = {
  id: string;
  fromEntityId: string;
  toEntityId: string;
  relationType: string;
  weight: number;
  episodeId?: string;
  createdAt: number;
};

/** Configuration for the episodic memory system. */
export type EpisodicMemoryConfig = {
  enabled: boolean;
  maxEpisodes: number;
  episodeTtlDays: number;
  maxEntities: number;
  graphDepth: number;
  stateWeighting: boolean;
  goalWeighting: boolean;
};

export const DEFAULT_EPISODIC_CONFIG: EpisodicMemoryConfig = {
  enabled: false,
  maxEpisodes: 5000,
  episodeTtlDays: 180,
  maxEntities: 10_000,
  graphDepth: 3,
  stateWeighting: true,
  goalWeighting: true,
};

/** Result of an episodic recall query. */
export type EpisodicRecallResult = {
  episode: Episode;
  relevance: number;
  rationale: string;
};
