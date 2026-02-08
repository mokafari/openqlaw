/**
 * Reflexion Module
 *
 * Implements the Reflexion pattern (Shinn & Labash 2023) for self-reflection
 * and iterative improvement from failures.
 *
 * Key concepts:
 * - Episode tracking with success/failure outcomes
 * - Heuristic evaluation for trajectory quality
 * - Reflection generation for failed attempts
 * - Lesson extraction for future improvement
 *
 * Research basis:
 * - Reflexion: Language Agents with Verbal Reinforcement Learning
 * - Chain of Hindsight (CoH): Learning from feedback sequences
 */

import fs from "node:fs/promises";
import path from "node:path";
import { log } from "../pi-embedded-runner/logger.js";

export type EpisodeOutcome = "success" | "failure" | "partial" | "aborted";

export interface ReflexionEpisode {
  id: string;
  timestamp: string;
  sessionKey?: string;
  task: string;
  trajectory: TrajectoryStep[];
  outcome: EpisodeOutcome;
  heuristic: number; // 0.0 - 1.0 performance score
  duration: number; // milliseconds
  toolsUsed: string[];
  reflection?: ReflexionEntry;
}

export interface TrajectoryStep {
  action: string;
  tool?: string;
  thought?: string;
  observation?: string;
  timestamp: string;
  success: boolean;
}

export interface ReflexionEntry {
  whatWentWrong?: string;
  whatWentRight?: string;
  rootCause?: string;
  lessonsLearned: string[];
  improvedStrategy?: string;
  avoidInFuture?: string[];
  repeatInFuture?: string[];
}

export interface HindsightEntry {
  id: string;
  timestamp: string;
  originalPrompt: string;
  failedResponse: string;
  correctResponse?: string;
  feedback: string;
  category: HindsightCategory;
}

export type HindsightCategory =
  | "tool-misuse"
  | "wrong-approach"
  | "incomplete-solution"
  | "misunderstood-task"
  | "hallucination"
  | "edge-case"
  | "efficiency"
  | "other";

/**
 * Heuristics for detecting inefficient or problematic trajectories
 */
const TRAJECTORY_HEURISTICS = {
  // Detect repeated identical actions (hallucination signal)
  repeatedActions: (steps: TrajectoryStep[]): number => {
    if (steps.length < 3) return 1.0;
    let repeats = 0;
    for (let i = 1; i < steps.length; i++) {
      if (steps[i].action === steps[i - 1].action && steps[i].tool === steps[i - 1].tool) {
        repeats++;
      }
    }
    return Math.max(0, 1 - repeats * 0.2);
  },

  // Detect excessive tool calls without progress
  toolEfficiency: (steps: TrajectoryStep[]): number => {
    if (steps.length === 0) return 1.0;
    const successfulSteps = steps.filter((s) => s.success).length;
    return successfulSteps / steps.length;
  },

  // Detect trajectory length (too long = inefficient)
  lengthPenalty: (steps: TrajectoryStep[], expectedMax: number = 20): number => {
    if (steps.length <= expectedMax) return 1.0;
    return Math.max(0, 1 - (steps.length - expectedMax) * 0.05);
  },

  // Detect time efficiency
  timePenalty: (durationMs: number, expectedMaxMs: number = 60000): number => {
    if (durationMs <= expectedMaxMs) return 1.0;
    return Math.max(0, 1 - (durationMs - expectedMaxMs) / expectedMaxMs);
  },
};

export class ReflexionSystem {
  private episodeLogPath: string;
  private hindsightLogPath: string;
  private workingMemory: ReflexionEpisode[] = [];
  private maxWorkingMemory: number = 3;

  constructor(workspacePath: string = process.env.WORKSPACE_ROOT || process.cwd()) {
    this.episodeLogPath = path.join(workspacePath, "memory", "reflexion-episodes.jsonl");
    this.hindsightLogPath = path.join(workspacePath, "memory", "hindsight-log.jsonl");
  }

  /**
   * Calculate heuristic score for a trajectory
   */
  calculateHeuristic(steps: TrajectoryStep[], durationMs: number): number {
    const scores = [
      TRAJECTORY_HEURISTICS.repeatedActions(steps),
      TRAJECTORY_HEURISTICS.toolEfficiency(steps),
      TRAJECTORY_HEURISTICS.lengthPenalty(steps),
      TRAJECTORY_HEURISTICS.timePenalty(durationMs),
    ];
    return scores.reduce((a, b) => a + b, 0) / scores.length;
  }

  /**
   * Determine if trajectory should be flagged for reflection
   */
  shouldReflect(episode: ReflexionEpisode): boolean {
    // Always reflect on failures
    if (episode.outcome === "failure") return true;

    // Reflect on low heuristic scores
    if (episode.heuristic < 0.6) return true;

    // Reflect on aborted episodes
    if (episode.outcome === "aborted") return true;

    // Reflect on partial success with low score
    if (episode.outcome === "partial" && episode.heuristic < 0.75) return true;

    return false;
  }

  /**
   * Generate reflection prompt for failed episode
   */
  generateReflectionPrompt(episode: ReflexionEpisode): string {
    const trajectoryDesc = episode.trajectory
      .map(
        (s, i) =>
          `${i + 1}. [${s.tool || "thought"}] ${s.action.slice(0, 100)}... → ${s.success ? "✓" : "✗"}`,
      )
      .join("\n");

    return `## Reflection Required

**Task:** ${episode.task}

**Outcome:** ${episode.outcome} (heuristic: ${(episode.heuristic * 100).toFixed(1)}%)

**Trajectory:**
${trajectoryDesc}

**Questions to answer:**
1. What went wrong in this attempt?
2. What was the root cause of the failure?
3. What should I do differently next time?
4. What patterns should I avoid?
5. What patterns should I repeat?

Please provide a structured reflection.`;
  }

  /**
   * Log an episode with optional reflection
   */
  async logEpisode(episode: ReflexionEpisode): Promise<void> {
    try {
      await fs.mkdir(path.dirname(this.episodeLogPath), { recursive: true });
      await fs.appendFile(this.episodeLogPath, JSON.stringify(episode) + "\n");

      // Add to working memory if needs reflection
      if (this.shouldReflect(episode)) {
        this.workingMemory.push(episode);
        if (this.workingMemory.length > this.maxWorkingMemory) {
          this.workingMemory.shift();
        }
        log.info(
          `[reflexion] Episode ${episode.id} flagged for reflection (${episode.outcome}, h=${episode.heuristic.toFixed(2)})`,
        );
      }
    } catch (error) {
      log.error(`[reflexion] Failed to log episode: ${error}`);
    }
  }

  /**
   * Log a hindsight entry for learning from failures
   */
  async logHindsight(entry: Omit<HindsightEntry, "id" | "timestamp">): Promise<void> {
    const fullEntry: HindsightEntry = {
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      ...entry,
    };

    try {
      await fs.mkdir(path.dirname(this.hindsightLogPath), { recursive: true });
      await fs.appendFile(this.hindsightLogPath, JSON.stringify(fullEntry) + "\n");
      log.info(`[hindsight] Logged ${entry.category}: ${entry.feedback.slice(0, 50)}...`);
    } catch (error) {
      log.error(`[hindsight] Failed to log: ${error}`);
    }
  }

  /**
   * Get episodes that need reflection from working memory
   */
  getEpisodesNeedingReflection(): ReflexionEpisode[] {
    return this.workingMemory.filter((e) => !e.reflection);
  }

  /**
   * Add reflection to an episode
   */
  async addReflection(episodeId: string, reflection: ReflexionEntry): Promise<boolean> {
    const episode = this.workingMemory.find((e) => e.id === episodeId);
    if (!episode) return false;

    episode.reflection = reflection;

    // Re-save the episode with reflection
    try {
      // Read all episodes, update the matching one
      const content = await fs.readFile(this.episodeLogPath, "utf-8");
      const lines = content.trim().split("\n");
      const updated = lines.map((line) => {
        const ep = JSON.parse(line) as ReflexionEpisode;
        if (ep.id === episodeId) {
          ep.reflection = reflection;
        }
        return JSON.stringify(ep);
      });
      await fs.writeFile(this.episodeLogPath, updated.join("\n") + "\n");
      return true;
    } catch (error) {
      log.error(`[reflexion] Failed to add reflection: ${error}`);
      return false;
    }
  }

  /**
   * Get recent episodes for pattern analysis
   */
  async getRecentEpisodes(limit: number = 50): Promise<ReflexionEpisode[]> {
    try {
      const content = await fs.readFile(this.episodeLogPath, "utf-8");
      const lines = content.trim().split("\n").filter(Boolean);
      return lines.slice(-limit).map((l) => JSON.parse(l) as ReflexionEpisode);
    } catch {
      return [];
    }
  }

  /**
   * Get hindsight entries for few-shot learning
   */
  async getHindsightExamples(
    category?: HindsightCategory,
    limit: number = 5,
  ): Promise<HindsightEntry[]> {
    try {
      const content = await fs.readFile(this.hindsightLogPath, "utf-8");
      const entries = content
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((l) => JSON.parse(l) as HindsightEntry);

      const filtered = category ? entries.filter((e) => e.category === category) : entries;

      return filtered.slice(-limit);
    } catch {
      return [];
    }
  }

  /**
   * Analyze failure patterns across episodes
   */
  async analyzeFailurePatterns(): Promise<{
    totalEpisodes: number;
    failureRate: number;
    averageHeuristic: number;
    commonFailures: Array<{ pattern: string; count: number }>;
    toolFailureRates: Record<string, number>;
    lessonsExtracted: string[];
  }> {
    const episodes = await this.getRecentEpisodes(100);
    if (episodes.length === 0) {
      return {
        totalEpisodes: 0,
        failureRate: 0,
        averageHeuristic: 0,
        commonFailures: [],
        toolFailureRates: {},
        lessonsExtracted: [],
      };
    }

    const failures = episodes.filter((e) => e.outcome === "failure" || e.outcome === "aborted");
    const failureRate = failures.length / episodes.length;
    const averageHeuristic = episodes.reduce((a, e) => a + e.heuristic, 0) / episodes.length;

    // Count tool failures
    const toolFailures: Record<string, { failures: number; total: number }> = {};
    for (const ep of episodes) {
      for (const tool of ep.toolsUsed) {
        if (!toolFailures[tool]) {
          toolFailures[tool] = { failures: 0, total: 0 };
        }
        toolFailures[tool].total++;
        if (ep.outcome === "failure") {
          toolFailures[tool].failures++;
        }
      }
    }

    const toolFailureRates: Record<string, number> = {};
    for (const [tool, stats] of Object.entries(toolFailures)) {
      toolFailureRates[tool] = stats.failures / stats.total;
    }

    // Extract lessons from reflections
    const lessonsExtracted = episodes
      .filter((e) => e.reflection?.lessonsLearned)
      .flatMap((e) => e.reflection!.lessonsLearned)
      .slice(-20);

    // TODO: Pattern detection for common failures
    const commonFailures: Array<{ pattern: string; count: number }> = [];

    return {
      totalEpisodes: episodes.length,
      failureRate,
      averageHeuristic,
      commonFailures,
      toolFailureRates,
      lessonsExtracted,
    };
  }

  /**
   * Generate improvement suggestions based on failure analysis
   */
  async generateImprovementSuggestions(): Promise<string[]> {
    const analysis = await this.analyzeFailurePatterns();
    const suggestions: string[] = [];

    if (analysis.failureRate > 0.1) {
      suggestions.push(
        `High failure rate (${(analysis.failureRate * 100).toFixed(1)}%) - consider reviewing common failure patterns`,
      );
    }

    if (analysis.averageHeuristic < 0.7) {
      suggestions.push(
        `Low average heuristic (${(analysis.averageHeuristic * 100).toFixed(1)}%) - trajectories are inefficient`,
      );
    }

    // Flag tools with high failure rates
    for (const [tool, rate] of Object.entries(analysis.toolFailureRates)) {
      if (rate > 0.3) {
        suggestions.push(
          `Tool "${tool}" has ${(rate * 100).toFixed(1)}% failure rate - review usage`,
        );
      }
    }

    // Include recent lessons
    if (analysis.lessonsExtracted.length > 0) {
      suggestions.push(
        `Recent lessons to remember: ${analysis.lessonsExtracted.slice(-3).join("; ")}`,
      );
    }

    return suggestions;
  }
}

// Singleton instance
let reflexionInstance: ReflexionSystem | null = null;

export function getReflexionSystem(workspacePath?: string): ReflexionSystem {
  if (!reflexionInstance || workspacePath) {
    reflexionInstance = new ReflexionSystem(workspacePath);
  }
  return reflexionInstance;
}
