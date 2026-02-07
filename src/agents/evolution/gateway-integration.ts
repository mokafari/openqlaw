/**
 * Gateway integration for evolution services.
 * Starts HealthMonitor and wires up build failure detection.
 *
 * @evolution Self-modified: 2026-02-07T11:38:00Z
 * @test This comment proves self-modification works end-to-end
 * @verified Full mutation workflow tested: 2026-02-07T11:46:00Z
 * @e2e End-to-end cycle verified: 2026-02-07T11:48:00Z
 */
import type { OpenClawConfig } from "../../config/config.js";
import { log } from "../pi-embedded-runner/logger.js";
import { getGlobalBuildFailureHook } from "./build-failure-hook.js";
import { getGlobalEvolutionDaemon } from "./evolution-daemon.js";
import { HealthMonitor, type HealthMonitorHandle } from "./health-monitor.js";
import { getGlobalTelemetryMonitor } from "./telemetry-monitor.js";

let healthMonitorHandle: HealthMonitorHandle | null = null;
let telemetryMonitorActive = false;
let evolutionDaemonActive = false;

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

  // Start BuildFailureHook if auto-recovery enabled
  if (evolutionCfg.autoRecovery?.enabled) {
    log.info(
      `[evolution] Auto-recovery enabled (agent: ${evolutionCfg.autoRecovery.agent ?? "claude-code"})`,
    );

    // Initialize build failure hook (will be used when builds are run)
    getGlobalBuildFailureHook({
      enabled: true,
      autoRecover: true,
      maxRetries: 3,
      agentStrategy: (evolutionCfg.autoRecovery.agent ?? "claude-code") as
        | "claude-code"
        | "codex"
        | "opencode"
        | "pi",
    });
    log.info("[evolution] Build failure hook initialized");
  }

  // Start TelemetryMonitor if enabled
  if (evolutionCfg.telemetryMonitor?.enabled) {
    const monitor = getGlobalTelemetryMonitor({
      errorRateThreshold: evolutionCfg.telemetryMonitor.errorRateThreshold ?? 0.2,
      minToolCalls: evolutionCfg.telemetryMonitor.minToolCalls ?? 5,
      checkIntervalMs: evolutionCfg.telemetryMonitor.checkIntervalMs ?? 60_000,
      autoMutate: evolutionCfg.telemetryMonitor.autoMutate ?? false,
    });
    monitor.start();
    telemetryMonitorActive = true;
    log.info("[evolution] TelemetryMonitor started");
  }

  // Start EvolutionDaemon if enabled
  if (evolutionCfg.daemon?.enabled) {
    const daemon = getGlobalEvolutionDaemon({
      checkIntervalMs: evolutionCfg.daemon.checkIntervalMs ?? 3600000, // 1 hour
      fitnessDegradationThreshold: evolutionCfg.daemon.fitnessDegradationThreshold ?? 0.1,
      errorRateThreshold: evolutionCfg.daemon.errorRateThreshold ?? 0.2,
      minSessionsForEvolution: evolutionCfg.daemon.minSessionsForEvolution ?? 10,
      autoMutate: evolutionCfg.daemon.autoMutate ?? true,
      statsDir: evolutionCfg.daemon.statsDir,
      workspaceDir: process.cwd(),
    });
    daemon.start();
    evolutionDaemonActive = true;
    log.info(
      `[evolution] EvolutionDaemon started (interval: ${evolutionCfg.daemon.checkIntervalMs ?? 3600000}ms)`,
    );
  }

  // Log enabled features
  if (evolutionCfg.selfModification?.enabled) {
    log.info("[evolution] Self-modification enabled");
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

  if (telemetryMonitorActive) {
    const monitor = getGlobalTelemetryMonitor();
    monitor.stop();
    telemetryMonitorActive = false;
    log.info("[evolution] TelemetryMonitor stopped");
  }

  if (evolutionDaemonActive) {
    const daemon = getGlobalEvolutionDaemon();
    daemon.stop();
    evolutionDaemonActive = false;
    log.info("[evolution] EvolutionDaemon stopped");
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
