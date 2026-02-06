import type { ParsedError } from "./error-analyzer.js";
import { loadConfig } from "../../config/config.js";
import { callGateway } from "../../gateway/call.js";
import { log } from "../pi-embedded-runner/logger.js";
import { BuildMonitor } from "./build-monitor.js";
import { ErrorAnalyzer } from "./error-analyzer.js";
import { RecoveryEngine } from "./recovery-engine.js";
import { RecoveryLoop, type RecoveryResult } from "./recovery-loop.js";

export type BuildFailureParams = {
  error?: Error;
  buildLog: string;
  workspaceDir: string;
  exitCode?: number | null;
};

/**
 * GatewayRecovery: Main entry point that handles build failures and integrates with gateway wake.
 */
export class GatewayRecovery {
  private readonly workspaceDir: string;
  private readonly maxRetries: number;
  private readonly agentStrategy: "claude-code" | "codex" | "opencode" | "pi";

  constructor(params?: {
    workspaceDir?: string;
    maxRetries?: number;
    agentStrategy?: "claude-code" | "codex" | "opencode" | "pi";
  }) {
    this.workspaceDir = params?.workspaceDir ?? process.cwd();
    this.maxRetries = params?.maxRetries ?? 3;
    this.agentStrategy = params?.agentStrategy ?? "claude-code";
  }

  /**
   * Handle build failure - main entry point.
   */
  async handleBuildFailure(params: BuildFailureParams): Promise<RecoveryResult> {
    log.info("[recovery] Build failure detected, analyzing...");

    try {
      // 1. Parse errors from build log
      const analyzer = new ErrorAnalyzer(this.workspaceDir);
      const errors = await analyzer.parseErrors(params.buildLog);

      if (errors.length === 0) {
        log.warn("[recovery] No parseable errors found in build log");
        return {
          success: false,
          attempts: 0,
          escalate: true,
          error: "No parseable errors found",
        };
      }

      // Use first error for recovery
      const error = errors[0];
      log.info(`[recovery] Parsed error: ${error.code} in ${error.file}:${error.line}`);

      // 2. Decide if recovery should be attempted
      const engine = new RecoveryEngine();
      const decision = engine.shouldAttemptRecovery(error);

      if (!decision.fixable) {
        log.warn(`[recovery] Error not fixable: ${decision.reason}`);
        await this.alertUser({
          type: "build-failure",
          error,
          logs: params.buildLog,
          action: "manual-intervention-required",
        });
        return {
          success: false,
          attempts: 0,
          escalate: true,
          error: decision.reason,
        };
      }

      // 3. Attempt recovery
      log.info(`[recovery] Attempting recovery with strategy: ${decision.strategy}`);
      const loop = new RecoveryLoop(this.workspaceDir);
      const result = await loop.run({
        error,
        logs: params.buildLog,
        workspaceDir: this.workspaceDir,
        maxRetries: this.maxRetries,
        decision,
        agentStrategy: this.agentStrategy,
      });

      // 4. Handle result
      if (result.success) {
        log.info(`[recovery] Build fixed after ${result.attempts} attempts by ${result.fixedBy}`);
        await this.wakeGateway({
          text: `Build auto-fixed after ${result.attempts} attempts: ${error.code}`,
          mode: "now",
        });
      } else {
        log.error(`[recovery] Recovery failed after ${result.attempts} attempts`);
        await this.alertUser({
          type: "recovery-failed",
          attempts: result.attempts,
          lastError: error,
          logs: params.buildLog,
        });
      }

      return result;
    } catch (err) {
      log.error(
        `[recovery] Recovery system error: ${err instanceof Error ? err.message : String(err)}`,
      );
      return {
        success: false,
        attempts: 0,
        escalate: true,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  /**
   * Alert user about build failure or recovery failure.
   */
  private async alertUser(params: {
    type: "build-failure" | "recovery-failed";
    error?: ParsedError;
    logs?: string;
    attempts?: number;
    lastError?: ParsedError;
    action?: string;
  }): Promise<void> {
    try {
      const cfg = loadConfig();
      const alertChannels = cfg.tools?.evolution?.autoRecovery?.alertChannels ?? [];

      if (alertChannels.length === 0) {
        log.warn("[recovery] No alert channels configured, skipping user notification");
        return;
      }

      let message = "";
      if (params.type === "build-failure") {
        message = `Build failed: ${params.error?.code ?? "unknown"} in ${params.error?.file ?? "unknown"}. Manual intervention required.`;
      } else {
        message = `Recovery failed after ${params.attempts ?? 0} attempts. Last error: ${params.lastError?.code ?? "unknown"}`;
      }

      // Send alert via gateway wake (would be sent to configured channels)
      await this.wakeGateway({
        text: message,
        mode: "now",
      });
    } catch (err) {
      log.error(
        `[recovery] Failed to alert user: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /**
   * Trigger gateway wake event.
   */
  private async wakeGateway(params: {
    text: string;
    mode: "now" | "next-heartbeat";
  }): Promise<void> {
    try {
      await callGateway({
        method: "wake",
        params: {
          text: params.text,
          mode: params.mode,
        },
        timeoutMs: 5000,
      });
      log.info(`[recovery] Gateway woken: ${params.text}`);
    } catch (err) {
      // Gateway might not be running, log but don't fail
      log.warn(
        `[recovery] Failed to wake gateway: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
