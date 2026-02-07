/**
 * Gateway Restart Detection
 *
 * Detects gateway restarts and logs them for meta-learning.
 */

import { readRestartSentinel, type RestartSentinelPayload } from "../../infra/restart-sentinel.js";
import { log } from "../pi-embedded-runner/logger.js";
import { MetaLearningSystem } from "./meta-learning.js";

export class RestartDetection {
  private readonly metaLearning: MetaLearningSystem;
  private lastRestartTs: number | null = null;

  constructor() {
    this.metaLearning = new MetaLearningSystem();
  }

  /**
   * Called on gateway startup to detect and log restarts.
   */
  async detectAndLogRestart(): Promise<void> {
    try {
      // Check if there's a restart sentinel (indicates a restart occurred)
      const sentinel = await readRestartSentinel();
      if (!sentinel) {
        // First startup or no restart sentinel - check if we have a last restart timestamp
        // This would be stored in a state file
        return;
      }

      const payload = sentinel.payload;

      // Log restart as an outcome for meta-learning
      if (payload.kind === "restart" || payload.kind === "dev-self-edit") {
        const restartTaskId = `restart-${payload.ts}`;

        // Log the restart as an outcome (we don't have a prediction, but we can log the restart itself)
        await this.metaLearning.logOutcome({
          taskId: restartTaskId,
          actualSuccess: payload.status === "ok",
          actualDurationMs: payload.stats?.durationMs ?? 0,
          timestamp: Date.now(),
        });

        log.info(`[restart-detection] Logged restart outcome: ${payload.kind} ${payload.status}`);
      }
    } catch (err) {
      log.warn(
        `[restart-detection] Failed to detect restart: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /**
   * Log a prediction before a restart is triggered.
   */
  async logRestartPrediction(reason?: string): Promise<string> {
    const taskId = `restart-${Date.now()}`;
    await this.metaLearning.logPrediction({
      taskId,
      taskType: "gateway_restart",
      predictedSuccess: 0.95, // Restarts are usually successful
      predictedDifficulty: 0.2, // Low difficulty
      predictedDurationMs: 2000, // Expected ~2 seconds
      timestamp: Date.now(),
    });
    this.lastRestartTs = Date.now();
    return taskId;
  }
}
