import { listPatches, loadPatch, updatePatchStatus } from "../agents/evolution/patches.js";
import { log } from "../agents/pi-embedded-runner/logger.js";

/**
 * Clean up obsolete pending patches that address issues already fixed.
 */
export async function cleanupObsoletePatches(params?: {
  dryRun?: boolean;
  workspaceDir?: string;
}): Promise<{
  cleaned: number;
  kept: number;
  errors: string[];
}> {
  const dryRun = params?.dryRun ?? false;
  const cleaned: string[] = [];
  const kept: string[] = [];
  const errors: string[] = [];

  try {
    const pendingPatches = await listPatches("pending");

    // Known fixed issues (from recent commits)
    const fixedIssues = [
      "mapToolToSourceFile",
      "tool-to-source-file",
      "tool-to-file mapping",
      "workspaceRoot",
      "path resolution",
      "createOpenClawReadTool",
    ];

    for (const patchMeta of pendingPatches) {
      const patch = await loadPatch(patchMeta.id);
      if (!patch) {
        errors.push(`Failed to load patch ${patchMeta.id}`);
        continue;
      }

      const rationale = patch.metadata.rationale.toLowerCase();
      const isObsolete = fixedIssues.some((issue) => rationale.includes(issue.toLowerCase()));

      if (isObsolete) {
        if (dryRun) {
          log.info(`[cleanup] Would remove obsolete patch: ${patchMeta.id}`);
          cleaned.push(patchMeta.id);
        } else {
          try {
            // Move to failed with explanation
            await updatePatchStatus(patchMeta.id, "failed", {
              error: "Obsolete: Issue already fixed in recent commits",
            });
            log.info(`[cleanup] Marked obsolete patch as failed: ${patchMeta.id}`);
            cleaned.push(patchMeta.id);
          } catch (err) {
            errors.push(`Failed to update patch ${patchMeta.id}: ${err}`);
          }
        }
      } else {
        kept.push(patchMeta.id);
      }
    }

    return { cleaned: cleaned.length, kept: kept.length, errors };
  } catch (err) {
    log.error(`[cleanup] Cleanup failed: ${err}`);
    return { cleaned: 0, kept: 0, errors: [String(err)] };
  }
}

/**
 * Review and add error messages to failed patches that are missing them.
 */
export async function fixFailedPatchErrors(): Promise<{
  fixed: number;
  errors: string[];
}> {
  const fixed: string[] = [];
  const errors: string[] = [];

  try {
    const failedPatches = await listPatches("failed");

    for (const patchMeta of failedPatches) {
      const patch = await loadPatch(patchMeta.id);
      if (!patch) {
        errors.push(`Failed to load patch ${patchMeta.id}`);
        continue;
      }

      // If error is missing or null, try to infer from patch content or status
      if (!patch.metadata.error || patch.metadata.error === "null") {
        // Try to infer error from patch metadata
        let inferredError = "Unknown error - patch failed validation or application";

        // Check if there's a dojoResult with error
        if (patch.metadata.dojoResult?.error) {
          inferredError = `Dojo validation failed: ${patch.metadata.dojoResult.error}`;
        } else if (patch.metadata.dojoResult?.success === false) {
          inferredError = "Dojo validation failed";
        } else if (patch.metadata.status === "failed") {
          inferredError = "Patch application or validation failed";
        }

        try {
          await updatePatchStatus(patchMeta.id, "failed", {
            error: inferredError,
          });
          log.info(`[fix-errors] Added error message to patch ${patchMeta.id}`);
          fixed.push(patchMeta.id);
        } catch (err) {
          errors.push(`Failed to update patch ${patchMeta.id}: ${err}`);
        }
      }
    }

    return { fixed: fixed.length, errors };
  } catch (err) {
    log.error(`[fix-errors] Fix failed: ${err}`);
    return { fixed: 0, errors: [String(err)] };
  }
}
