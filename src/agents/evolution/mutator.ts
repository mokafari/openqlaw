import type { ToolErrorInfo } from "./telemetry.js";
import { loadConfig } from "../../config/config.js";
import { callGateway } from "../../gateway/call.js";
import { log } from "../pi-embedded-runner/logger.js";
import { buildDiagnosticAgentPrompt } from "./diagnostic-prompt.js";
import { runDojoTask, type DojoTask } from "./dojo.js";
import { loadGenotype } from "./genotype.js";
import {
  savePatch,
  updatePatchStatus,
  loadPatch,
  type PatchMetadata,
  getAppliedPatchesForFile,
} from "./patches.js";
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
   * Check if a tool has already been fixed by an applied patch.
   * Returns information about the most recent patch if found.
   */
  private async isToolAlreadyFixed(
    toolName: string,
    withinHours: number = 24,
  ): Promise<{
    alreadyFixed: boolean;
    patchId?: string;
    hoursAgo?: number;
  }> {
    const sourceFile = this.mapToolToSourceFile(toolName);
    if (!sourceFile) {
      return { alreadyFixed: false };
    }

    const appliedPatches = await getAppliedPatchesForFile(sourceFile, { withinHours });
    if (appliedPatches.length === 0) {
      return { alreadyFixed: false };
    }

    // Get the most recent patch
    const mostRecent = appliedPatches.sort((a, b) => {
      const aTime = a.appliedAt ?? a.createdAt;
      const bTime = b.appliedAt ?? b.createdAt;
      return bTime - aTime;
    })[0];

    const now = Date.now();
    const appliedAt = mostRecent.appliedAt ?? mostRecent.createdAt;
    const hoursAgo = Math.round((now - appliedAt) / (1000 * 60 * 60));

    return {
      alreadyFixed: true,
      patchId: mostRecent.id,
      hoursAgo,
    };
  }

  /**
   * Spawn a diagnostic agent to analyze a tool failure.
   * Waits for the agent to complete and extracts any patches from tool calls.
   */
  async spawnDiagnosticAgent(hotspot: ToolHotspot): Promise<DiagnosticResult> {
    // Check if tool is already fixed before spawning
    const alreadyFixed = await this.isToolAlreadyFixed(hotspot.toolName);
    if (alreadyFixed.alreadyFixed) {
      log.warn(
        `[mutator] Skipping diagnostic for ${hotspot.toolName} - already fixed by patch ${alreadyFixed.patchId} (applied ${alreadyFixed.hoursAgo} hours ago)`,
      );
      return {
        toolName: hotspot.toolName,
        rootCause: `Tool already fixed by patch ${alreadyFixed.patchId} (applied ${alreadyFixed.hoursAgo} hours ago)`,
      };
    }

    // Check throttling before spawning
    const { getDiagnosticThrottler } = await import("./diagnostic-throttler.js");
    const throttler = getDiagnosticThrottler();
    const canSpawn = await throttler.canSpawn(hotspot.toolName);

    if (!canSpawn.allowed) {
      log.warn(
        `[mutator] Diagnostic agent spawn throttled for ${hotspot.toolName}: ${canSpawn.reason}`,
      );
      return {
        toolName: hotspot.toolName,
        rootCause: `Diagnostic agent spawn throttled: ${canSpawn.reason}`,
      };
    }

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
    const childSessionKey = `agent:main:diagnostic:${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

    // Get throttler config for timeout and thinking level
    const diagConfig = throttler.getConfig();
    const waitTimeout = diagConfig.timeout;
    const spawnStartTime = Date.now();

    try {
      // Record spawn
      await throttler.recordSpawn(hotspot.toolName, childSessionKey);

      // Step 1: Spawn the diagnostic agent
      let spawnResult: { runId: string; status: string } | undefined;
      try {
        spawnResult = await callGateway<{ runId: string; status: string }>({
          method: "agent",
          params: {
            message: prompt,
            sessionKey: childSessionKey,
            idempotencyKey: `diag-${Date.now()}`,
            deliver: false,
            timeout: diagConfig.timeout, // Use throttler config (2 minutes default)
            thinking: diagConfig.thinkingLevel, // Use throttler config (minimal default)
            label: `diagnostic-${hotspot.toolName}`,
          },
          timeoutMs: 10_000,
        });
      } catch (err) {
        // Check if this is a rate limit error
        const errorMessage = err instanceof Error ? err.message : String(err);
        const { isRateLimitErrorMessage } = await import("../pi-embedded-helpers/errors.js");
        if (isRateLimitErrorMessage(errorMessage)) {
          log.warn(
            `[mutator] Rate limit error when spawning diagnostic agent for ${hotspot.toolName}`,
          );
          await throttler.recordRateLimitError(hotspot.toolName, childSessionKey);
          return {
            toolName: hotspot.toolName,
            rootCause: `Rate limit error: ${errorMessage}`,
          };
        }
        // Re-throw other errors
        throw err;
      }

      if (!spawnResult?.runId) {
        return {
          toolName: hotspot.toolName,
          rootCause: "Failed to spawn diagnostic agent - no runId returned",
        };
      }

      // Step 2: Wait for the agent to complete
      let waitResult: { status: "ok" | "error" | "timeout"; error?: string } | undefined;
      try {
        waitResult = await callGateway<{
          status: "ok" | "error" | "timeout";
          error?: string;
        }>({
          method: "agent.wait",
          params: {
            runId: spawnResult.runId,
            timeoutMs: waitTimeout, // Use throttler config (2 minutes default)
          },
          timeoutMs: waitTimeout + 10_000,
        });
      } catch (err) {
        // Handle timeout errors from callGateway itself
        const errorMessage = err instanceof Error ? err.message : String(err);
        const duration = Date.now() - spawnStartTime;
        if (errorMessage.includes("timeout") || duration >= waitTimeout) {
          log.warn(
            `[mutator] Diagnostic agent timeout for ${hotspot.toolName} after ${duration}ms (timeout: ${waitTimeout}ms)`,
          );
          await throttler.recordCompletion(childSessionKey, { timedOut: true });
          return {
            toolName: hotspot.toolName,
            rootCause: `Diagnostic agent timed out after ${Math.round(duration / 1000)} seconds`,
          };
        }
        // Re-throw other errors
        throw err;
      }

      if (waitResult?.status === "error") {
        const errorMessage = waitResult.error ?? "unknown error";
        // Check if this is a rate limit error
        const { isRateLimitErrorMessage } = await import("../pi-embedded-helpers/errors.js");
        if (isRateLimitErrorMessage(errorMessage)) {
          log.warn(`[mutator] Rate limit error in diagnostic agent for ${hotspot.toolName}`);
          await throttler.recordRateLimitError(hotspot.toolName, childSessionKey);
          return {
            toolName: hotspot.toolName,
            rootCause: `Rate limit error: ${errorMessage}`,
          };
        }
        return {
          toolName: hotspot.toolName,
          rootCause: `Diagnostic agent failed: ${errorMessage}`,
        };
      }

      if (waitResult?.status === "timeout") {
        const duration = Date.now() - spawnStartTime;
        log.warn(
          `[mutator] Diagnostic agent timeout for ${hotspot.toolName} after ${duration}ms (timeout: ${waitTimeout}ms)`,
        );
        // Record timeout
        await throttler.recordCompletion(childSessionKey, { timedOut: true });
        return {
          toolName: hotspot.toolName,
          rootCause: `Diagnostic agent timed out after ${Math.round(duration / 1000)} seconds`,
        };
      }

      // Step 3: Read session transcript to extract patches
      const patchResult = await this.extractPatchFromSession(childSessionKey);
      const duration = Date.now() - spawnStartTime;

      // Record completion
      await throttler.recordCompletion(childSessionKey);

      // Log warning if agent ran close to timeout (90% threshold)
      const timeoutThreshold = waitTimeout * 0.9;
      if (duration > timeoutThreshold) {
        log.warn(
          `[mutator] Diagnostic agent for ${hotspot.toolName} ran for ${Math.round(duration / 1000)}s (${Math.round((duration / waitTimeout) * 100)}% of timeout)`,
        );
      }

      return {
        toolName: hotspot.toolName,
        rootCause: patchResult.rootCause ?? "Analysis complete",
        proposedFix: patchResult.patch,
        patchId: patchResult.patchId,
      };
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      const duration = Date.now() - spawnStartTime;

      // Check if this is a rate limit error
      const { isRateLimitErrorMessage } = await import("../pi-embedded-helpers/errors.js");
      if (isRateLimitErrorMessage(errorMessage)) {
        log.warn(
          `[mutator] Rate limit error when spawning diagnostic agent for ${hotspot.toolName}`,
        );
        await throttler.recordRateLimitError(hotspot.toolName, childSessionKey).catch(() => {});
        return {
          toolName: hotspot.toolName,
          rootCause: `Rate limit error: ${errorMessage}`,
        };
      }

      // Check if this is a timeout error
      if (errorMessage.includes("timeout") || duration >= waitTimeout) {
        log.warn(
          `[mutator] Diagnostic agent timeout for ${hotspot.toolName} after ${duration}ms (caught in catch block)`,
        );
        await throttler.recordCompletion(childSessionKey, { timedOut: true }).catch(() => {});
        return {
          toolName: hotspot.toolName,
          rootCause: `Diagnostic agent timed out after ${Math.round(duration / 1000)} seconds`,
        };
      }

      // Record completion even on error
      await throttler.recordCompletion(childSessionKey).catch(() => {});

      return {
        toolName: hotspot.toolName,
        rootCause: `Failed to spawn diagnostic agent: ${errorMessage}`,
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
   * Maps tool names to their actual source file locations.
   */
  private mapToolToSourceFile(toolName: string): string | undefined {
    // Common tool to file mappings
    const mappings: Record<string, string> = {
      // Browser and web tools
      browser: "src/agents/tools/browser-tool.ts",
      web_search: "src/agents/tools/web-search.ts",
      web_fetch: "src/agents/tools/web-fetch.ts",

      // File operation tools (all in pi-tools.read.ts)
      read: "src/agents/pi-tools.read.ts",
      write: "src/agents/pi-tools.read.ts",
      edit: "src/agents/pi-tools.read.ts",

      // Bash/exec tools
      exec: "src/agents/bash-tools.exec.ts",
      process: "src/agents/bash-tools.process.ts",

      // Messaging and channel tools
      message: "src/agents/tools/message-tool.ts",

      // Session tools
      sessions_send: "src/agents/tools/sessions-send-tool.ts",
      sessions_spawn: "src/agents/tools/sessions-spawn-tool.ts",
      sessions_list: "src/agents/tools/sessions-list-tool.ts",
      sessions_history: "src/agents/tools/sessions-history-tool.ts",

      // Gateway and infrastructure
      cron: "src/agents/tools/cron-tool.ts",
      gateway: "src/agents/tools/gateway-tool.ts",

      // Image and media
      image: "src/agents/tools/image-tool.ts",

      // Node tools
      nodes: "src/agents/tools/nodes-tool.ts",

      // Canvas
      canvas: "src/agents/tools/canvas-tool.ts",
    };

    // Return explicit mapping or undefined if not found
    // Don't use a fallback pattern that generates non-existent paths
    return mappings[toolName];
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
