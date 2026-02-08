import { promises as fs } from "fs";
import crypto from "node:crypto";
import path from "path";
import { resolveStateDir } from "../../config/paths.js";
import { NotFoundError } from "../errors.js";
import { log } from "../pi-embedded-runner/logger.js";
import {
  parseApplyPatchFormat,
  parsePatch,
  detectConflicts,
  applyPatchAdvanced,
  analyzePatchSemantics,
  type ParsedPatch,
  type PatchConflict,
  type PatchApplicationResult,
} from "./patch-parser-advanced.js";
import {
  verifyPatch,
  logVerification,
  summarizeVerification,
  type PatchVerification,
} from "./patch-verifier.js";

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
  // Advanced parser metadata
  semantics?: {
    type: "feature" | "bugfix" | "refactor" | "config" | "test" | "unknown";
    affectedModules: string[];
    complexity: "low" | "medium" | "high";
    riskLevel: "low" | "medium" | "high";
  };
  applicationResult?: {
    fuzzyMatches: Array<{
      file: string;
      hunkIndex: number;
      offset: number;
      similarity: number;
    }>;
    conflicts: PatchConflict[];
  };
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
  const statuses = ["pending", "applied", "reverted", "failed"] as PatchStatus[];
  for (const status of statuses) {
    const patchFile = path.join(getPatchDir(status), `${patchId}.json`);
    try {
      const content = await fs.readFile(patchFile, "utf-8");
      return JSON.parse(content) as Patch;
    } catch (err) {
      // Expected: patch may not be in this status directory
      // Only log parse errors, not ENOENT
      const code = (err as NodeJS.ErrnoException)?.code;
      if (code !== "ENOENT") {
        log.debug(
          `[patches] loadPatch: Error reading ${patchFile}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
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
    const searchedDirs = (["pending", "applied", "reverted", "failed"] as PatchStatus[]).map((s) =>
      getPatchDir(s),
    );
    throw new NotFoundError("Patch", patchId, searchedDirs);
  }

  // Remove from old directory
  const oldDir = getPatchDir(patch.metadata.status);
  const oldFile = path.join(oldDir, `${patchId}.json`);
  try {
    await fs.unlink(oldFile);
  } catch (err) {
    // File might not exist if status was already updated
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code !== "ENOENT") {
      log.warn(
        `[patches] updatePatchStatus: Could not remove old file ${oldFile}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
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
          const filePath = path.join(dir, file);
          try {
            const content = await fs.readFile(filePath, "utf-8");
            const patch = JSON.parse(content) as Patch;
            patches.push(patch.metadata);
          } catch (err) {
            // Log malformed files for debugging but continue
            log.warn(
              `[patches] listPatches: Skipping malformed file ${filePath}: ${err instanceof Error ? err.message : String(err)}`,
            );
            continue;
          }
        }
      }
    } catch (err) {
      // Directory doesn't exist is expected for new installations
      const code = (err as NodeJS.ErrnoException)?.code;
      if (code !== "ENOENT") {
        log.debug(
          `[patches] listPatches: Error reading directory ${dir}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
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
 * Apply a patch to the codebase using the advanced parser.
 * Features:
 * - Conflict detection before application
 * - Fuzzy matching for better success rates
 * - Semantic analysis of patch content
 */
export async function applyPatchToCodebase(
  patchId: string,
  workspaceDir: string,
  options?: {
    fuzzyMatch?: boolean;
    maxFuzzyOffset?: number;
    dryRun?: boolean;
    skipConflictCheck?: boolean;
  },
): Promise<{
  success: boolean;
  error?: string;
  conflicts?: PatchConflict[];
  applicationResult?: PatchApplicationResult;
}> {
  const patch = await loadPatch(patchId);
  if (!patch) {
    return { success: false, error: `Patch ${patchId} not found` };
  }

  if (patch.metadata.status !== "pending") {
    return { success: false, error: `Patch ${patchId} is not in pending status` };
  }

  try {
    // Parse the patch using the advanced parser
    const parsedPatch = patch.content.includes("*** Begin Patch")
      ? parseApplyPatchFormat(patch.content)
      : parsePatch(patch.content);

    // Run conflict detection unless skipped
    if (!options?.skipConflictCheck) {
      const conflicts = await detectConflicts(parsedPatch, workspaceDir);
      const blockingConflicts = conflicts.filter((c) => c.type !== "already_applied");

      if (blockingConflicts.length > 0) {
        await updatePatchStatus(patchId, "failed", {
          error: `Conflicts detected: ${blockingConflicts.map((c) => c.description).join("; ")}`,
        });
        return {
          success: false,
          error: "Patch has conflicts that prevent application",
          conflicts: blockingConflicts,
        };
      }

      // If all hunks are already applied, mark as applied without error
      const alreadyApplied = conflicts.filter((c) => c.type === "already_applied");
      if (alreadyApplied.length > 0 && alreadyApplied.length === conflicts.length) {
        await updatePatchStatus(patchId, "applied", {
          applicationResult: {
            fuzzyMatches: [],
            conflicts: alreadyApplied,
          },
        });
        return {
          success: true,
          conflicts: alreadyApplied,
          applicationResult: {
            success: true,
            applied: [],
            failed: [],
            conflicts: alreadyApplied,
            fuzzyMatches: [],
          },
        };
      }
    }

    // Apply the patch with fuzzy matching
    const result = await applyPatchAdvanced(parsedPatch, workspaceDir, {
      dryRun: options?.dryRun,
      fuzzyMatch: options?.fuzzyMatch ?? true,
      maxFuzzyOffset: options?.maxFuzzyOffset ?? 30,
    });

    if (result.success) {
      // Analyze semantics for metadata
      const semantics = analyzePatchSemantics(parsedPatch);

      await updatePatchStatus(patchId, "applied", {
        semantics,
        applicationResult: {
          fuzzyMatches: result.fuzzyMatches,
          conflicts: result.conflicts,
        },
      });
      return { success: true, applicationResult: result };
    } else {
      await updatePatchStatus(patchId, "failed", {
        error: `Application failed: ${result.conflicts.map((c) => c.description).join("; ")}`,
        applicationResult: {
          fuzzyMatches: result.fuzzyMatches,
          conflicts: result.conflicts,
        },
      });
      return {
        success: false,
        error: "Patch application failed",
        conflicts: result.conflicts,
        applicationResult: result,
      };
    }
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    await updatePatchStatus(patchId, "failed", { error });
    return { success: false, error };
  }
}

/**
 * Apply an approved patch (already validated by Dojo) to the codebase.
 * Works with patches in "applied" or "pending" status.
 * Uses the advanced parser with fuzzy matching for better success rates.
 */
export async function applyApprovedPatchToCodebase(
  patchId: string,
  workspaceDir: string,
  options?: {
    fuzzyMatch?: boolean;
    maxFuzzyOffset?: number;
  },
): Promise<{
  success: boolean;
  error?: string;
  conflicts?: PatchConflict[];
  applicationResult?: PatchApplicationResult;
}> {
  const patch = await loadPatch(patchId);
  if (!patch) {
    return { success: false, error: `Patch ${patchId} not found` };
  }

  // Check if patch passed Dojo validation
  if (patch.metadata.status !== "applied" && patch.metadata.status !== "pending") {
    return {
      success: false,
      error: `Patch ${patchId} has status "${patch.metadata.status}" (must be pending or applied)`,
    };
  }

  if (!patch.metadata.dojoResult?.success) {
    return {
      success: false,
      error: `Patch ${patchId} did not pass Dojo validation`,
    };
  }

  try {
    // Parse the patch using the advanced parser
    const parsedPatch = patch.content.includes("*** Begin Patch")
      ? parseApplyPatchFormat(patch.content)
      : parsePatch(patch.content);

    // Run conflict detection
    const conflicts = await detectConflicts(parsedPatch, workspaceDir);
    const blockingConflicts = conflicts.filter((c) => c.type !== "already_applied");

    // Check if patch is already applied
    const alreadyApplied = conflicts.filter((c) => c.type === "already_applied");
    if (alreadyApplied.length > 0 && blockingConflicts.length === 0) {
      // Patch appears to be already applied
      if (patch.metadata.status === "pending") {
        await updatePatchStatus(patchId, "applied", {
          applicationResult: {
            fuzzyMatches: [],
            conflicts: alreadyApplied,
          },
        });
      }
      return {
        success: true,
        conflicts: alreadyApplied,
        applicationResult: {
          success: true,
          applied: [],
          failed: [],
          conflicts: alreadyApplied,
          fuzzyMatches: [],
        },
      };
    }

    // Apply the patch with fuzzy matching
    const result = await applyPatchAdvanced(parsedPatch, workspaceDir, {
      fuzzyMatch: options?.fuzzyMatch ?? true,
      maxFuzzyOffset: options?.maxFuzzyOffset ?? 30,
    });

    if (result.success) {
      // Analyze semantics for metadata
      const semantics = analyzePatchSemantics(parsedPatch);

      // Mark as applied if it was pending
      if (patch.metadata.status === "pending") {
        await updatePatchStatus(patchId, "applied", {
          semantics,
          applicationResult: {
            fuzzyMatches: result.fuzzyMatches,
            conflicts: result.conflicts,
          },
        });
      }
      return { success: true, applicationResult: result };
    } else {
      // Don't mark as failed if it was already applied
      if (patch.metadata.status === "pending") {
        await updatePatchStatus(patchId, "failed", {
          error: `Application failed: ${result.conflicts.map((c) => c.description).join("; ")}`,
          applicationResult: {
            fuzzyMatches: result.fuzzyMatches,
            conflicts: result.conflicts,
          },
        });
      }
      return {
        success: false,
        error: "Patch application failed",
        conflicts: result.conflicts,
        applicationResult: result,
      };
    }
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    // Don't mark as failed if it was already applied
    if (patch.metadata.status === "pending") {
      await updatePatchStatus(patchId, "failed", { error });
    }
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

// ============================================================================
// Advanced Parser Utilities
// ============================================================================

/**
 * Validate a patch before saving it.
 * Checks for parse errors and analyzes semantics.
 */
export function validatePatchContent(patchContent: string): {
  valid: boolean;
  parsed?: ParsedPatch;
  semantics?: ReturnType<typeof analyzePatchSemantics>;
  errors: string[];
} {
  try {
    const parsed = patchContent.includes("*** Begin Patch")
      ? parseApplyPatchFormat(patchContent)
      : parsePatch(patchContent);

    if (parsed.files.length === 0) {
      return { valid: false, errors: ["Patch contains no file changes"] };
    }

    const semantics = analyzePatchSemantics(parsed);

    return {
      valid: true,
      parsed,
      semantics,
      errors: parsed.parseWarnings,
    };
  } catch (err) {
    return {
      valid: false,
      errors: [err instanceof Error ? err.message : String(err)],
    };
  }
}

/**
 * Check if a patch can be applied cleanly (no conflicts).
 */
export async function canApplyPatch(
  patchContent: string,
  workspaceDir: string,
): Promise<{
  canApply: boolean;
  conflicts: PatchConflict[];
  alreadyApplied: boolean;
}> {
  try {
    const parsed = patchContent.includes("*** Begin Patch")
      ? parseApplyPatchFormat(patchContent)
      : parsePatch(patchContent);

    const conflicts = await detectConflicts(parsed, workspaceDir);
    const blockingConflicts = conflicts.filter((c) => c.type !== "already_applied");
    const alreadyApplied =
      conflicts.every((c) => c.type === "already_applied") && conflicts.length > 0;

    return {
      canApply: blockingConflicts.length === 0,
      conflicts,
      alreadyApplied,
    };
  } catch (err) {
    return {
      canApply: false,
      conflicts: [
        {
          file: "unknown",
          hunkIndex: -1,
          type: "context_mismatch",
          description: err instanceof Error ? err.message : String(err),
        },
      ],
      alreadyApplied: false,
    };
  }
}

/**
 * Dry-run a patch to see what would happen without making changes.
 */
export async function dryRunPatch(
  patchContent: string,
  workspaceDir: string,
  options?: {
    fuzzyMatch?: boolean;
    maxFuzzyOffset?: number;
  },
): Promise<PatchApplicationResult> {
  const parsed = patchContent.includes("*** Begin Patch")
    ? parseApplyPatchFormat(patchContent)
    : parsePatch(patchContent);

  return applyPatchAdvanced(parsed, workspaceDir, {
    dryRun: true,
    fuzzyMatch: options?.fuzzyMatch ?? true,
    maxFuzzyOffset: options?.maxFuzzyOffset ?? 30,
  });
}

// Re-export types from advanced parser for consumers
export type { ParsedPatch, PatchConflict, PatchApplicationResult };

/**
 * Apply a patch with full verification pipeline:
 * 1. Create git snapshot for rollback
 * 2. Apply the patch
 * 3. Run build verification
 * 4. Run TypeScript type check
 * 5. Auto-rollback on any failure
 *
 * This is the safest way to apply self-modifications.
 */
export async function applyPatchWithVerification(
  patchId: string,
  workspaceDir: string,
  options?: {
    fuzzyMatch?: boolean;
    maxFuzzyOffset?: number;
    skipTests?: boolean;
    skipTypeCheck?: boolean;
  },
): Promise<{
  success: boolean;
  verification: PatchVerification;
  summary: string;
  error?: string;
}> {
  log.debug(`[patches] Starting verified patch application for ${patchId}`);

  // Create the patch application function to pass to verifier
  const applyFn = async () => {
    const result = await applyPatchToCodebase(patchId, workspaceDir, {
      fuzzyMatch: options?.fuzzyMatch ?? true,
      maxFuzzyOffset: options?.maxFuzzyOffset ?? 30,
    });

    if (!result.success) {
      throw new Error(result.error || "Patch application failed");
    }
  };

  // Run the full verification pipeline
  const verification = await verifyPatch(patchId, applyFn, {
    skipTests: options?.skipTests ?? true,
    skipTypeCheck: options?.skipTypeCheck ?? false,
  });

  // Log the verification result
  await logVerification(verification);

  // Generate summary
  const summary = summarizeVerification(verification);
  log.debug(`[patches] Verification complete:\n${summary}`);

  return {
    success: verification.finalStatus === "success",
    verification,
    summary,
    error:
      verification.finalStatus !== "success"
        ? verification.results.find((r) => !r.success)?.error
        : undefined,
  };
}

// Re-export verification types
export type { PatchVerification };
