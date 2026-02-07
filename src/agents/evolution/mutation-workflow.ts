import { execSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { callGateway } from "../../gateway/call.js";
import { log } from "../pi-embedded-runner/logger.js";
import { runEvolutionDojoTask } from "./dojo-runner.ts";
import { Mutator } from "./mutator.js";
import { applyPatchToCodebase, savePatch, updatePatchStatus } from "./patches.js";
import { validatePatch } from "./policy-guard.js";

export type MutationResult = {
  success: boolean;
  patchId?: string;
  error?: string;
  buildVerified?: boolean;
  committed?: boolean;
};

/**
 * MutationWorkflow: Implements the full "Identify -> Diagnose -> Patch -> Verify" cycle.
 */
export class MutationWorkflow {
  private readonly mutator: Mutator;
  private readonly workspaceDir: string;

  constructor(mutator: Mutator, workspaceDir?: string) {
    this.mutator = mutator;
    this.workspaceDir = workspaceDir ?? process.cwd();
  }

  async run(): Promise<MutationResult[]> {
    log.info("[mutation] Starting self-modification cycle...");
    const results: MutationResult[] = [];

    // 1. Identify system failures (build failures, gateway crashes)
    const systemFailures = await this.mutator.identifySystemFailures();
    if (systemFailures.length > 0) {
      log.info(
        `[mutation] Found ${systemFailures.length} system failure(s), attempting recovery...`,
      );
      for (const failure of systemFailures) {
        const result = await this.attemptSystemRecovery(failure);
        results.push(result);
      }
    }

    // 2. Identify hotspots (reflexive)
    const hotspots = await this.mutator.identifyHotspots({ threshold: 0.15 }); // Be eager
    if (hotspots.length === 0) {
      log.info("[mutation] No tool hotspots identified.");
      return results;
    }

    for (const hotspot of hotspots) {
      log.info(
        `[mutation] Diagnosing hotspot: ${hotspot.toolName} (error rate: ${(hotspot.errorRate * 100).toFixed(1)}%)`,
      );

      const result = await this.processHotspot(hotspot);
      results.push(result);
    }

    return results;
  }

  /**
   * Process a single hotspot through the full mutation cycle.
   */
  private async processHotspot(hotspot: {
    toolName: string;
    errorRate: number;
  }): Promise<MutationResult> {
    try {
      // Step 1: Spawn Diagnostic Agent (Root Cause Analysis)
      const diagnostic = await this.mutator.spawnDiagnosticAgent(hotspot);
      if (!diagnostic.proposedFix) {
        log.warn(`[mutation] No fix proposed for ${hotspot.toolName}.`);
        return { success: false, error: "No fix proposed by diagnostic agent" };
      }

      // Step 2: Policy Guard (Validation)
      const sourceFile = this.mutator["mapToolToSourceFile"](hotspot.toolName);
      const validation = await validatePatch({
        patch: diagnostic.proposedFix,
        targetFiles: [sourceFile ?? ""],
      });

      if (!validation.allowed) {
        log.error(
          `[mutation] Patch for ${hotspot.toolName} blocked by policy: ${validation.reason}`,
        );
        return { success: false, error: `Policy blocked: ${validation.reason}` };
      }

      // Step 3: Save the patch
      const patchId = await savePatch(diagnostic.proposedFix, {
        rationale: diagnostic.rootCause,
        files: sourceFile ? [{ path: sourceFile, added: 0, removed: 0, modified: 1 }] : [],
      });
      log.info(`[mutation] Saved patch ${patchId} for ${hotspot.toolName}`);

      // Step 4: Dojo Gate (Dojo Runner)
      log.info(`[mutation] Running Dojo verification for ${hotspot.toolName}...`);
      const stats = await runEvolutionDojoTask({
        task: {
          id: `verify-${hotspot.toolName}`,
          name: `Verification for ${hotspot.toolName}`,
          description: `Verify autonomous fix for ${hotspot.toolName}`,
          prompt: "Verify the code works.",
        },
        genotypeId: "current",
        patchPath: diagnostic.proposedFix,
        workspaceRoot: this.workspaceDir,
      });

      if (!stats.success) {
        log.error(
          `[mutation] FAILURE: Dojo failed to verify fix for ${hotspot.toolName}: ${stats.error}`,
        );
        await updatePatchStatus(patchId, "failed", { error: stats.error });
        return { success: false, patchId, error: `Dojo verification failed: ${stats.error}` };
      }

      log.info(`[mutation] SUCCESS: Dojo verified fix for ${hotspot.toolName}. Applying...`);

      // Step 5: Apply the patch
      const applyResult = await applyPatchToCodebase(patchId, this.workspaceDir);
      if (!applyResult.success) {
        log.error(`[mutation] Failed to apply patch: ${applyResult.error}`);
        await updatePatchStatus(patchId, "failed", { error: applyResult.error });
        return { success: false, patchId, error: `Failed to apply: ${applyResult.error}` };
      }

      // Step 6: Verify build
      const buildResult = await this.verifyBuild();
      if (!buildResult.success) {
        log.error(`[mutation] Build failed after applying patch: ${buildResult.error}`);
        // Revert the patch
        await this.revertPatch(patchId);
        await updatePatchStatus(patchId, "reverted", { error: buildResult.error });
        return {
          success: false,
          patchId,
          error: `Build failed: ${buildResult.error}`,
          buildVerified: false,
        };
      }

      log.info(`[mutation] Build verified for ${hotspot.toolName}`);

      // Step 7: Commit the change
      const commitResult = await this.commitChange(patchId, hotspot.toolName, diagnostic.rootCause);
      await updatePatchStatus(patchId, "applied", {
        buildVerified: true,
        committed: commitResult.success,
      });

      // Step 8: Trigger gateway restart to apply changes
      await this.triggerRestart();

      log.info(
        `[mutation] ✅ Successfully fixed ${hotspot.toolName} (patch: ${patchId}, committed: ${commitResult.success})`,
      );

      return {
        success: true,
        patchId,
        buildVerified: true,
        committed: commitResult.success,
      };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      log.error(`[mutation] Error processing hotspot ${hotspot.toolName}: ${error}`);
      return { success: false, error };
    }
  }

  /**
   * Verify the build passes after applying a patch.
   */
  private async verifyBuild(): Promise<{ success: boolean; error?: string }> {
    try {
      log.info("[mutation] Verifying build...");

      // Use BuildFailureHook if available for automatic recovery
      try {
        const { getGlobalBuildFailureHook } = await import("./build-failure-hook.js");
        const hook = getGlobalBuildFailureHook({
          workspaceDir: this.workspaceDir,
          enabled: true,
          autoRecover: true,
        });

        const result = await hook.wrapBuild(async () => {
          try {
            const output = execSync("pnpm build", {
              cwd: this.workspaceDir,
              encoding: "utf-8",
              stdio: "pipe",
              timeout: 120_000, // 2 minute timeout
            });
            return { exitCode: 0, output: output.toString() };
          } catch (err: unknown) {
            const error = err as { stdout?: string; stderr?: string; status?: number | null };
            const output = (error.stdout ?? "") + (error.stderr ?? "");
            return { exitCode: error.status ?? 1, output };
          }
        });

        if (result.recovered) {
          log.info("[mutation] Build recovered automatically after failure");
        }
        return { success: result.exitCode === 0 };
      } catch {
        // BuildFailureHook not available, fall back to direct build
      }

      // Fallback: direct build
      execSync("pnpm build", {
        cwd: this.workspaceDir,
        stdio: "pipe",
        timeout: 120_000, // 2 minute timeout
      });
      return { success: true };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      return { success: false, error };
    }
  }

  /**
   * Revert a patch by restoring files from backup.
   */
  private async revertPatch(patchId: string): Promise<void> {
    try {
      const { revertPatchOnFailure } = await import("./safety.js");
      await revertPatchOnFailure(patchId, `backup-${patchId}`, this.workspaceDir);
      log.info(`[mutation] Reverted patch ${patchId}`);
    } catch (err) {
      log.error(`[mutation] Failed to revert patch ${patchId}: ${err}`);
    }
  }

  /**
   * Commit the change to git.
   */
  private async commitChange(
    patchId: string,
    toolName: string,
    rootCause: string,
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const message = `fix(evolution): auto-fix ${toolName}

Root cause: ${rootCause}
Patch ID: ${patchId}

This commit was automatically generated by the self-evolution system.`;

      execSync(`git add -A && git commit -m "${message.replace(/"/g, '\\"')}"`, {
        cwd: this.workspaceDir,
        stdio: "pipe",
        timeout: 30_000,
      });
      return { success: true };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      log.warn(`[mutation] Git commit failed (non-fatal): ${error}`);
      return { success: false, error };
    }
  }

  /**
   * Trigger gateway restart to apply code changes.
   */
  private async triggerRestart(): Promise<void> {
    try {
      await callGateway({
        method: "restart",
        params: { reason: "self-evolution: applied mutation" },
        timeoutMs: 5_000,
      });
      log.info("[mutation] Gateway restart triggered");
    } catch (err) {
      // Gateway might already be restarting, that's fine
      log.debug(`[mutation] Gateway restart trigger: ${err}`);
    }
  }

  /**
   * Attempt recovery for system failures.
   */
  private async attemptSystemRecovery(failure: {
    type: "build-failure" | "gateway-crash" | "runtime-error";
    error: string;
    timestamp: number;
    logs?: string;
  }): Promise<MutationResult> {
    try {
      const { GatewayRecovery } = await import("./gateway-recovery.js");
      const recovery = new GatewayRecovery({
        workspaceDir: this.workspaceDir,
        maxRetries: 3,
        agentStrategy: "claude-code",
      });

      if (failure.type === "build-failure") {
        const result = await recovery.handleBuildFailure({
          buildLog: failure.logs ?? `Build failure: ${failure.error}`,
          workspaceDir: this.workspaceDir,
        });

        if (result.success) {
          // Trigger restart after successful recovery
          await this.triggerRestart();
        }

        return {
          success: result.success,
          error: result.error,
          buildVerified: result.success,
        };
      } else {
        log.warn(
          `[mutation] System failure type ${failure.type} not yet handled by recovery system`,
        );
        return { success: false, error: `Unhandled failure type: ${failure.type}` };
      }
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      log.error(`[mutation] Failed to recover from system failure: ${error}`);
      return { success: false, error };
    }
  }
}
