import { promises as fs } from "node:fs";
import { join } from "node:path";
import type { ParsedError } from "./error-analyzer.js";
import type { RecoveryDecision } from "./recovery-engine.js";
import { resolveStateDir } from "../../config/paths.js";
import { runCommandWithTimeout } from "../../process/exec.js";
import { log } from "../pi-embedded-runner/logger.js";
import { AutoSpawner } from "./auto-spawner.js";

export type RecoveryResult = {
  success: boolean;
  attempts: number;
  fixedBy?: string;
  backupId?: string;
  error?: string;
  escalate?: boolean;
};

export type RecoveryLoopParams = {
  error: ParsedError;
  logs: string;
  workspaceDir: string;
  maxRetries: number;
  decision: RecoveryDecision;
  agentStrategy?: "claude-code" | "gemini" | "sessions-spawn";
};

/**
 * RecoveryLoop: Orchestrate fix attempts with retries and backups.
 */
export class RecoveryLoop {
  private readonly workspaceDir: string;

  constructor(workspaceDir: string) {
    this.workspaceDir = workspaceDir;
  }

  /**
   * Run recovery loop with retries and backups.
   */
  async run(params: RecoveryLoopParams): Promise<RecoveryResult> {
    if (!params.decision.fixable) {
      return {
        success: false,
        attempts: 0,
        escalate: true,
        error: params.decision.reason ?? "Error is not fixable",
      };
    }

    let attempt = 0;
    const stateManager = new RecoveryStateManager(this.workspaceDir);

    // Save recovery state
    await stateManager.saveRecoveryState({
      error: params.error,
      startedAt: Date.now(),
      attempts: 0,
    });

    while (attempt < params.maxRetries) {
      attempt++;

      try {
        // 1. Create backup
        const backupId = await stateManager.createBackup(
          `recovery-${Date.now()}-${params.error.code}`,
          [params.error.file],
        );

        // 2. Attempt fix based on strategy
        if (params.decision.strategy === "auto-fix") {
          const fixResult = await this.attemptAutoFix(params.error);
          if (!fixResult.success) {
            await stateManager.revertBackup(backupId);
            continue;
          }
        } else if (params.decision.strategy === "spawn-agent") {
          const spawner = new AutoSpawner();
          const spawnResult = await spawner.spawnCodingAgent({
            error: params.error,
            logs: params.logs,
            workspaceDir: this.workspaceDir,
            strategy: params.agentStrategy ?? "sessions-spawn",
          });

          if (spawnResult.method === "sessions-spawn" && spawnResult.task) {
            // Use native sessions_spawn via gateway RPC
            await this.spawnSubAgent(spawnResult.task, params.decision.estimatedTime);
          } else if (spawnResult.command) {
            // Fall back to shell command execution
            await this.executeShellAgent(spawnResult.command, params.decision.estimatedTime);
          }
        }

        // 3. Verify build
        const buildResult = await this.verifyBuild();

        if (buildResult.success) {
          // Update recovery state
          await stateManager.updateRecoveryState({
            success: true,
            attempts: attempt,
            fixedBy:
              params.decision.strategy === "auto-fix"
                ? "auto-fix"
                : (params.agentStrategy ?? "claude-code"),
          });

          return {
            success: true,
            attempts: attempt,
            fixedBy:
              params.decision.strategy === "auto-fix"
                ? "auto-fix"
                : (params.agentStrategy ?? "claude-code"),
            backupId,
          };
        }

        // 4. Revert if failed
        if (attempt < params.maxRetries) {
          await stateManager.revertBackup(backupId);
        }
      } catch (err) {
        // Log error but continue to next attempt
        console.error(`[recovery] Attempt ${attempt} failed:`, err);
      }
    }

    // Max retries reached
    await stateManager.updateRecoveryState({
      success: false,
      attempts: attempt,
      error: `Failed to fix after ${attempt} attempts`,
    });

    return {
      success: false,
      attempts: attempt,
      escalate: true,
      error: `Failed to fix after ${attempt} attempts`,
    };
  }

  /**
   * Attempt auto-fix for simple errors.
   */
  private async attemptAutoFix(error: ParsedError): Promise<{ success: boolean }> {
    // For missing dependencies, try npm install
    if (error.message.toLowerCase().includes("cannot find module")) {
      try {
        await runCommandWithTimeout(["pnpm", "install"], {
          timeoutMs: 120000,
          cwd: this.workspaceDir,
        });
        return { success: true };
      } catch {
        return { success: false };
      }
    }

    // Other auto-fixes would go here
    return { success: false };
  }

  /**
   * Spawn a sub-agent using OpenClaw's native sessions_spawn.
   */
  private async spawnSubAgent(task: string, estimatedTimeMs: number): Promise<void> {
    try {
      const { callGateway } = await import("../../gateway/call.js");

      // Call sessions_spawn via gateway RPC
      const result = await callGateway({
        method: "sessions.spawn",
        params: {
          task,
          label: `recovery-${Date.now()}`,
          runTimeoutSeconds: Math.ceil(estimatedTimeMs / 1000),
          cleanup: "keep",
        },
        timeoutMs: estimatedTimeMs + 30000, // Add buffer for startup
      });

      log.info(`[recovery] Sub-agent spawned: ${JSON.stringify(result)}`);
    } catch (err) {
      log.error(
        `[recovery] Failed to spawn sub-agent: ${err instanceof Error ? err.message : String(err)}`,
      );
      // Fall through to verification - agent might still have fixed something
    }
  }

  /**
   * Execute a shell-based coding agent (codex, claude-code, etc.)
   */
  private async executeShellAgent(command: string, estimatedTimeMs: number): Promise<void> {
    try {
      const timeoutMs = Math.min(estimatedTimeMs, 300000); // Max 5 minutes

      await runCommandWithTimeout(["bash", "-c", command], {
        timeoutMs,
        cwd: this.workspaceDir,
      });

      log.info(`[recovery] Shell agent completed`);
    } catch (err) {
      log.error(
        `[recovery] Shell agent failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      // Fall through to verification
    }
  }

  /**
   * Wait for agent completion (legacy method for backward compatibility).
   */
  private async waitForAgentCompletion(command: string, timeoutMs: number): Promise<void> {
    await this.executeShellAgent(command, timeoutMs);
  }

  /**
   * Verify build succeeds.
   */
  private async verifyBuild(): Promise<{ success: boolean; output?: string }> {
    try {
      const result = await runCommandWithTimeout(["pnpm", "exec", "tsdown"], {
        timeoutMs: 180000, // 3 minutes
        cwd: this.workspaceDir,
      });

      if (result.code === 0) {
        return { success: true, output: result.stdout };
      }

      return { success: false, output: result.stderr || result.stdout };
    } catch (err) {
      return {
        success: false,
        output: err instanceof Error ? err.message : String(err),
      };
    }
  }
}

/**
 * Simple recovery state manager for backups and state persistence.
 */
class RecoveryStateManager {
  private readonly workspaceDir: string;
  private readonly backupDir: string;
  private readonly stateDir: string;
  private readonly stateFile: string;

  constructor(workspaceDir: string) {
    this.workspaceDir = workspaceDir;
    this.backupDir = join(resolveStateDir(), "evolution", "backups");
    this.stateDir = join(resolveStateDir(), "evolution");
    this.stateFile = join(this.stateDir, "recovery-state.json");
  }

  /**
   * Create backup of files.
   */
  async createBackup(backupId: string, files: string[]): Promise<string> {
    const backupPath = join(this.backupDir, backupId);
    await fs.mkdir(backupPath, { recursive: true });

    for (const file of files) {
      if (file === "unknown") {
        continue;
      }

      const sourcePath = join(this.workspaceDir, file);
      const targetPath = join(backupPath, file);

      try {
        await fs.mkdir(join(targetPath, ".."), { recursive: true });
        await fs.copyFile(sourcePath, targetPath);
      } catch (err) {
        // File might not exist, continue
        if ((err as { code?: string }).code !== "ENOENT") {
          throw err;
        }
      }
    }

    // Save metadata
    await fs.writeFile(
      join(backupPath, "metadata.json"),
      JSON.stringify({ backupId, files, createdAt: Date.now() }, null, 2),
      "utf-8",
    );

    return backupId;
  }

  /**
   * Revert files from backup.
   */
  async revertBackup(backupId: string): Promise<void> {
    const backupPath = join(this.backupDir, backupId);
    const metadataPath = join(backupPath, "metadata.json");

    try {
      const metadataContent = await fs.readFile(metadataPath, "utf-8");
      const metadata = JSON.parse(metadataContent) as { files: string[] };

      for (const file of metadata.files) {
        if (file === "unknown") {
          continue;
        }

        const backupFilePath = join(backupPath, file);
        const targetPath = join(this.workspaceDir, file);

        try {
          await fs.mkdir(join(targetPath, ".."), { recursive: true });
          await fs.copyFile(backupFilePath, targetPath);
        } catch (err) {
          if ((err as { code?: string }).code === "ENOENT") {
            // File doesn't exist in backup, try to delete target
            try {
              await fs.unlink(targetPath);
            } catch {
              // Ignore
            }
          } else {
            throw err;
          }
        }
      }
    } catch (err) {
      if ((err as { code?: string }).code !== "ENOENT") {
        throw err;
      }
    }
  }

  /**
   * Save recovery state to disk.
   */
  async saveRecoveryState(state: {
    error: ParsedError;
    startedAt: number;
    attempts: number;
  }): Promise<void> {
    try {
      await fs.mkdir(this.stateDir, { recursive: true });

      let existingState: {
        currentRecovery?: unknown;
        history?: unknown[];
      } = {};

      try {
        const content = await fs.readFile(this.stateFile, "utf-8");
        existingState = JSON.parse(content);
      } catch {
        // File doesn't exist, start fresh
      }

      existingState.currentRecovery = {
        sessionId: `recovery-${state.startedAt}`,
        startedAt: state.startedAt,
        error: {
          file: state.error.file,
          line: state.error.line,
          code: state.error.code,
        },
        attempts: state.attempts,
      };

      await fs.writeFile(this.stateFile, JSON.stringify(existingState, null, 2), "utf-8");
    } catch (err) {
      log.warn(
        `[recovery] Failed to save recovery state: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /**
   * Update recovery state.
   */
  async updateRecoveryState(update: {
    success: boolean;
    attempts: number;
    fixedBy?: string;
    error?: string;
  }): Promise<void> {
    try {
      let existingState: {
        currentRecovery?: {
          sessionId?: string;
          startedAt?: number;
          error?: { code?: string };
          attempts?: number;
        };
        history?: Array<{
          timestamp: number;
          error: string;
          success: boolean;
          attempts: number;
          fixedBy?: string;
        }>;
      } = {};

      try {
        const content = await fs.readFile(this.stateFile, "utf-8");
        existingState = JSON.parse(content);
      } catch {
        // File doesn't exist
      }

      // Move current recovery to history
      if (existingState.currentRecovery) {
        if (!existingState.history) {
          existingState.history = [];
        }
        existingState.history.push({
          timestamp: existingState.currentRecovery.startedAt ?? Date.now(),
          error: existingState.currentRecovery.error?.code ?? "unknown",
          success: update.success,
          attempts: update.attempts,
          fixedBy: update.fixedBy,
        });

        // Keep only last 50 entries
        if (existingState.history.length > 50) {
          existingState.history = existingState.history.slice(-50);
        }
      }

      // Clear current recovery
      existingState.currentRecovery = undefined;

      await fs.writeFile(this.stateFile, JSON.stringify(existingState, null, 2), "utf-8");
    } catch (err) {
      log.warn(
        `[recovery] Failed to update recovery state: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
