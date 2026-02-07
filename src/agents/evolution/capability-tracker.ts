import { promises as fs } from "node:fs";
import { join } from "node:path";
import { resolveStateDir } from "../../config/paths.js";
import { log } from "../pi-embedded-runner/logger.js";
import { loadGenotype } from "./genotype.js";
import { getAggregatedStats, readSessionStats } from "./telemetry.js";

export type CapabilityMetric = {
  timestamp: number;
  generation: number;
  genotypeId: string;
  fitness: number;
  successRate: number;
  avgTokens: number;
  avgToolCalls: number;
  toolErrorRate: number;
  capabilities: string[]; // List of tools/capabilities that were used successfully
};

export type CapabilityGrowthReport = {
  baseline: CapabilityMetric;
  current: CapabilityMetric;
  growth: {
    fitnessChange: number;
    fitnessChangePercent: number;
    successRateChange: number;
    tokenEfficiencyChange: number;
    toolErrorRateChange: number;
    newCapabilities: string[];
    lostCapabilities: string[];
  };
  timeline: CapabilityMetric[];
};

/**
 * CapabilityTracker: Tracks agent capability growth over time.
 *
 * Measures:
 * - Fitness improvements
 * - Success rate changes
 * - Token efficiency
 * - Tool error rate reduction
 * - New capabilities (tools used successfully)
 * - Lost capabilities (tools that stopped working)
 */
export class CapabilityTracker {
  private readonly statsDir?: string;
  private readonly metricsFile: string;

  constructor(params?: { statsDir?: string }) {
    this.statsDir = params?.statsDir;
    const stateDir = resolveStateDir();
    this.metricsFile = join(stateDir, "evolution", "capability-metrics.jsonl");
  }

  /**
   * Record current capability metrics.
   */
  async recordMetrics(): Promise<CapabilityMetric> {
    try {
      const genotype = await loadGenotype();
      const stats = await getAggregatedStats({
        genotypeId: genotype.genotypeId,
        statsDir: this.statsDir,
      });

      // Extract capabilities from recent successful sessions
      const recentStats = await readSessionStats({
        limit: 100,
        statsDir: this.statsDir,
      });
      const successfulSessions = recentStats.filter((s) => s.success);

      // Extract unique tools used in successful sessions
      const capabilities = new Set<string>();
      for (const session of successfulSessions) {
        // Tools are not directly in stats, but we can infer from toolCalls > 0
        // For now, we'll track based on success patterns
        if (session.toolCalls > 0 && session.success) {
          capabilities.add("tool-usage"); // Generic capability
        }
      }

      const metric: CapabilityMetric = {
        timestamp: Date.now(),
        generation: genotype.generation,
        genotypeId: genotype.genotypeId,
        fitness: stats.avgFitness,
        successRate: stats.successRate,
        avgTokens: stats.avgTokens,
        avgToolCalls: stats.avgToolCalls,
        toolErrorRate: 1 - stats.successRate, // Approximate from success rate
        capabilities: Array.from(capabilities),
      };

      // Append to metrics file
      await fs.mkdir(join(resolveStateDir(), "evolution"), { recursive: true });
      await fs.appendFile(this.metricsFile, JSON.stringify(metric) + "\n", "utf-8");

      log.debug(`[capability-tracker] Recorded metrics for generation ${genotype.generation}`);
      return metric;
    } catch (err) {
      log.error(`[capability-tracker] Failed to record metrics: ${err}`);
      throw err;
    }
  }

  /**
   * Generate capability growth report.
   */
  async generateReport(params?: {
    baselineGeneration?: number;
    currentGeneration?: number;
  }): Promise<CapabilityGrowthReport> {
    try {
      // Load all metrics
      const metrics = await this.loadMetrics();

      if (metrics.length === 0) {
        throw new Error("No metrics recorded yet");
      }

      // Find baseline (first or specified generation)
      let baseline: CapabilityMetric;
      if (params?.baselineGeneration !== undefined) {
        baseline = metrics.find((m) => m.generation === params.baselineGeneration) ?? metrics[0];
      } else {
        baseline = metrics[0];
      }

      // Find current (latest or specified generation)
      let current: CapabilityMetric;
      if (params?.currentGeneration !== undefined) {
        current =
          metrics.find((m) => m.generation === params.currentGeneration) ??
          metrics[metrics.length - 1];
      } else {
        current = metrics[metrics.length - 1];
      }

      // Calculate growth
      const fitnessChange = current.fitness - baseline.fitness;
      const fitnessChangePercent =
        baseline.fitness > 0 ? (fitnessChange / baseline.fitness) * 100 : 0;
      const successRateChange = current.successRate - baseline.successRate;
      const tokenEfficiencyChange =
        baseline.avgTokens > 0
          ? ((baseline.avgTokens - current.avgTokens) / baseline.avgTokens) * 100
          : 0; // Positive = more efficient (fewer tokens)
      const toolErrorRateChange = baseline.toolErrorRate - current.toolErrorRate; // Positive = fewer errors

      const baselineCapabilities = new Set(baseline.capabilities);
      const currentCapabilities = new Set(current.capabilities);
      const newCapabilities = Array.from(currentCapabilities).filter(
        (c) => !baselineCapabilities.has(c),
      );
      const lostCapabilities = Array.from(baselineCapabilities).filter(
        (c) => !currentCapabilities.has(c),
      );

      return {
        baseline,
        current,
        growth: {
          fitnessChange,
          fitnessChangePercent,
          successRateChange,
          tokenEfficiencyChange,
          toolErrorRateChange,
          newCapabilities,
          lostCapabilities,
        },
        timeline: metrics,
      };
    } catch (err) {
      log.error(`[capability-tracker] Failed to generate report: ${err}`);
      throw err;
    }
  }

  /**
   * Load all metrics from file.
   */
  private async loadMetrics(): Promise<CapabilityMetric[]> {
    try {
      const content = await fs.readFile(this.metricsFile, "utf-8");
      const lines = content
        .trim()
        .split("\n")
        .filter((line) => line.trim());
      return lines.map((line) => JSON.parse(line) as CapabilityMetric);
    } catch (err) {
      if ((err as { code?: string }).code === "ENOENT") {
        return [];
      }
      throw err;
    }
  }

  /**
   * Get latest metrics.
   */
  async getLatestMetrics(): Promise<CapabilityMetric | null> {
    const metrics = await this.loadMetrics();
    return metrics.length > 0 ? metrics[metrics.length - 1] : null;
  }

  /**
   * Get metrics for a specific generation.
   */
  async getMetricsForGeneration(generation: number): Promise<CapabilityMetric | null> {
    const metrics = await this.loadMetrics();
    return metrics.find((m) => m.generation === generation) ?? null;
  }
}

/**
 * Global capability tracker instance.
 */
let globalTracker: CapabilityTracker | undefined;

export function getGlobalCapabilityTracker(params?: { statsDir?: string }): CapabilityTracker {
  if (!globalTracker) {
    globalTracker = new CapabilityTracker(params);
  }
  return globalTracker;
}
