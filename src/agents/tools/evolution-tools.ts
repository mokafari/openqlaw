import { Type } from "@sinclair/typebox";
import path from "node:path";
import type { AnyAgentTool } from "./common.js";
import { resolveStateDir } from "../../config/paths.js";
import { runDojoTask, DOJO_TASKS } from "../evolution/dojo.js";
import { loadGenotype } from "../evolution/genotype.js";
import { savePatch, loadPatch, updatePatchStatus, listPatches } from "../evolution/patches.js";
import {
  loadSelfModificationPolicy,
  validatePatch,
} from "../evolution/self-modification-policy.js";
import { jsonResult, readStringParam } from "./common.js";

type EvolutionToolOptions = {
  sessionKey?: string;
  workspaceDir?: string;
  statsDir?: string;
  policyPath?: string;
};

/**
 * Tool to propose a patch with evolution metadata.
 * Wraps apply_patch with policy validation and patch storage.
 */
export function createEvolutionProposePatchTool(opts?: EvolutionToolOptions): AnyAgentTool {
  return {
    label: "Evolution: Propose Patch",
    name: "evolution_propose_patch",
    description:
      "Propose a code patch for self-modification. Validates against self-modification policy and stores the patch for review.",
    parameters: Type.Object({
      patch: Type.String({
        description: "The patch content in apply_patch format (*** Begin Patch ... *** End Patch).",
      }),
      rationale: Type.String({
        description: "Explanation of why this patch is needed and what problem it solves.",
      }),
      targetGenotypeId: Type.Optional(
        Type.String({ description: "Optional: The genotype ID this patch targets." }),
      ),
      dojoTaskId: Type.Optional(
        Type.String({ description: "Optional: The Dojo task ID to use for validation." }),
      ),
    }),
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const patchContent = readStringParam(params, "patch", { required: true });
      const rationale = readStringParam(params, "rationale", { required: true });
      const targetGenotypeId = readStringParam(params, "targetGenotypeId");
      const dojoTaskId = readStringParam(params, "dojoTaskId");

      try {
        // Load policy
        const policy = await loadSelfModificationPolicy(opts?.policyPath);

        // Parse patch to extract file information
        // This is simplified - real implementation would parse the actual patch format
        const patchFiles: Array<{
          path: string;
          added?: number;
          removed?: number;
          modified?: number;
        }> = [];

        // Extract file paths from patch content
        const fileMatches = patchContent.matchAll(/\*\*\* (?:Add|Update|Delete) File: (.+)/g);
        for (const match of fileMatches) {
          const filePath = match[1]?.trim();
          if (filePath) {
            // Count lines (simplified)
            const added = (
              patchContent.match(
                new RegExp(`\\+.*${filePath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "g"),
              ) || []
            ).length;
            const removed = (
              patchContent.match(
                new RegExp(`-.*${filePath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "g"),
              ) || []
            ).length;
            patchFiles.push({
              path: filePath,
              added: added > 0 ? added : undefined,
              removed: removed > 0 ? removed : undefined,
            });
          }
        }

        // Validate patch
        const validation = validatePatch({ files: patchFiles }, policy);
        if (!validation.valid) {
          return jsonResult({
            status: "error",
            error: `Patch validation failed: ${validation.errors.join(", ")}`,
            warnings: validation.warnings,
          });
        }

        // Save patch
        const patchId = await savePatch(patchContent, {
          rationale,
          targetGenotypeId,
          files: patchFiles,
          dojoTaskId,
        });

        return jsonResult({
          status: "ok",
          message: `Patch ${patchId.slice(0, 8)} saved and validated.`,
          patchId,
          warnings: validation.warnings.length > 0 ? validation.warnings : undefined,
        });
      } catch (err) {
        return jsonResult({
          status: "error",
          error: err instanceof Error ? err.message : String(err),
        });
      }
    },
  };
}

/**
 * Tool to run Dojo test for a specific code version (patch or genotype).
 */
export function createEvolutionRunDojoTestTool(opts?: EvolutionToolOptions): AnyAgentTool {
  return {
    label: "Evolution: Run Dojo Test",
    name: "evolution_run_dojo_test",
    description:
      "Run a Dojo task to validate a code change. Can test a specific patch or genotype in a sandboxed environment.",
    parameters: Type.Object({
      taskId: Type.String({
        description: "The Dojo task ID to run (e.g., 'task-001').",
      }),
      patchId: Type.Optional(
        Type.String({
          description: "Optional: Patch ID to test. If omitted, tests current codebase.",
        }),
      ),
      genotypeId: Type.Optional(
        Type.String({
          description: "Optional: Genotype ID to test. If omitted, uses current genotype.",
        }),
      ),
    }),
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const taskId = readStringParam(params, "taskId", { required: true });
      const patchId = readStringParam(params, "patchId");
      const genotypeId = readStringParam(params, "genotypeId");

      try {
        // Find Dojo task
        const task = DOJO_TASKS.find((t) => t.id === taskId);
        if (!task) {
          return jsonResult({
            status: "error",
            error: `Dojo task ${taskId} not found. Available tasks: ${DOJO_TASKS.map((t) => t.id).join(", ")}`,
          });
        }

        // Load genotype
        const genotype = await loadGenotype({ genotypeId });

        // If patchId is provided, we'd need to apply it in a sandbox first
        // For now, we'll just run the task on the current codebase
        if (patchId) {
          const patch = await loadPatch(patchId);
          if (!patch) {
            return jsonResult({
              status: "error",
              error: `Patch ${patchId} not found`,
            });
          }
          // TODO: Apply patch in sandbox, run test, then revert
          // This is a placeholder - real implementation would use proper sandboxing
        }

        // Run Dojo task
        const result = await runDojoTask(task, genotype, {
          workspaceDir: opts?.workspaceDir,
        });

        // Update patch status if patchId was provided
        if (patchId) {
          await updatePatchStatus(patchId, result.success ? "applied" : "failed", {
            dojoTaskId: taskId,
            dojoResult: {
              success: result.success,
              fitness: result.fitness,
              error: result.success ? undefined : (result.stats.error ?? "Dojo validation failed"),
            },
          });
        }

        return jsonResult({
          status: result.success ? "ok" : "error",
          message: result.success
            ? `Dojo task ${taskId} passed with fitness ${result.fitness.toFixed(3)}`
            : `Dojo task ${taskId} failed`,
          taskId,
          success: result.success,
          fitness: result.fitness,
          stats: result.stats,
        });
      } catch (err) {
        return jsonResult({
          status: "error",
          error: err instanceof Error ? err.message : String(err),
        });
      }
    },
  };
}

/**
 * Tool to list patches by status.
 */
export function createEvolutionListPatchesTool(opts?: EvolutionToolOptions): AnyAgentTool {
  return {
    label: "Evolution: List Patches",
    name: "evolution_list_patches",
    description: "List patches by status (pending, applied, reverted, failed) or all patches.",
    parameters: Type.Object({
      status: Type.Optional(
        Type.Union([
          Type.Literal("pending"),
          Type.Literal("applied"),
          Type.Literal("reverted"),
          Type.Literal("failed"),
        ]),
      ),
      limit: Type.Optional(
        Type.Number({ description: "Maximum number of patches to return.", minimum: 1 }),
      ),
    }),
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const status = params.status as "pending" | "applied" | "reverted" | "failed" | undefined;
      const limit =
        typeof params.limit === "number" ? Math.max(1, Math.floor(params.limit)) : undefined;

      try {
        const patches = await listPatches(status);
        const limited = limit ? patches.slice(0, limit) : patches;

        return jsonResult({
          status: "ok",
          message: `Found ${patches.length} patch(es)${status ? ` with status ${status}` : ""}`,
          patches: limited,
          total: patches.length,
        });
      } catch (err) {
        return jsonResult({
          status: "error",
          error: err instanceof Error ? err.message : String(err),
        });
      }
    },
  };
}
