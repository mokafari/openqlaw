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

    // Spawn sub-agent via gateway
    const cfg = loadConfig();
    const agentId = "main"; // Default agent for diagnostic tasks

    try {
      const result = await callGateway({
        method: "agent",
        params: {
          sessionId: `agent:${agentId}:subagent:${Date.now()}`,
          message: prompt,
          workspaceDir: this.workspaceDir,
        },
      });

      // Extract diagnostic result from agent response
      // In a real implementation, the agent would use apply_patch tool
      // and we'd extract the patch from the tool call result
      return {
        toolName: hotspot.toolName,
        rootCause: "Analysis pending", // Would extract from agent response
        proposedFix: undefined, // Would extract from agent response
      };
    } catch (err) {
      return {
        toolName: hotspot.toolName,
        rootCause: `Failed to spawn diagnostic agent: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
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

      // Patch applied successfully
      // In a real implementation, would notify user via message tool or gateway
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
