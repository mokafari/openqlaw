import { loadConfig } from "../../config/config.js";
import { callGateway } from "../../gateway/call.js";
import { log } from "../pi-embedded-runner/logger.js";

export type HealthMonitorParams = {
  intervalMs?: number;
  spawnAgentOnFailure?: boolean;
  healthCheckTimeout?: number;
  onUnhealthy?: () => Promise<void>;
};

export type HealthMonitorHandle = {
  stop: () => void;
};

/**
 * HealthMonitor: Run hourly health checks and spawn agent if gateway is unhealthy.
 */
export class HealthMonitor {
  private intervalId: NodeJS.Timeout | null = null;
  private readonly intervalMs: number;
  private readonly spawnAgentOnFailure: boolean;
  private readonly healthCheckTimeout: number;
  private readonly onUnhealthy?: () => Promise<void>;
  private isRunning = false;

  constructor(params: HealthMonitorParams = {}) {
    this.intervalMs = params.intervalMs ?? 3600000; // 1 hour default
    this.spawnAgentOnFailure = params.spawnAgentOnFailure ?? true;
    this.healthCheckTimeout = params.healthCheckTimeout ?? 10000;
    this.onUnhealthy = params.onUnhealthy;
  }

  /**
   * Start health check loop.
   */
  start(): HealthMonitorHandle {
    if (this.isRunning) {
      log.warn("[health-monitor] Already running");
      return { stop: () => this.stop() };
    }

    this.isRunning = true;
    log.info(`[health-monitor] Starting health checks (interval: ${this.intervalMs}ms)`);

    // Run initial check
    void this.checkHealth();

    // Schedule periodic checks
    this.intervalId = setInterval(() => {
      void this.checkHealth();
    }, this.intervalMs);

    return {
      stop: () => this.stop(),
    };
  }

  /**
   * Stop health check loop.
   */
  stop(): void {
    if (!this.isRunning) {
      return;
    }

    this.isRunning = false;
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    log.info("[health-monitor] Stopped");
  }

  /**
   * Check gateway health.
   */
  private async checkHealth(): Promise<void> {
    try {
      log.debug("[health-monitor] Checking gateway health...");

      const cfg = loadConfig();
      const result = await callGateway<{ ok?: boolean; error?: string }>({
        method: "status",
        params: {},
        timeoutMs: this.healthCheckTimeout,
        config: cfg,
      });

      // Check if gateway is healthy
      // The status method returns various info, but we can check if call succeeded
      if (result && typeof result === "object" && "ok" in result && result.ok === false) {
        log.warn("[health-monitor] Gateway health check failed");
        await this.handleUnhealthy();
      } else {
        log.debug("[health-monitor] Gateway health check passed");
      }
    } catch (err) {
      // Gateway is likely down or unreachable
      log.warn(
        `[health-monitor] Gateway health check error: ${err instanceof Error ? err.message : String(err)}`,
      );
      await this.handleUnhealthy();
    }
  }

  /**
   * Handle unhealthy gateway.
   */
  private async handleUnhealthy(): Promise<void> {
    if (this.onUnhealthy) {
      try {
        await this.onUnhealthy();
      } catch (err) {
        log.error(
          `[health-monitor] Error in onUnhealthy callback: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
      return;
    }

    if (this.spawnAgentOnFailure) {
      await this.spawnHealthAgent();
    }
  }

  /**
   * Spawn agent to investigate and fix health issues.
   */
  private async spawnHealthAgent(): Promise<void> {
    try {
      log.info("[health-monitor] Spawning agent to investigate gateway health");

      const cfg = loadConfig();
      const agentId = "main"; // Default agent

      const prompt = `Gateway health check failed. Please investigate and fix:
1. Check if gateway is running
2. Check for build errors
3. Restart gateway if needed
4. Report status

When done, run: openclaw system event --text "Gateway health check completed" --mode now`;

      await callGateway({
        method: "agent",
        params: {
          sessionId: `agent:${agentId}:health-check:${Date.now()}`,
          message: prompt,
          workspaceDir: process.cwd(),
        },
        timeoutMs: 10000,
        config: cfg,
      });

      log.info("[health-monitor] Agent spawned for health investigation");
    } catch (err) {
      log.error(
        `[health-monitor] Failed to spawn health agent: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
