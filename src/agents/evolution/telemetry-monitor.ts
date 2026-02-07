import type { MutationWorkflow } from "./mutation-workflow.js";
import type { Mutator } from "./mutator.js";
import { log } from "../pi-embedded-runner/logger.js";
import { getToolErrorRates } from "./telemetry.js";

export type TelemetryMonitorConfig = {
  /** Error rate threshold (0.0 - 1.0) to trigger diagnostic state */
  errorRateThreshold?: number;
  /** Minimum number of tool calls before considering error rate */
  minToolCalls?: number;
  /** How often to check telemetry (milliseconds) */
  checkIntervalMs?: number;
  /** Whether to automatically trigger mutation cycles */
  autoMutate?: boolean;
  /** Stats directory for reading telemetry */
  statsDir?: string;
  /** Workspace directory for mutations */
  workspaceDir?: string;
};

export type MonitorResult = {
  hotspots: Array<{
    toolName: string;
    errorRate: number;
    totalCalls: number;
    errorCount: number;
  }>;
  shouldTriggerDiagnostic: boolean;
  shouldTriggerMutation: boolean;
};

/**
 * TelemetryMonitor: Continuously monitors telemetry and triggers
 * diagnostic/mutation states when error rates exceed thresholds.
 */
export class TelemetryMonitor {
  private readonly config: Required<TelemetryMonitorConfig>;
  private intervalId?: NodeJS.Timeout;
  private lastCheckTime: number = 0;
  private isRunning: boolean = false;
  /** Track last logged hotspots to avoid spam - only log on changes */
  private lastLoggedHotspots: Map<string, { errorRate: number; errorCount: number }> = new Map();

  constructor(config: TelemetryMonitorConfig = {}) {
    this.config = {
      errorRateThreshold: config.errorRateThreshold ?? 0.2, // 20% error rate
      minToolCalls: config.minToolCalls ?? 5,
      checkIntervalMs: config.checkIntervalMs ?? 60_000, // Check every minute
      autoMutate: config.autoMutate ?? false,
      statsDir: config.statsDir,
      workspaceDir: config.workspaceDir ?? process.cwd(),
    };
  }

  /**
   * Start monitoring telemetry in the background.
   */
  start(): void {
    if (this.isRunning) {
      log.warn("[telemetry-monitor] Already running");
      return;
    }

    this.isRunning = true;
    log.info(
      `[telemetry-monitor] Starting monitor (interval: ${this.config.checkIntervalMs}ms, threshold: ${(this.config.errorRateThreshold * 100).toFixed(1)}%)`,
    );

    // Initial check
    this.check().catch((err) => {
      log.error(`[telemetry-monitor] Initial check failed: ${err}`);
    });

    // Periodic checks
    this.intervalId = setInterval(() => {
      this.check().catch((err) => {
        log.error(`[telemetry-monitor] Periodic check failed: ${err}`);
      });
    }, this.config.checkIntervalMs);
  }

  /**
   * Stop monitoring.
   */
  stop(): void {
    if (!this.isRunning) {
      return;
    }

    this.isRunning = false;
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = undefined;
    }

    log.info("[telemetry-monitor] Stopped");
  }

  /**
   * Check telemetry and return current state.
   */
  async check(): Promise<MonitorResult> {
    this.lastCheckTime = Date.now();

    try {
      const errorRates = await getToolErrorRates({
        statsDir: this.config.statsDir,
        threshold: this.config.errorRateThreshold,
        minCalls: this.config.minToolCalls,
      });

      const hotspots = errorRates.map((rate) => ({
        toolName: rate.toolName,
        errorRate: rate.errorRate,
        totalCalls: rate.totalCalls,
        errorCount: rate.errorCount,
      }));

      const shouldTriggerDiagnostic = hotspots.length > 0;
      const shouldTriggerMutation =
        this.config.autoMutate && hotspots.length > 0 && hotspots.some((h) => h.errorRate >= 0.3); // 30%+ for auto-mutation

      // Only log if hotspot status actually changed (new/resolved/rate changed significantly)
      const changes = this.detectHotspotChanges(hotspots);
      if (changes.hasChanges) {
        if (changes.newHotspots.length > 0) {
          log.warn(
            `[telemetry-monitor] New hotspot(s) detected: ${changes.newHotspots.map((h) => `${h.toolName} (${(h.errorRate * 100).toFixed(1)}%)`).join(", ")}`,
          );
        }
        if (changes.resolvedHotspots.length > 0) {
          log.info(
            `[telemetry-monitor] Hotspot(s) resolved: ${changes.resolvedHotspots.join(", ")}`,
          );
        }
        if (changes.rateChanges.length > 0) {
          for (const change of changes.rateChanges) {
            log.warn(
              `[telemetry-monitor] ${change.toolName} error rate changed: ${(change.oldRate * 100).toFixed(1)}% -> ${(change.newRate * 100).toFixed(1)}%`,
            );
          }
        }
        // Update tracked state
        this.lastLoggedHotspots.clear();
        for (const hotspot of hotspots) {
          this.lastLoggedHotspots.set(hotspot.toolName, {
            errorRate: hotspot.errorRate,
            errorCount: hotspot.errorCount,
          });
        }
      }

      return {
        hotspots,
        shouldTriggerDiagnostic,
        shouldTriggerMutation,
      };
    } catch (err) {
      log.error(`[telemetry-monitor] Check failed: ${err}`);
      return {
        hotspots: [],
        shouldTriggerDiagnostic: false,
        shouldTriggerMutation: false,
      };
    }
  }

  /**
   * Detect changes in hotspot status compared to last logged state.
   * Returns info about new hotspots, resolved hotspots, and significant rate changes.
   */
  private detectHotspotChanges(
    currentHotspots: Array<{ toolName: string; errorRate: number; errorCount: number }>,
  ): {
    hasChanges: boolean;
    newHotspots: Array<{ toolName: string; errorRate: number }>;
    resolvedHotspots: string[];
    rateChanges: Array<{ toolName: string; oldRate: number; newRate: number }>;
  } {
    const newHotspots: Array<{ toolName: string; errorRate: number }> = [];
    const rateChanges: Array<{ toolName: string; oldRate: number; newRate: number }> = [];
    const currentNames = new Set(currentHotspots.map((h) => h.toolName));

    // Check for new hotspots and rate changes
    for (const hotspot of currentHotspots) {
      const prev = this.lastLoggedHotspots.get(hotspot.toolName);
      if (!prev) {
        newHotspots.push({ toolName: hotspot.toolName, errorRate: hotspot.errorRate });
      } else {
        // Significant rate change: >5 percentage points or >20% relative change
        const rateDiff = Math.abs(hotspot.errorRate - prev.errorRate);
        const relativeChange = prev.errorRate > 0 ? rateDiff / prev.errorRate : rateDiff;
        if (rateDiff > 0.05 || relativeChange > 0.2) {
          rateChanges.push({
            toolName: hotspot.toolName,
            oldRate: prev.errorRate,
            newRate: hotspot.errorRate,
          });
        }
      }
    }

    // Check for resolved hotspots
    const resolvedHotspots: string[] = [];
    for (const [toolName] of this.lastLoggedHotspots) {
      if (!currentNames.has(toolName)) {
        resolvedHotspots.push(toolName);
      }
    }

    return {
      hasChanges: newHotspots.length > 0 || resolvedHotspots.length > 0 || rateChanges.length > 0,
      newHotspots,
      resolvedHotspots,
      rateChanges,
    };
  }

  /**
   * Get the last check time.
   */
  getLastCheckTime(): number {
    return this.lastCheckTime;
  }

  /**
   * Check if monitor is running.
   */
  isActive(): boolean {
    return this.isRunning;
  }

  /**
   * Trigger a mutation cycle for detected hotspots.
   * Returns mutation results.
   */
  async triggerMutationCycle(): Promise<
    Array<{
      hotspot: { toolName: string; errorRate: number };
      success: boolean;
      error?: string;
    }>
  > {
    const result = await this.check();
    if (result.hotspots.length === 0) {
      log.info("[telemetry-monitor] No hotspots detected, skipping mutation cycle");
      return [];
    }

    log.info(
      `[telemetry-monitor] Triggering mutation cycle for ${result.hotspots.length} hotspot(s)`,
    );

    try {
      const { Mutator } = await import("./mutator.js");
      const { MutationWorkflow } = await import("./mutation-workflow.js");

      const mutator = new Mutator({
        statsDir: this.config.statsDir,
        workspaceDir: this.config.workspaceDir,
      });

      const workflow = new MutationWorkflow(mutator, this.config.workspaceDir);
      const mutationResults = await workflow.run();

      return result.hotspots.map((hotspot) => {
        const mutationResult = mutationResults.find(
          (r) => r.patchId && r.success, // Find successful mutations
        );
        return {
          hotspot,
          success: mutationResult?.success ?? false,
          error: mutationResult?.error,
        };
      });
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      log.error(`[telemetry-monitor] Mutation cycle failed: ${error}`);
      return result.hotspots.map((hotspot) => ({
        hotspot,
        success: false,
        error,
      }));
    }
  }
}

/**
 * Get or create the global telemetry monitor instance.
 */
let globalMonitor: TelemetryMonitor | undefined;

export function getGlobalTelemetryMonitor(config?: TelemetryMonitorConfig): TelemetryMonitor {
  if (!globalMonitor) {
    globalMonitor = new TelemetryMonitor(config);
  }
  return globalMonitor;
}
