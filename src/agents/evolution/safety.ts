import { promises as fs } from "fs";
import path from "path";
import type { Patch, PatchMetadata } from "./patches.js";
import type { SelfModificationPolicy, PatchValidationResult } from "./self-modification-policy.js";
import { resolveStateDir } from "../../config/paths.js";
import { validatePatch, isPathAllowed } from "./self-modification-policy.js";

/**
 * Validate patch safety against policy and other constraints.
 */
export async function validatePatchSafety(
  patch: { files: Array<{ path: string; added?: number; removed?: number; modified?: number }> },
  policy: SelfModificationPolicy,
): Promise<PatchValidationResult> {
  return validatePatch(patch, policy);
}

/**
 * Create a backup of files before applying a patch.
 */
export async function createBackup(
  patch: Patch,
  workspaceDir: string,
): Promise<{ backupId: string; backupPath: string }> {
  const backupId = `backup-${Date.now()}-${patch.metadata.id.slice(0, 8)}`;
  const backupDir = path.join(resolveStateDir(), "evolution", "backups", backupId);
  await fs.mkdir(backupDir, { recursive: true });

  // Backup each file in the patch
  for (const file of patch.metadata.files) {
    const sourcePath = path.join(workspaceDir, file.path);
    const backupPath = path.join(backupDir, file.path);

    try {
      // Ensure backup directory structure exists
      await fs.mkdir(path.dirname(backupPath), { recursive: true });

      // Copy file to backup
      await fs.copyFile(sourcePath, backupPath);
    } catch (err) {
      // File might not exist (new file), continue
      if ((err as { code?: string }).code !== "ENOENT") {
        throw err;
      }
    }
  }

  // Save backup metadata
  const backupMetadata = {
    backupId,
    patchId: patch.metadata.id,
    createdAt: Date.now(),
    files: patch.metadata.files.map((f) => f.path),
  };
  await fs.writeFile(
    path.join(backupDir, "metadata.json"),
    JSON.stringify(backupMetadata, null, 2),
    "utf-8",
  );

  return { backupId, backupPath: backupDir };
}

/**
 * Restore files from backup.
 */
export async function restoreFromBackup(backupId: string, workspaceDir: string): Promise<void> {
  const backupDir = path.join(resolveStateDir(), "evolution", "backups", backupId);
  const metadataFile = path.join(backupDir, "metadata.json");

  try {
    const metadataContent = await fs.readFile(metadataFile, "utf-8");
    const metadata = JSON.parse(metadataContent) as { files: string[] };

    for (const filePath of metadata.files) {
      const backupPath = path.join(backupDir, filePath);
      const targetPath = path.join(workspaceDir, filePath);

      try {
        // Ensure target directory exists
        await fs.mkdir(path.dirname(targetPath), { recursive: true });

        // Restore file
        await fs.copyFile(backupPath, targetPath);
      } catch (err) {
        // File might not exist in backup (was new file), delete it
        if ((err as { code?: string }).code === "ENOENT") {
          try {
            await fs.unlink(targetPath);
          } catch {
            // File doesn't exist, that's fine
          }
        } else {
          throw err;
        }
      }
    }
  } catch (err) {
    if ((err as { code?: string }).code === "ENOENT") {
      throw new Error(`Backup ${backupId} not found`);
    }
    throw err;
  }
}

/**
 * Check if existing tests still pass (regression testing).
 * This runs `pnpm test` to ensure the patch doesn't break existing functionality.
 */
export async function checkRegressionTests(
  workspaceDir: string,
): Promise<{ success: boolean; error?: string; output?: string }> {
  const { runCommandWithTimeout } = await import("../../process/exec.js");
  try {
    // Run pnpm test command
    const result = await runCommandWithTimeout(["pnpm", "test"], {
      timeoutMs: 300_000, // 5 minutes timeout
      cwd: workspaceDir,
    });

    if (result.code === 0) {
      return { success: true, output: result.stdout };
    } else {
      return {
        success: false,
        error: `Tests failed with exit code ${result.code ?? "unknown"}`,
        output: result.stderr || result.stdout,
      };
    }
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Revert a patch if validation fails.
 */
export async function revertPatchOnFailure(
  patchId: string,
  backupId: string,
  workspaceDir: string,
): Promise<void> {
  try {
    await restoreFromBackup(backupId, workspaceDir);
    const { updatePatchStatus } = await import("./patches.js");
    await updatePatchStatus(patchId, "reverted", {
      error: "Reverted due to validation failure",
    });
  } catch (err) {
    // Log error but don't throw - we want to report the failure
    console.error(`Failed to revert patch ${patchId}:`, err);
  }
}
