/**
 * Gateway integration for evolution services.
 * Starts HealthMonitor and wires up build failure detection.
 *
 * @evolution Self-modified: 2026-02-07T11:38:00Z
 * @test This comment proves self-modification works end-to-end
 */
import type { OpenClawConfig } from "../../config/config.js";
import { log } from "../pi-embedded-runner/logger.js";
import { HealthMonitor, type HealthMonitorHandle } from "./health-monitor.js";

let healthMonitorHandle: HealthMonitorHandle | null = null;

/**
 * Start evolution services based on config.
 */
export function startEvolutionServices(cfg: OpenClawConfig): void {
  const evolutionCfg = cfg.tools?.evolution;
  if (!evolutionCfg) {
    log.debug("[evolution] No evolution config, skipping services");
    return;
  }

  // Start HealthMonitor if enabled
  if (evolutionCfg.healthMonitor?.enabled) {
    log.info("[evolution] Starting HealthMonitor...");
    const monitor = new HealthMonitor({
      intervalMs: evolutionCfg.healthMonitor.intervalMs,
      spawnAgentOnFailure: evolutionCfg.healthMonitor.spawnAgentOnFailure,
      healthCheckTimeout: evolutionCfg.healthMonitor.healthCheckTimeout,
    });
    healthMonitorHandle = monitor.start();
    log.info(
      `[evolution] HealthMonitor started (interval: ${evolutionCfg.healthMonitor.intervalMs ?? 3600000}ms)`,
    );
  }

  // Log enabled features
  if (evolutionCfg.selfModification?.enabled) {
    log.info("[evolution] Self-modification enabled");
  }
  if (evolutionCfg.autoRecovery?.enabled) {
    log.info(
      `[evolution] Auto-recovery enabled (agent: ${evolutionCfg.autoRecovery.agent ?? "claude-code"})`,
    );
  }
}

/**
 * Stop evolution services.
 */
export function stopEvolutionServices(): void {
  if (healthMonitorHandle) {
    healthMonitorHandle.stop();
    healthMonitorHandle = null;
    log.info("[evolution] HealthMonitor stopped");
  }
}

/**
 * Check if auto-recovery is enabled.
 */
export function isAutoRecoveryEnabled(cfg: OpenClawConfig): boolean {
  return cfg.tools?.evolution?.autoRecovery?.enabled === true;
}

/**
 * Get auto-recovery config.
 */
export function getAutoRecoveryConfig(cfg: OpenClawConfig) {
  return cfg.tools?.evolution?.autoRecovery ?? {};
}
