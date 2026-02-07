import { log } from "../pi-embedded-runner/logger.js";
import { Breeder } from "./breeder.js";
import { loadGenotype } from "./genotype.js";
import { getGlobalTelemetryMonitor } from "./telemetry-monitor.js";
import { getAggregatedStats } from "./telemetry.js";

export type EvolutionDaemonConfig = {
  /** How often to check telemetry and trigger evolution (milliseconds) */
  checkIntervalMs?: number;
  /** Fitness degradation threshold to trigger evolution (0.0 - 1.0) */
  fitnessDegradationThreshold?: number;
  /** Error rate threshold to trigger mutations (0.0 - 1.0) */
  errorRateThreshold?: number;
  /** Minimum sessions before triggering evolution */
  minSessionsForEvolution?: number;
  /** Whether to run mutations automatically */
  autoMutate?: boolean;
  /** Stats directory for telemetry */
  statsDir?: string;
  /** Workspace directory */
  workspaceDir?: string;
};

export type EvolutionDaemonStatus = {
  running: boolean;
  lastCheckTime: number;
  lastEvolutionTime?: number;
  lastMutationTime?: number;
  evolutionCount: number;
  mutationCount: number;
  currentFitness?: number;
  baselineFitness?: number;
};

/**
 * EvolutionDaemon: Background service that continuously evolves the agent.
 *
 * Monitors telemetry and automatically triggers:
 * - Evolution cycles when fitness degrades
 * - Mutation cycles when error rates increase
 * - Reports capability growth over time
 */
export class EvolutionDaemon {
  private readonly config: Required<EvolutionDaemonConfig>;
  private intervalId?: NodeJS.Timeout;
  private isRunning: boolean = false;
  private status: EvolutionDaemonStatus;
  private baselineFitness?: number;
  private breeder: Breeder;
  private telemetryMonitor: ReturnType<typeof getGlobalTelemetryMonitor>;

  constructor(config: EvolutionDaemonConfig = {}) {
    this.config = {
      checkIntervalMs: config.checkIntervalMs ?? 3600000, // 1 hour default
      fitnessDegradationThreshold: config.fitnessDegradationThreshold ?? 0.1, // 10% degradation
      errorRateThreshold: config.errorRateThreshold ?? 0.2, // 20% error rate
      minSessionsForEvolution: config.minSessionsForEvolution ?? 10,
      autoMutate: config.autoMutate ?? true,
      statsDir: config.statsDir,
      workspaceDir: config.workspaceDir ?? process.cwd(),
    };

    this.status = {
      running: false,
      lastCheckTime: 0,
      evolutionCount: 0,
      mutationCount: 0,
    };

    this.breeder = new Breeder({
      statsDir: this.config.statsDir,
      workspaceDir: this.config.workspaceDir,
    });

    this.telemetryMonitor = getGlobalTelemetryMonitor({
      statsDir: this.config.statsDir,
      workspaceDir: this.config.workspaceDir,
      autoMutate: this.config.autoMutate,
      errorRateThreshold: this.config.errorRateThreshold,
    });
  }

  /**
   * Start the evolution daemon.
   */
  start(): void {
    if (this.isRunning) {
      log.warn("[evolution-daemon] Already running");
      return;
    }

    this.isRunning = true;
    this.status.running = true;
    log.info(
      `[evolution-daemon] Starting (interval: ${this.config.checkIntervalMs}ms, auto-mutate: ${this.config.autoMutate})`,
    );

    // Initial check
    this.check().catch((err) => {
      log.error(`[evolution-daemon] Initial check failed: ${err}`);
    });

    // Periodic checks
    this.intervalId = setInterval(() => {
      this.check().catch((err) => {
        log.error(`[evolution-daemon] Periodic check failed: ${err}`);
      });
    }, this.config.checkIntervalMs);
  }

  /**
   * Stop the evolution daemon.
   */
  stop(): void {
    if (!this.isRunning) {
      return;
    }

    this.isRunning = false;
    this.status.running = false;
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = undefined;
    }

    log.info("[evolution-daemon] Stopped");
  }

  /**
   * Check telemetry and trigger evolution/mutations if needed.
   */
  async check(): Promise<void> {
    this.status.lastCheckTime = Date.now();

    try {
      // 1. Check current genotype and fitness
      const genotype = await loadGenotype().catch(() => null);
      if (!genotype) {
        log.debug("[evolution-daemon] No genotype found, skipping check");
        return;
      }

      const stats = await getAggregatedStats({
        genotypeId: genotype.genotypeId,
        statsDir: this.config.statsDir,
      });

      if (stats.count < this.config.minSessionsForEvolution) {
        log.debug(
          `[evolution-daemon] Not enough sessions (${stats.count} < ${this.config.minSessionsForEvolution}), skipping`,
        );
        return;
      }

      // Set baseline fitness on first check
      if (this.baselineFitness === undefined && stats.avgFitness > 0) {
        this.baselineFitness = stats.avgFitness;
        this.status.baselineFitness = this.baselineFitness;
        log.info(`[evolution-daemon] Baseline fitness set: ${this.baselineFitness.toFixed(3)}`);
      }

      this.status.currentFitness = stats.avgFitness;

      // 2. Check for fitness degradation
      if (this.baselineFitness !== undefined && stats.avgFitness > 0) {
        const degradation = this.baselineFitness - stats.avgFitness;
        const degradationPercent = degradation / this.baselineFitness;

        if (degradationPercent >= this.config.fitnessDegradationThreshold) {
          log.warn(
            `[evolution-daemon] Fitness degraded by ${(degradationPercent * 100).toFixed(1)}% (${this.baselineFitness.toFixed(3)} → ${stats.avgFitness.toFixed(3)}). Triggering evolution...`,
          );
          await this.triggerEvolution();
        } else {
          log.debug(
            `[evolution-daemon] Fitness stable: ${stats.avgFitness.toFixed(3)} (degradation: ${(degradationPercent * 100).toFixed(1)}%)`,
          );
        }
      }

      // 3. Check telemetry for error hotspots (mutations)
      const monitorResult = await this.telemetryMonitor.check();
      if (monitorResult.shouldTriggerMutation && this.config.autoMutate) {
        log.info(
          `[evolution-daemon] High error rates detected (${monitorResult.hotspots.length} hotspot(s)). Triggering mutation cycle...`,
        );
        await this.triggerMutation();
      }
    } catch (err) {
      log.error(`[evolution-daemon] Check failed: ${err}`);
    }
  }

  /**
   * Trigger an evolution cycle.
   */
  private async triggerEvolution(): Promise<void> {
    try {
      log.info("[evolution-daemon] Starting evolution cycle...");
      const result = await this.breeder.evolveWithMutations({
        autoMutate: this.config.autoMutate,
      });

      this.status.evolutionCount++;
      this.status.lastEvolutionTime = Date.now();

      log.info(
        `[evolution-daemon] Evolution complete - Generation ${result.evolution.generation}, Winner fitness: ${result.evolution.winner.lastFitness?.toFixed(3) ?? "N/A"}`,
      );

      if (result.mutations && result.mutations.summary.successful > 0) {
        this.status.mutationCount++;
        this.status.lastMutationTime = Date.now();
        log.info(
          `[evolution-daemon] Mutations applied: ${result.mutations.summary.successful} successful`,
        );
      }

      // Update baseline fitness with new winner
      if (result.evolution.winner.lastFitness !== undefined) {
        this.baselineFitness = result.evolution.winner.lastFitness;
        this.status.baselineFitness = this.baselineFitness;
      }
    } catch (err) {
      log.error(`[evolution-daemon] Evolution cycle failed: ${err}`);
    }
  }

  /**
   * Trigger a mutation cycle.
   */
  private async triggerMutation(): Promise<void> {
    try {
      log.info("[evolution-daemon] Starting mutation cycle...");
      const result = await this.breeder.runMutationCycle();

      this.status.mutationCount++;
      this.status.lastMutationTime = Date.now();

      const { successful, failed, skipped, throttled } = result.summary;
      const parts = [`${successful} successful`];
      if (failed > 0) parts.push(`${failed} failed`);
      if (skipped > 0) parts.push(`${skipped} skipped`);
      if (throttled > 0) parts.push(`${throttled} throttled`);
      log.info(`[evolution-daemon] Mutation cycle complete - ${parts.join(", ")}`);
    } catch (err) {
      log.error(`[evolution-daemon] Mutation cycle failed: ${err}`);
    }
  }

  /**
   * Get daemon status.
   */
  getStatus(): EvolutionDaemonStatus {
    return { ...this.status };
  }

  /**
   * Check if daemon is running.
   */
  isActive(): boolean {
    return this.isRunning;
  }
}

/**
 * Global evolution daemon instance.
 */
let globalDaemon: EvolutionDaemon | undefined;

export function getGlobalEvolutionDaemon(config?: EvolutionDaemonConfig): EvolutionDaemon {
  if (!globalDaemon) {
    globalDaemon = new EvolutionDaemon(config);
  }
  return globalDaemon;
}
