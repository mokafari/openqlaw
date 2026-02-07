/**
 * Neuro-Symbolic Loop Controller
 *
 * Orchestrates the Planner → Executor → Critic → Learning cycle
 * using existing FSM states, GoalStack, fitness calculation,
 * recovery engine, and meta-learning system.
 *
 * This controller does NOT replace the existing LLM run loop.
 * It wraps around it, providing lifecycle hooks that drive
 * FSM transitions and pattern recording.
 */

import type { EmbeddingProvider } from "../../memory/embeddings.js";
import type { FSMStateManager } from "../fsm/state-manager.js";
import type { GoalStack } from "../goals/stack.js";
import type { TensorConfig, LoopIterationResult } from "./types.js";
import { MetaLearningSystem } from "../evolution/meta-learning.js";
import { RecoveryEngine, type RecoveryDecision } from "../evolution/recovery-engine.js";
import { calculateFitness, type SessionStats } from "../evolution/telemetry.js";
import { log } from "./logger.js";
import { recordPattern, type RecordPatternParams } from "./pattern-recorder.js";
import { PatternStore } from "./pattern-store.js";

export type LoopControllerParams = {
  fsmManager: FSMStateManager;
  goalStack: GoalStack;
  patternStore: PatternStore;
  embeddingProvider: EmbeddingProvider;
  config: TensorConfig;
  /** Optional episodic stores for cross-feed recording. */
  episodeStore?: import("../episodic/episode-store.js").EpisodeStore;
  knowledgeGraph?: import("../episodic/knowledge-graph.js").KnowledgeGraph;
};

/**
 * Drives the neuro-symbolic loop around the existing embedded runner.
 *
 * Usage:
 *   const loop = new NeuroSymbolicLoopController({ ... });
 *   await loop.onPlanStart(prompt);
 *   // ... LLM call happens ...
 *   await loop.onExecuteComplete(result);
 *   loop.onCritique(stats);
 *   await loop.onLearn(runParams);
 */
export class NeuroSymbolicLoopController {
  private fsmManager: FSMStateManager;
  private goalStack: GoalStack;
  private patternStore: PatternStore;
  private embeddingProvider: EmbeddingProvider;
  private config: TensorConfig;
  private recoveryEngine: RecoveryEngine;
  private metaLearning: MetaLearningSystem;
  private episodeStore?: import("../episodic/episode-store.js").EpisodeStore;
  private knowledgeGraph?: import("../episodic/knowledge-graph.js").KnowledgeGraph;

  constructor(params: LoopControllerParams) {
    this.fsmManager = params.fsmManager;
    this.goalStack = params.goalStack;
    this.patternStore = params.patternStore;
    this.embeddingProvider = params.embeddingProvider;
    this.config = params.config;
    this.recoveryEngine = new RecoveryEngine();
    this.metaLearning = new MetaLearningSystem();
    this.episodeStore = params.episodeStore;
    this.knowledgeGraph = params.knowledgeGraph;
  }

  // --- Phase 1: PLAN ---

  /** Transition FSM to planning and push a goal for this prompt. */
  async onPlanStart(prompt: string): Promise<void> {
    await this.fsmManager.transitionTo("planning", { tensorPhase: "plan" });

    // Push a goal for this prompt
    const summary = prompt.slice(0, 100) + (prompt.length > 100 ? "..." : "");
    this.goalStack.push({
      type: "task",
      description: summary,
    });

    log.debug("Loop phase: PLAN");
  }

  // --- Phase 2: EXECUTE ---

  /** Transition FSM to executing. Called just before LLM call or pattern replay. */
  async onExecuteStart(): Promise<void> {
    await this.fsmManager.transitionTo("executing", { tensorPhase: "execute" });
    log.debug("Loop phase: EXECUTE");
  }

  /** Mark the executing phase as complete. */
  async onExecuteComplete(success: boolean): Promise<void> {
    if (success) {
      await this.fsmManager.transitionTo("verifying", { tensorPhase: "critique" });
    } else {
      await this.fsmManager.transitionTo("retreating", { tensorPhase: "retreat" });
    }
  }

  // --- Phase 3: CRITIQUE ---

  /**
   * Evaluate the run result and calculate fitness.
   * Returns recovery decision if the run failed.
   */
  onCritique(stats: SessionStats): { fitness: number; recovery?: RecoveryDecision } {
    const fitness = calculateFitness(stats);
    log.debug(`Loop phase: CRITIQUE (fitness=${fitness.toFixed(3)})`);

    let recovery: RecoveryDecision | undefined;
    if (!stats.success && stats.error) {
      recovery = this.recoveryEngine.shouldAttemptRecovery({
        file: "unknown",
        line: 0,
        column: 0,
        message: stats.error,
        code: "RUNTIME_ERROR",
        context: stats.error,
      });
    }

    // Complete the active goal
    const activeGoal = this.goalStack.peek();
    if (activeGoal) {
      if (stats.success) {
        this.goalStack.complete(activeGoal.id);
      } else {
        this.goalStack.fail(activeGoal.id);
      }
    }

    return { fitness, recovery };
  }

  // --- Phase 4: LEARN ---

  /**
   * Record a successful pattern and log meta-learning outcome.
   * Transitions FSM to reporting.
   */
  async onLearn(runParams: RecordPatternParams): Promise<LoopIterationResult> {
    log.debug("Loop phase: LEARN");

    let patternRecorded = false;

    // Record pattern on success
    if (runParams.success) {
      try {
        const pattern = await recordPattern({
          store: this.patternStore,
          embeddingProvider: this.embeddingProvider,
          runParams,
          config: this.config,
        });
        patternRecorded = pattern !== null;
      } catch (err) {
        log.debug(`Pattern recording failed in loop: ${err}`);
      }
    }

    // Cross-feed: episode recording alongside pattern recording
    if (this.episodeStore && this.knowledgeGraph) {
      try {
        const { recordEpisode } = await import("../episodic/episode-recorder.js");
        const { DEFAULT_EPISODIC_CONFIG } = await import("../episodic/types.js");
        await recordEpisode({
          store: this.episodeStore,
          graph: this.knowledgeGraph,
          embeddingProvider: this.embeddingProvider,
          config: DEFAULT_EPISODIC_CONFIG,
          sessionId: `loop-${Date.now()}`,
          prompt: runParams.prompt,
          toolMetas: runParams.toolMetas,
          success: runParams.success,
          aborted: false,
          durationMs: runParams.durationMs,
          tokenUsage: runParams.tokenUsage.total,
          fsmState: runParams.fsmState ?? this.fsmManager.getState(),
          contextDepth: 0,
          activeGoals: this.goalStack.getAll().map((g) => g.description),
          fitness: calculateFitness({
            sessionId: `loop-${Date.now()}`,
            timestamp: Date.now(),
            success: runParams.success,
            aborted: false,
            tokenUsage: runParams.tokenUsage,
            toolCalls: runParams.toolCallCount,
            durationMs: runParams.durationMs,
            model: "unknown",
            provider: "unknown",
          }),
          genotypeId: runParams.genotypeId,
        });
      } catch (err) {
        log.debug(
          `Episodic cross-feed failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    // Log meta-learning outcome
    try {
      const taskId = `loop-${Date.now()}`;
      await this.metaLearning.logOutcome({
        taskId,
        actualSuccess: runParams.success,
        actualDurationMs: runParams.durationMs,
        timestamp: Date.now(),
      });
    } catch (err) {
      log.debug(`Meta-learning log failed: ${err}`);
    }

    // Calculate final fitness
    const sessionStats: SessionStats = {
      sessionId: `loop-${Date.now()}`,
      timestamp: Date.now(),
      success: runParams.success,
      aborted: false,
      tokenUsage: runParams.tokenUsage,
      toolCalls: runParams.toolCallCount,
      durationMs: runParams.durationMs,
      model: "unknown",
      provider: "unknown",
    };
    const fitness = calculateFitness(sessionStats);

    // Transition FSM to terminal state
    if (runParams.success) {
      await this.fsmManager.transitionTo("reporting", { tensorPhase: "learn-complete" });
    }
    // On failure the FSM is already in "retreating" from onExecuteComplete

    // Prune expired patterns periodically (~1% chance per run)
    if (Math.random() < 0.01) {
      try {
        const pruned = this.patternStore.pruneExpired();
        if (pruned > 0) {
          log.debug(`Pruned ${pruned} expired patterns`);
        }
      } catch {
        // Non-fatal
      }
    }

    return {
      phase: "learn",
      success: runParams.success,
      patternRecorded,
      fitness,
    };
  }

  /** Wire episodic stores for cross-feed recording (called after deferred init). */
  setEpisodicStores(
    store: import("../episodic/episode-store.js").EpisodeStore,
    graph: import("../episodic/knowledge-graph.js").KnowledgeGraph,
  ): void {
    this.episodeStore = store;
    this.knowledgeGraph = graph;
  }

  /** Get the current FSM state. */
  getState(): string {
    return this.fsmManager.getState();
  }
}
