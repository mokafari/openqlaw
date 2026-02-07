import { promises as fs } from "fs";
import crypto from "node:crypto";
import path from "path";
import { resolveStateDir } from "../../config/paths.js";

export type PatchStatus = "pending" | "applied" | "reverted" | "failed";

export type PatchMetadata = {
  id: string;
  status: PatchStatus;
  createdAt: number;
  appliedAt?: number;
  revertedAt?: number;
  rationale: string;
  targetGenotypeId?: string;
  files: Array<{
    path: string;
    added?: number;
    removed?: number;
    modified?: number;
  }>;
  dojoTaskId?: string;
  dojoResult?: {
    success: boolean;
    fitness?: number;
    error?: string;
  };
  error?: string;
};

export type Patch = {
  metadata: PatchMetadata;
  content: string; // The actual patch content (diff format)
};

const PATCHES_DIR = path.join(resolveStateDir(), "evolution", "patches");

/**
 * Get directory for patches by status.
 */
function getPatchDir(status: PatchStatus): string {
  return path.join(PATCHES_DIR, status);
}

/**
 * Save a patch to the pending directory.
 */
export async function savePatch(
  patchContent: string,
  metadata: Omit<PatchMetadata, "id" | "createdAt" | "status">,
): Promise<string> {
  const patchId = crypto.randomUUID();
  const patch: Patch = {
    metadata: {
      ...metadata,
      id: patchId,
      status: "pending",
      createdAt: Date.now(),
    },
    content: patchContent,
  };

  const patchDir = getPatchDir("pending");
  await fs.mkdir(patchDir, { recursive: true });

  const patchFile = path.join(patchDir, `${patchId}.json`);
  await fs.writeFile(patchFile, JSON.stringify(patch, null, 2), "utf-8");

  return patchId;
}

/**
 * Load a patch by ID.
 */
export async function loadPatch(patchId: string): Promise<Patch | null> {
  // Search in all status directories
  for (const status of ["pending", "applied", "reverted", "failed"] as PatchStatus[]) {
    const patchFile = path.join(getPatchDir(status), `${patchId}.json`);
    try {
      const content = await fs.readFile(patchFile, "utf-8");
      return JSON.parse(content) as Patch;
    } catch {
      // Continue searching
    }
  }
  return null;
}

/**
 * Update patch status and move to appropriate directory.
 */
export async function updatePatchStatus(
  patchId: string,
  status: PatchStatus,
  updates?: Partial<Omit<PatchMetadata, "id" | "createdAt" | "status">>,
): Promise<void> {
  const patch = await loadPatch(patchId);
  if (!patch) {
    throw new Error(`Patch ${patchId} not found`);
  }

  // Remove from old directory
  const oldDir = getPatchDir(patch.metadata.status);
  const oldFile = path.join(oldDir, `${patchId}.json`);
  try {
    await fs.unlink(oldFile);
  } catch {
    // File might not exist, continue
  }

  // Update metadata
  patch.metadata.status = status;
  if (status === "applied") {
    patch.metadata.appliedAt = Date.now();
  } else if (status === "reverted") {
    patch.metadata.revertedAt = Date.now();
  }
  if (updates) {
    Object.assign(patch.metadata, updates);
  }

  // Save to new directory
  const newDir = getPatchDir(status);
  await fs.mkdir(newDir, { recursive: true });
  const newFile = path.join(newDir, `${patchId}.json`);
  await fs.writeFile(newFile, JSON.stringify(patch, null, 2), "utf-8");
}

/**
 * List patches by status.
 */
export async function listPatches(status?: PatchStatus): Promise<PatchMetadata[]> {
  const statuses: PatchStatus[] = status ? [status] : ["pending", "applied", "reverted", "failed"];
  const patches: PatchMetadata[] = [];

  for (const s of statuses) {
    const dir = getPatchDir(s);
    try {
      const files = await fs.readdir(dir);
      for (const file of files) {
        if (file.endsWith(".json")) {
          try {
            const content = await fs.readFile(path.join(dir, file), "utf-8");
            const patch = JSON.parse(content) as Patch;
            patches.push(patch.metadata);
          } catch {
            // Skip malformed files
            continue;
          }
        }
      }
    } catch {
      // Directory doesn't exist, continue
    }
  }

  // Sort by creation time (newest first)
  return patches.sort((a, b) => b.createdAt - a.createdAt);
}

/**
 * Get patch history (all patches).
 */
export async function getPatchHistory(): Promise<PatchMetadata[]> {
  return listPatches();
}

/**
 * Get applied patches for a specific file path.
 * Returns patches that target the given file, sorted by application time (newest first).
 */
export async function getAppliedPatchesForFile(
  filePath: string,
  options?: { withinHours?: number },
): Promise<PatchMetadata[]> {
  const appliedPatches = await listPatches("applied");
  const now = Date.now();
  const withinMs = (options?.withinHours ?? 24) * 3600_000;

  return appliedPatches
    .filter((patch) => {
      // Check if patch targets this file
      const targetsFile = patch.files.some((f) => f.path === filePath);
      if (!targetsFile) {
        return false;
      }

      // Filter by time if specified
      if (options?.withinHours && patch.appliedAt) {
        return now - patch.appliedAt < withinMs;
      }

      return true;
    })
    .sort((a, b) => (b.appliedAt ?? 0) - (a.appliedAt ?? 0));
}

/**
 * Apply a patch to the codebase.
 * This is a wrapper that validates and applies the patch using the apply_patch tool.
 */
export async function applyPatchToCodebase(
  patchId: string,
  workspaceDir: string,
): Promise<{ success: boolean; error?: string }> {
  const patch = await loadPatch(patchId);
  if (!patch) {
    return { success: false, error: `Patch ${patchId} not found` };
  }

  if (patch.metadata.status !== "pending") {
    return { success: false, error: `Patch ${patchId} is not in pending status` };
  }

  try {
    // Import apply_patch function
    const { applyPatch } = await import("../../agents/apply-patch.js");
    await applyPatch(patch.content, {
      cwd: workspaceDir,
    });

    await updatePatchStatus(patchId, "applied");
    return { success: true };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    await updatePatchStatus(patchId, "failed", { error });
    return { success: false, error };
  }
}

/**
 * Revert a patch by restoring files from git or backup.
 */
export async function revertPatch(
  patchId: string,
  workspaceDir?: string,
): Promise<{ success: boolean; error?: string }> {
  const patch = await loadPatch(patchId);
  if (!patch) {
    return { success: false, error: `Patch ${patchId} not found` };
  }

  if (patch.metadata.status !== "applied") {
    return { success: false, error: `Patch ${patchId} is not in applied status` };
  }

  const cwd = workspaceDir ?? process.cwd();

  try {
    // Get list of files affected by this patch
    const affectedFiles = patch.metadata.files.map((f) => f.path);

    if (affectedFiles.length === 0) {
      // No files to revert, just mark as reverted
      await updatePatchStatus(patchId, "reverted");
      return { success: true };
    }

    // Try to revert using git checkout
    const { execSync } = await import("node:child_process");

    for (const file of affectedFiles) {
      try {
        // First try: restore from git HEAD
        execSync(`git checkout HEAD -- "${file}"`, {
          cwd,
          stdio: "pipe",
          encoding: "utf-8",
        });
      } catch {
        // If file wasn't in git, try to remove it (it was added by patch)
        try {
          const filePath = path.join(cwd, file);
          await fs.unlink(filePath);
        } catch {
          // File doesn't exist or can't be removed, continue
        }
      }
    }

    await updatePatchStatus(patchId, "reverted");
    return { success: true };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    await updatePatchStatus(patchId, "failed", { error: `Revert failed: ${error}` });
    return { success: false, error };
  }
}

/**
 * Create a backup of files before patching.
 */
export async function createPatchBackup(
  patchId: string,
  files: string[],
  workspaceDir?: string,
): Promise<{ backupDir: string }> {
  const cwd = workspaceDir ?? process.cwd();
  const backupDir = path.join(PATCHES_DIR, "backups", patchId);
  await fs.mkdir(backupDir, { recursive: true });

  for (const file of files) {
    const srcPath = path.join(cwd, file);
    const destPath = path.join(backupDir, file);

    try {
      // Create directory structure
      await fs.mkdir(path.dirname(destPath), { recursive: true });
      // Copy file
      await fs.copyFile(srcPath, destPath);
    } catch {
      // File might not exist (new file), continue
    }
  }

  return { backupDir };
}

/**
 * Restore files from backup.
 */
export async function restoreFromBackup(
  patchId: string,
  workspaceDir?: string,
): Promise<{ success: boolean; error?: string }> {
  const cwd = workspaceDir ?? process.cwd();
  const backupDir = path.join(PATCHES_DIR, "backups", patchId);

  try {
    const files = await fs.readdir(backupDir, { recursive: true, withFileTypes: false });

    for (const file of files) {
      const fileStr = String(file);
      const srcPath = path.join(backupDir, fileStr);
      const destPath = path.join(cwd, fileStr);

      try {
        const stat = await fs.stat(srcPath);
        if (stat.isFile()) {
          await fs.mkdir(path.dirname(destPath), { recursive: true });
          await fs.copyFile(srcPath, destPath);
        }
      } catch {
        // Skip files that can't be stat'd
      }
    }

    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
