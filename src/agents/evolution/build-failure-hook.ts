import { execSync } from "node:child_process";
import { promises as fs } from "node:fs";
import { join } from "node:path";
import { resolveStateDir } from "../../config/paths.js";
import { log } from "../pi-embedded-runner/logger.js";
import { BuildMonitor } from "./build-monitor.js";
import { GatewayRecovery } from "./gateway-recovery.js";

export type BuildFailureHookConfig = {
  workspaceDir?: string;
  enabled?: boolean;
  autoRecover?: boolean;
  maxRetries?: number;
  agentStrategy?: "claude-code" | "codex" | "opencode" | "pi";
};

/**
 * BuildFailureHook: Automatically detects and recovers from build failures.
 *
 * This hook can be integrated into:
 * 1. Build scripts (watch-node.mjs, run-node.mjs)
 * 2. Gateway startup
 * 3. Mutation workflows
 * 4. Manual build commands
 */
export class BuildFailureHook {
  private readonly config: Required<BuildFailureHookConfig>;
  private readonly monitor: BuildMonitor;
  private recoveryStatePath: string;

  constructor(config: BuildFailureHookConfig = {}) {
    this.config = {
      workspaceDir: config.workspaceDir ?? process.cwd(),
      enabled: config.enabled ?? true,
      autoRecover: config.autoRecover ?? true,
      maxRetries: config.maxRetries ?? 3,
      agentStrategy: config.agentStrategy ?? "claude-code",
    };
    this.monitor = new BuildMonitor(this.config.workspaceDir);
    this.recoveryStatePath = join(resolveStateDir(), "evolution", "recovery-state.json");
  }

  /**
   * Wrap a build command to automatically detect and recover from failures.
   * Returns the exit code and whether recovery was attempted.
   */
  async wrapBuild(
    buildCommand: () => Promise<{ exitCode: number | null; output: string }>,
  ): Promise<{
    exitCode: number | null;
    recovered: boolean;
    recoveryResult?: { success: boolean; attempts: number };
  }> {
    if (!this.config.enabled) {
      const result = await buildCommand();
      return { exitCode: result.exitCode, recovered: false };
    }

    try {
      const result = await buildCommand();

      if (result.exitCode === 0) {
        // Build succeeded, clear any recovery state
        await this.clearRecoveryState();
        return { exitCode: 0, recovered: false };
      }

      // Build failed - analyze and potentially recover
      log.warn(`[build-hook] Build failed with exit code ${result.exitCode}`);

      const buildResult = await this.monitor.watchBuild(result.output);

      if (buildResult.errors.length === 0) {
        log.warn("[build-hook] Build failed but no parseable errors found");
        return { exitCode: result.exitCode, recovered: false };
      }

      // Check if we should attempt recovery
      if (!this.config.autoRecover) {
        log.info("[build-hook] Auto-recovery disabled, skipping recovery");
        return { exitCode: result.exitCode, recovered: false };
      }

      // Attempt recovery
      log.info(
        `[build-hook] Attempting automatic recovery for ${buildResult.errors.length} error(s)`,
      );
      const recovery = new GatewayRecovery({
        workspaceDir: this.config.workspaceDir,
        maxRetries: this.config.maxRetries,
        agentStrategy: this.config.agentStrategy,
      });

      const recoveryResult = await recovery.handleBuildFailure({
        buildLog: buildResult.logs,
        workspaceDir: this.config.workspaceDir,
        exitCode: result.exitCode,
      });

      if (recoveryResult.success) {
        log.info(
          `[build-hook] ✅ Build recovered after ${recoveryResult.attempts} attempts by ${recoveryResult.fixedBy}`,
        );

        // Rebuild to verify
        try {
          const rebuildResult = await this.runBuild();
          if (rebuildResult.exitCode === 0) {
            log.info("[build-hook] ✅ Rebuild successful after recovery");
            return { exitCode: 0, recovered: true, recoveryResult };
          } else {
            log.warn("[build-hook] ⚠️ Rebuild failed after recovery");
            return { exitCode: rebuildResult.exitCode, recovered: true, recoveryResult };
          }
        } catch (err) {
          log.error(`[build-hook] Failed to rebuild after recovery: ${err}`);
          return { exitCode: result.exitCode, recovered: true, recoveryResult };
        }
      } else {
        log.error(
          `[build-hook] ❌ Recovery failed after ${recoveryResult.attempts} attempts: ${recoveryResult.error}`,
        );
        return { exitCode: result.exitCode, recovered: false, recoveryResult };
      }
    } catch (err) {
      log.error(`[build-hook] Error in build hook: ${err}`);
      return { exitCode: 1, recovered: false };
    }
  }

  /**
   * Run build command and capture output.
   */
  private async runBuild(): Promise<{ exitCode: number | null; output: string }> {
    return new Promise((resolve) => {
      let output = "";
      try {
        const result = execSync("pnpm build", {
          cwd: this.config.workspaceDir,
          encoding: "utf-8",
          stdio: "pipe",
          timeout: 120_000, // 2 minutes
        });
        resolve({ exitCode: 0, output: result.toString() });
      } catch (err: unknown) {
        const error = err as { stdout?: string; stderr?: string; status?: number | null };
        output = (error.stdout ?? "") + (error.stderr ?? "");
        resolve({ exitCode: error.status ?? 1, output });
      }
    });
  }

  /**
   * Clear recovery state file.
   */
  private async clearRecoveryState(): Promise<void> {
    try {
      const stateDir = join(resolveStateDir(), "evolution");
      await fs.mkdir(stateDir, { recursive: true });

      const state = {
        currentRecovery: null,
        history: [],
      };

      await fs.writeFile(this.recoveryStatePath, JSON.stringify(state, null, 2), "utf-8");
    } catch (err) {
      // Non-fatal
      log.debug(`[build-hook] Failed to clear recovery state: ${err}`);
    }
  }
}

/**
 * Global build failure hook instance.
 */
let globalBuildHook: BuildFailureHook | undefined;

export function getGlobalBuildFailureHook(config?: BuildFailureHookConfig): BuildFailureHook {
  if (!globalBuildHook) {
    globalBuildHook = new BuildFailureHook(config);
  }
  return globalBuildHook;
}
