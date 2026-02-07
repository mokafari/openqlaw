import type { ToolErrorInfo } from "./telemetry.js";
import { loadConfig } from "../../config/config.js";
import { callGateway } from "../../gateway/call.js";
import { buildDiagnosticAgentPrompt } from "./diagnostic-prompt.js";
import { runDojoTask, type DojoTask } from "./dojo.js";
import { loadGenotype } from "./genotype.js";
import { savePatch, updatePatchStatus, loadPatch, type PatchMetadata } from "./patches.js";
import {
  createBackup,
  checkRegressionTests,
  revertPatchOnFailure,
  validatePatchSafety,
} from "./safety.js";
import {
  loadSelfModificationPolicy,
  isPathAllowed as checkPathAllowed,
} from "./self-modification-policy.js";
import { getToolErrorRates, getFailingToolSessions } from "./telemetry.js";

export type ToolHotspot = {
  toolName: string;
  errorRate: number;
  totalCalls: number;
  errorCount: number;
};

export type DiagnosticResult = {
  toolName: string;
  rootCause: string;
  proposedFix?: string;
  patchId?: string;
};

export type MutationCycleResult = {
  results: Array<{
    hotspot: ToolHotspot;
    diagnosticResult?: DiagnosticResult;
    patch?: PatchMetadata;
    success: boolean;
    error?: string;
  }>;
};

/**
 * Mutator class: manages the self-modification mutation cycle.
 */
export class Mutator {
  private readonly statsDir?: string;
  private readonly policyPath?: string;
  private readonly workspaceDir?: string;

  constructor(params?: { statsDir?: string; policyPath?: string; workspaceDir?: string }) {
    this.statsDir = params?.statsDir;
    this.policyPath = params?.policyPath;
    this.workspaceDir = params?.workspaceDir;
  }

  /**
   * Identify tools with high error rates (hotspots).
   */
  async identifyHotspots(params?: {
    threshold?: number;
    minCalls?: number;
  }): Promise<ToolHotspot[]> {
    const errorRates = await getToolErrorRates({
      statsDir: this.statsDir,
      threshold: params?.threshold ?? 0.2, // 20% error rate
      minCalls: params?.minCalls ?? 5,
    });

    return errorRates.map((rate) => ({
      toolName: rate.toolName,
      errorRate: rate.errorRate,
      totalCalls: rate.totalCalls,
      errorCount: rate.errorCount,
    }));
  }

  /**
   * Identify system failures (build failures, gateway crashes, etc.).
   */
  async identifySystemFailures(): Promise<
    Array<{
      type: "build-failure" | "gateway-crash" | "runtime-error";
      error: string;
      timestamp: number;
      logs?: string;
    }>
  > {
    const failures: Array<{
      type: "build-failure" | "gateway-crash" | "runtime-error";
      error: string;
      timestamp: number;
      logs?: string;
    }> = [];

    // Check for recent build failures in recovery state
    try {
      const { resolveStateDir } = await import("../../config/paths.js");
      const { readFile } = await import("node:fs/promises");
      const { join } = await import("node:path");

      const recoveryStatePath = join(resolveStateDir(), "evolution", "recovery-state.json");
      try {
        const stateContent = await readFile(recoveryStatePath, "utf-8");
        const state = JSON.parse(stateContent) as {
          currentRecovery?: { error?: { code?: string }; startedAt?: number };
          history?: Array<{ error?: string; timestamp?: number; success?: boolean }>;
        };

        // Check current recovery
        if (state.currentRecovery && state.currentRecovery.startedAt) {
          const age = Date.now() - (state.currentRecovery.startedAt ?? 0);
          // If recovery started in last hour and is still active
          if (age < 3600000) {
            failures.push({
              type: "build-failure",
              error: state.currentRecovery.error?.code ?? "unknown",
              timestamp: state.currentRecovery.startedAt,
            });
          }
        }

        // Check recent failures in history
        if (state.history) {
          const recentFailures = state.history
            .filter((h) => !h.success && h.timestamp && Date.now() - h.timestamp < 3600000)
            .slice(0, 5); // Last 5 failures

          for (const failure of recentFailures) {
            failures.push({
              type: "build-failure",
              error: failure.error ?? "unknown",
              timestamp: failure.timestamp ?? Date.now(),
            });
          }
        }
      } catch {
        // Recovery state file doesn't exist or is invalid, that's fine
      }
    } catch {
      // Can't read recovery state, continue
    }

    return failures;
  }

  /**
   * Spawn a diagnostic agent to analyze a tool failure.
   * Waits for the agent to complete and extracts any patches from tool calls.
   */
  async spawnDiagnosticAgent(hotspot: ToolHotspot): Promise<DiagnosticResult> {
    // Get failing sessions for this tool
    const failingSessions = await getFailingToolSessions({
      toolName: hotspot.toolName,
      statsDir: this.statsDir,
      limit: 10,
    });

    // Map tool name to source file (simplified - would need a proper mapping)
    const sourceFile = this.mapToolToSourceFile(hotspot.toolName);

    // Build diagnostic prompt
    const prompt = buildDiagnosticAgentPrompt({
      toolName: hotspot.toolName,
      errorRate: hotspot.errorRate,
      failingSessions: failingSessions.map((s) => ({
        sessionId: s.sessionId,
        error: s.error,
        timestamp: s.timestamp,
      })),
      sourceFile,
      workspaceDir: this.workspaceDir,
    });

    // Spawn sub-agent via gateway and wait for completion
    const cfg = loadConfig();
    const childSessionKey = `agent:main:diagnostic:${Date.now()}`;

    try {
      // Step 1: Spawn the diagnostic agent
      const spawnResult = await callGateway<{ runId: string; status: string }>({
        method: "agent",
        params: {
          message: prompt,
          sessionKey: childSessionKey,
          idempotencyKey: `diag-${Date.now()}`,
          deliver: false,
          timeout: 300, // 5 minute timeout
          label: `diagnostic-${hotspot.toolName}`,
        },
        timeoutMs: 10_000,
      });

      if (!spawnResult?.runId) {
        return {
          toolName: hotspot.toolName,
          rootCause: "Failed to spawn diagnostic agent - no runId returned",
        };
      }

      // Step 2: Wait for the agent to complete
      const waitResult = await callGateway<{
        status: "ok" | "error" | "timeout";
        error?: string;
      }>({
        method: "agent.wait",
        params: {
          runId: spawnResult.runId,
          timeoutMs: 300_000, // 5 minutes
        },
        timeoutMs: 310_000,
      });

      if (waitResult?.status === "error") {
        return {
          toolName: hotspot.toolName,
          rootCause: `Diagnostic agent failed: ${waitResult.error ?? "unknown error"}`,
        };
      }

      if (waitResult?.status === "timeout") {
        return {
          toolName: hotspot.toolName,
          rootCause: "Diagnostic agent timed out",
        };
      }

      // Step 3: Read session transcript to extract patches
      const patchResult = await this.extractPatchFromSession(childSessionKey);

      return {
        toolName: hotspot.toolName,
        rootCause: patchResult.rootCause ?? "Analysis complete",
        proposedFix: patchResult.patch,
        patchId: patchResult.patchId,
      };
    } catch (err) {
      return {
        toolName: hotspot.toolName,
        rootCause: `Failed to spawn diagnostic agent: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  /**
   * Extract patch content from a session's tool calls.
   * Looks for apply_patch, edit, or evolution_propose_patch tool calls.
   */
  private async extractPatchFromSession(
    sessionKey: string,
  ): Promise<{ patch?: string; patchId?: string; rootCause?: string }> {
    try {
      // Read session history to find tool calls
      const historyResult = await callGateway<{
        messages?: Array<{
          role: string;
          content: unknown;
        }>;
      }>({
        method: "sessions.history",
        params: {
          sessionKey,
          includeTools: true,
          limit: 50,
        },
        timeoutMs: 10_000,
      });

      if (!historyResult?.messages) {
        return { rootCause: "No messages in session" };
      }

      // Look for tool calls in assistant messages
      for (const msg of historyResult.messages) {
        if (msg.role !== "assistant") continue;

        const content = Array.isArray(msg.content) ? msg.content : [];
        for (const block of content) {
          const blockObj = block as { type?: string; name?: string; input?: unknown };
          if (blockObj.type !== "tool_use") continue;

          // Check for apply_patch tool
          if (blockObj.name === "apply_patch") {
            const input = blockObj.input as { patch?: string } | undefined;
            if (input?.patch) {
              return { patch: input.patch };
            }
          }

          // Check for evolution_propose_patch tool
          if (blockObj.name === "evolution_propose_patch") {
            const input = blockObj.input as { patch?: string; rationale?: string } | undefined;
            if (input?.patch) {
              return { patch: input.patch, rootCause: input.rationale };
            }
          }

          // Check for edit tool (extract the change)
          if (blockObj.name === "edit" || blockObj.name === "Edit") {
            const input = blockObj.input as
              | {
                  file_path?: string;
                  path?: string;
                  old_string?: string;
                  oldText?: string;
                  new_string?: string;
                  newText?: string;
                }
              | undefined;
            if (input) {
              const filePath = input.file_path ?? input.path;
              const oldText = input.old_string ?? input.oldText;
              const newText = input.new_string ?? input.newText;
              if (filePath && oldText && newText) {
                // Convert edit to patch format
                const patch = this.editToPatch(filePath, oldText, newText);
                return { patch };
              }
            }
          }
        }
      }

      return { rootCause: "No patch found in session tool calls" };
    } catch (err) {
      return {
        rootCause: `Failed to extract patch: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  /**
   * Convert an edit operation to apply_patch format.
   */
  private editToPatch(filePath: string, oldText: string, newText: string): string {
    const oldLines = oldText.split("\n");
    const newLines = newText.split("\n");

    let patch = `*** Begin Patch\n`;
    patch += `*** Update File: ${filePath}\n`;
    patch += `@@@ -1,${oldLines.length} +1,${newLines.length} @@@\n`;

    for (const line of oldLines) {
      patch += `-${line}\n`;
    }
    for (const line of newLines) {
      patch += `+${line}\n`;
    }

    patch += `*** End Patch`;
    return patch;
  }

  /**
   * Map tool name to source file path.
   * This is a simplified mapping - in production, this would be more comprehensive.
   */
  private mapToolToSourceFile(toolName: string): string | undefined {
    // Common tool to file mappings
    const mappings: Record<string, string> = {
      browser: "src/agents/tools/browser-tool.ts",
      read: "src/agents/pi-tools.read.ts",
      write: "src/agents/pi-tools.write.ts",
      edit: "src/agents/pi-tools.edit.ts",
      exec: "src/agents/pi-tools.exec.ts",
      message: "src/agents/tools/message-tool.ts",
      sessions_send: "src/agents/tools/sessions-send-tool.ts",
      sessions_spawn: "src/agents/tools/sessions-spawn-tool.ts",
      cron: "src/agents/tools/cron-tool.ts",
      gateway: "src/agents/tools/gateway-tool.ts",
    };

    return mappings[toolName] ?? `src/agents/tools/${toolName}-tool.ts`;
  }

  /**
   * Propose a fix based on diagnostic result.
   * In a real implementation, this would extract the patch from the diagnostic agent's response.
   */
  async proposeFix(
    diagnosticResult: DiagnosticResult,
  ): Promise<{ patchId: string; patch: PatchMetadata } | null> {
    if (!diagnosticResult.proposedFix) {
      return null;
    }

    const policy = await loadSelfModificationPolicy(this.policyPath);
    const sourceFile = this.mapToolToSourceFile(diagnosticResult.toolName);

    if (!sourceFile || !checkPathAllowed(sourceFile, policy)) {
      throw new Error(`Source file ${sourceFile} is not allowed by self-modification policy`);
    }

    // Parse patch to extract file changes
    // This is simplified - real implementation would parse the actual patch format
    const patchFiles = [
      {
        path: sourceFile,
        added: diagnosticResult.proposedFix.split("\n").filter((l) => l.startsWith("+")).length,
        removed: diagnosticResult.proposedFix.split("\n").filter((l) => l.startsWith("-")).length,
        modified: 0,
      },
    ];

    // Validate patch
    const validation = await validatePatchSafety({ files: patchFiles }, policy);
    if (!validation.valid) {
      throw new Error(`Patch validation failed: ${validation.errors.join(", ")}`);
    }

    // Save patch
    const patchId = await savePatch(diagnosticResult.proposedFix, {
      rationale: diagnosticResult.rootCause,
      files: patchFiles,
    });

    const patch = await loadPatch(patchId);
    if (!patch) {
      throw new Error(`Failed to load patch ${patchId}`);
    }

    return { patchId, patch: patch.metadata };
  }

  /**
   * Validate patch in Dojo test suite.
   */
  async validateInDojo(
    patchId: string,
    task?: DojoTask,
  ): Promise<{ success: boolean; fitness?: number; error?: string }> {
    const patch = await loadPatch(patchId);
    if (!patch) {
      return { success: false, error: `Patch ${patchId} not found` };
    }

    // Load genotype
    const genotype = await loadGenotype({ genotypeDir: undefined });

    // If no specific task, use a default task that tests the tool
    const dojoTask = task ?? {
      id: `test-${patch.metadata.files[0]?.path ?? "unknown"}`,
      name: `Test ${patch.metadata.files[0]?.path ?? "patch"}`,
      description: `Validate patch ${patchId}`,
      prompt: `Verify that the changes in patch ${patchId} work correctly.`,
    };

    try {
      // Apply patch temporarily (in a sandbox)
      // Then run Dojo task
      // Then revert patch
      // This is simplified - real implementation would use proper sandboxing

      const result = await runDojoTask(dojoTask, genotype, {
        workspaceDir: this.workspaceDir,
      });

      await updatePatchStatus(patchId, result.success ? "applied" : "failed", {
        dojoTaskId: dojoTask.id,
        dojoResult: {
          success: result.success,
          fitness: result.fitness,
          error: result.success ? undefined : (result.stats.error ?? "Dojo validation failed"),
        },
      });

      return {
        success: result.success,
        fitness: result.fitness,
        error: result.success ? undefined : (result.stats.error ?? "Dojo validation failed"),
      };
    } catch (err) {
      await updatePatchStatus(patchId, "failed", {
        error: err instanceof Error ? err.message : String(err),
      });
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  /**
   * Commit patch and notify user.
   */
  async commitAndNotify(patch: PatchMetadata): Promise<void> {
    if (!this.workspaceDir) {
      throw new Error("Workspace directory required to apply patch");
    }

    const loadedPatch = await loadPatch(patch.id);
    if (!loadedPatch) {
      throw new Error(`Patch ${patch.id} not found`);
    }

    // Create backup
    const { backupId } = await createBackup(loadedPatch, this.workspaceDir);

    try {
      // Check regression tests
      const regressionResult = await checkRegressionTests(this.workspaceDir);
      if (!regressionResult.success) {
        await revertPatchOnFailure(patch.id, backupId, this.workspaceDir);
        throw new Error(`Regression tests failed: ${regressionResult.error}`);
      }

      // Apply patch
      const { applyPatchToCodebase } = await import("./patches.js");
      const result = await applyPatchToCodebase(patch.id, this.workspaceDir);

      if (!result.success) {
        await revertPatchOnFailure(patch.id, backupId, this.workspaceDir);
        throw new Error(`Failed to apply patch: ${result.error}`);
      }

      // Verify build passes
      const { execSync } = await import("node:child_process");
      try {
        execSync("pnpm build", {
          cwd: this.workspaceDir,
          stdio: "pipe",
          timeout: 120_000,
        });
      } catch (buildErr) {
        await revertPatchOnFailure(patch.id, backupId, this.workspaceDir);
        throw new Error(
          `Build failed after patch: ${buildErr instanceof Error ? buildErr.message : String(buildErr)}`,
        );
      }

      // Git commit the change
      try {
        const commitMsg = `fix(evolution): auto-fix via mutation cycle

Patch ID: ${patch.id}
Rationale: ${loadedPatch.metadata.rationale ?? "Automated fix"}

This commit was automatically generated by the self-evolution system.`;
        execSync(`git add -A && git commit -m "${commitMsg.replace(/"/g, '\\"')}"`, {
          cwd: this.workspaceDir,
          stdio: "pipe",
          timeout: 30_000,
        });
      } catch {
        // Git commit failure is non-fatal
      }

      // Trigger gateway restart to apply changes
      try {
        await callGateway({
          method: "restart",
          params: { reason: "self-evolution: mutation cycle complete" },
          timeoutMs: 5_000,
        });
      } catch {
        // Restart failure is non-fatal
      }
    } catch (err) {
      // Revert on any error
      await revertPatchOnFailure(patch.id, backupId, this.workspaceDir);
      throw err;
    }
  }

  /**
   * Run a full mutation cycle: identify hotspots, diagnose, propose fixes, validate, and apply.
   */
  async runMutationCycle(): Promise<MutationCycleResult> {
    const hotspots = await this.identifyHotspots();
    const results: MutationCycleResult["results"] = [];

    for (const hotspot of hotspots) {
      try {
        // Spawn diagnostic agent
        const diagnosticResult = await this.spawnDiagnosticAgent(hotspot);

        if (!diagnosticResult.proposedFix) {
          results.push({
            hotspot,
            diagnosticResult,
            success: false,
            error: "Diagnostic agent did not propose a fix",
          });
          continue;
        }

        // Propose fix
        const fixResult = await this.proposeFix(diagnosticResult);
        if (!fixResult) {
          results.push({
            hotspot,
            diagnosticResult,
            success: false,
            error: "Failed to propose fix",
          });
          continue;
        }

        // Validate in Dojo
        const validationResult = await this.validateInDojo(fixResult.patchId);
        if (!validationResult.success) {
          results.push({
            hotspot,
            diagnosticResult,
            patch: fixResult.patch,
            success: false,
            error: validationResult.error,
          });
          continue;
        }

        // Apply patch
        await this.commitAndNotify(fixResult.patch);

        results.push({
          hotspot,
          diagnosticResult,
          patch: fixResult.patch,
          success: true,
        });
      } catch (err) {
        results.push({
          hotspot,
          success: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return { results };
  }
}
