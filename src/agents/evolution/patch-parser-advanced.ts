/**
 * Advanced Patch Parser
 *
 * Provides sophisticated patch parsing and application with:
 * - Semantic patch understanding
 * - Patch conflict detection
 * - Multiple patch composition
 * - Fuzzy application with heuristics
 *
 * Target: >95% patch success rate
 */

import crypto from "crypto";
import { promises as fs } from "fs";
import path from "path";
import { resolveStateDir } from "../../config/paths.js";

// ============================================================================
// Types
// ============================================================================

export interface PatchHunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  context: string[];
  removals: string[];
  additions: string[];
  rawLines: string[];
}

export interface FilePatch {
  oldPath: string;
  newPath: string;
  isNew: boolean;
  isDeleted: boolean;
  isRenamed: boolean;
  hunks: PatchHunk[];
}

export interface ParsedPatch {
  id: string;
  files: FilePatch[];
  parseWarnings: string[];
}

export interface PatchConflict {
  file: string;
  hunkIndex: number;
  type: "context_mismatch" | "overlap" | "missing_file" | "already_applied";
  description: string;
  suggestedResolution?: string;
}

export interface PatchApplicationResult {
  success: boolean;
  applied: string[];
  failed: string[];
  conflicts: PatchConflict[];
  fuzzyMatches: Array<{
    file: string;
    hunkIndex: number;
    offset: number;
    similarity: number;
  }>;
}

export interface ComposedPatch {
  id: string;
  patches: ParsedPatch[];
  conflicts: PatchConflict[];
  composable: boolean;
}

// ============================================================================
// Parsing
// ============================================================================

/**
 * Parse a unified diff patch into structured format.
 */
export function parsePatch(patchContent: string): ParsedPatch {
  const lines = patchContent.split("\n");
  const files: FilePatch[] = [];
  const warnings: string[] = [];

  let currentFile: FilePatch | null = null;
  let currentHunk: PatchHunk | null = null;
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Detect file header (--- a/path or --- /dev/null)
    if (line.startsWith("---")) {
      // Save previous file
      if (currentFile && currentHunk) {
        currentFile.hunks.push(currentHunk);
      }
      if (currentFile) {
        files.push(currentFile);
      }

      const oldPath = line.substring(4).trim().replace(/^a\//, "");
      const newLine = lines[i + 1] ?? "";
      const newPath = newLine.startsWith("+++")
        ? newLine.substring(4).trim().replace(/^b\//, "")
        : oldPath;

      currentFile = {
        oldPath: oldPath === "/dev/null" ? "" : oldPath,
        newPath: newPath === "/dev/null" ? "" : newPath,
        isNew: oldPath === "/dev/null",
        isDeleted: newPath === "/dev/null",
        isRenamed: oldPath !== newPath && oldPath !== "/dev/null" && newPath !== "/dev/null",
        hunks: [],
      };

      currentHunk = null;
      i += 2; // Skip both --- and +++ lines
      continue;
    }

    // Detect hunk header @@ -1,5 +1,6 @@
    if (line.startsWith("@@")) {
      if (currentFile && currentHunk) {
        currentFile.hunks.push(currentHunk);
      }

      const match = line.match(/@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
      if (match) {
        currentHunk = {
          oldStart: Number.parseInt(match[1], 10),
          oldLines: Number.parseInt(match[2] ?? "1", 10),
          newStart: Number.parseInt(match[3], 10),
          newLines: Number.parseInt(match[4] ?? "1", 10),
          context: [],
          removals: [],
          additions: [],
          rawLines: [line],
        };
      } else {
        warnings.push(`Invalid hunk header: ${line}`);
      }

      i++;
      continue;
    }

    // Parse hunk content
    if (currentHunk) {
      currentHunk.rawLines.push(line);

      if (line.startsWith("+")) {
        currentHunk.additions.push(line.substring(1));
      } else if (line.startsWith("-")) {
        currentHunk.removals.push(line.substring(1));
      } else if (line.startsWith(" ") || line === "") {
        currentHunk.context.push(line.substring(1) || "");
      }
    }

    i++;
  }

  // Save last file and hunk
  if (currentFile && currentHunk) {
    currentFile.hunks.push(currentHunk);
  }
  if (currentFile) {
    files.push(currentFile);
  }

  return {
    id: crypto.createHash("sha256").update(patchContent).digest("hex").slice(0, 16),
    files,
    parseWarnings: warnings,
  };
}

/**
 * Parse apply_patch format (*** Begin Patch ... *** End Patch).
 */
export function parseApplyPatchFormat(content: string): ParsedPatch {
  const lines = content.split("\n");
  const files: FilePatch[] = [];
  const warnings: string[] = [];

  let currentFile: FilePatch | null = null;
  let currentHunk: PatchHunk | null = null;
  let inPatch = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (line.trim() === "*** Begin Patch") {
      inPatch = true;
      continue;
    }

    if (line.trim() === "*** End Patch") {
      // Save final state
      if (currentFile && currentHunk) {
        currentFile.hunks.push(currentHunk);
      }
      if (currentFile) {
        files.push(currentFile);
      }
      break;
    }

    if (!inPatch) continue;

    // New file marker (check BEFORE generic "*** " to take precedence)
    if (line.startsWith("*** Add File: ")) {
      if (currentFile && currentHunk) {
        currentFile.hunks.push(currentHunk);
      }
      if (currentFile) {
        files.push(currentFile);
      }

      const filePath = line.substring("*** Add File: ".length).trim();
      currentFile = {
        oldPath: "",
        newPath: filePath,
        isNew: true,
        isDeleted: false,
        isRenamed: false,
        hunks: [],
      };
      currentHunk = {
        oldStart: 0,
        oldLines: 0,
        newStart: 1,
        newLines: 0,
        context: [],
        removals: [],
        additions: [],
        rawLines: [],
      };
      continue;
    }

    // Delete file marker
    if (line.startsWith("*** Delete File: ")) {
      if (currentFile && currentHunk) {
        currentFile.hunks.push(currentHunk);
      }
      if (currentFile) {
        files.push(currentFile);
      }

      const filePath = line.substring("*** Delete File: ".length).trim();
      currentFile = {
        oldPath: filePath,
        newPath: "",
        isNew: false,
        isDeleted: true,
        isRenamed: false,
        hunks: [],
      };
      currentHunk = null;
      files.push(currentFile);
      currentFile = null;
      continue;
    }

    // Generic file markers (after specific Add/Delete checks)
    if (line.startsWith("*** ")) {
      // Save previous file
      if (currentFile && currentHunk) {
        currentFile.hunks.push(currentHunk);
      }
      if (currentFile) {
        files.push(currentFile);
      }

      const filePath = line.substring(4).trim();
      currentFile = {
        oldPath: filePath,
        newPath: filePath,
        isNew: false,
        isDeleted: false,
        isRenamed: false,
        hunks: [],
      };
      currentHunk = null;
      continue;
    }

    // Hunk content for current file
    if (currentFile) {
      if (!currentHunk) {
        currentHunk = {
          oldStart: 1,
          oldLines: 0,
          newStart: 1,
          newLines: 0,
          context: [],
          removals: [],
          additions: [],
          rawLines: [],
        };
      }

      currentHunk.rawLines.push(line);

      if (line.startsWith("+")) {
        currentHunk.additions.push(line.substring(1));
        currentHunk.newLines++;
      } else if (line.startsWith("-")) {
        currentHunk.removals.push(line.substring(1));
        currentHunk.oldLines++;
      } else if (line.startsWith(" ")) {
        currentHunk.context.push(line.substring(1));
        currentHunk.oldLines++;
        currentHunk.newLines++;
      }
    }
  }

  return {
    id: crypto.createHash("sha256").update(content).digest("hex").slice(0, 16),
    files,
    parseWarnings: warnings,
  };
}

// ============================================================================
// Semantic Analysis
// ============================================================================

/**
 * Extract semantic information from a patch.
 */
export function analyzePatchSemantics(patch: ParsedPatch): {
  type: "feature" | "bugfix" | "refactor" | "config" | "test" | "unknown";
  affectedModules: string[];
  complexity: "low" | "medium" | "high";
  riskLevel: "low" | "medium" | "high";
} {
  const affectedModules = new Set<string>();
  let totalChanges = 0;
  let hasTests = false;
  let hasConfig = false;

  for (const file of patch.files) {
    const filePath = file.newPath || file.oldPath;

    // Extract module name (first directory in path)
    const parts = filePath.split("/");
    if (parts.length > 1) {
      affectedModules.add(parts[0]);
    }

    // Count changes
    for (const hunk of file.hunks) {
      totalChanges += hunk.additions.length + hunk.removals.length;
    }

    // Detect test files
    if (filePath.includes(".test.") || filePath.includes(".spec.") || filePath.includes("/test/")) {
      hasTests = true;
    }

    // Detect config files
    if (
      filePath.endsWith(".json") ||
      filePath.endsWith(".yaml") ||
      filePath.endsWith(".yml") ||
      filePath.endsWith(".toml") ||
      filePath.endsWith(".env")
    ) {
      hasConfig = true;
    }
  }

  // Determine complexity
  let complexity: "low" | "medium" | "high" = "low";
  if (totalChanges > 100 || affectedModules.size > 3) {
    complexity = "high";
  } else if (totalChanges > 30 || affectedModules.size > 1) {
    complexity = "medium";
  }

  // Determine risk level
  let riskLevel: "low" | "medium" | "high" = "low";
  const coreModules = ["evolution", "agents", "config", "gateway"];
  const hasCoreChanges = [...affectedModules].some((m) => coreModules.includes(m));

  if (hasCoreChanges && !hasTests) {
    riskLevel = "high";
  } else if (hasCoreChanges || complexity === "high") {
    riskLevel = "medium";
  }

  // Determine type
  let type: "feature" | "bugfix" | "refactor" | "config" | "test" | "unknown" = "unknown";
  if (hasTests && patch.files.every((f) => (f.newPath || f.oldPath).includes("test"))) {
    type = "test";
  } else if (hasConfig && patch.files.length === 1) {
    type = "config";
  } else if (patch.files.some((f) => f.isNew)) {
    type = "feature";
  }

  return {
    type,
    affectedModules: [...affectedModules],
    complexity,
    riskLevel,
  };
}

// ============================================================================
// Conflict Detection
// ============================================================================

/**
 * Check if a patch can be applied to the current file state.
 */
export async function detectConflicts(
  patch: ParsedPatch,
  workspaceDir: string,
): Promise<PatchConflict[]> {
  const conflicts: PatchConflict[] = [];

  for (const file of patch.files) {
    const filePath = path.join(workspaceDir, file.newPath || file.oldPath);

    // Check if file exists
    let fileContent: string | null = null;
    try {
      fileContent = await fs.readFile(filePath, "utf-8");
    } catch {
      if (!file.isNew) {
        conflicts.push({
          file: file.oldPath || file.newPath,
          hunkIndex: -1,
          type: "missing_file",
          description: `File not found: ${file.oldPath || file.newPath}`,
          suggestedResolution: file.isDeleted
            ? "File already deleted, skip this part of the patch"
            : undefined,
        });
        continue;
      }
    }

    if (file.isNew && fileContent !== null) {
      conflicts.push({
        file: file.newPath,
        hunkIndex: -1,
        type: "already_applied",
        description: `File already exists: ${file.newPath}`,
        suggestedResolution: "Check if patch was already applied or if this is a conflict",
      });
      continue;
    }

    if (!fileContent) continue;

    const fileLines = fileContent.split("\n");

    // Check each hunk
    for (let hunkIdx = 0; hunkIdx < file.hunks.length; hunkIdx++) {
      const hunk = file.hunks[hunkIdx];

      // Check context lines match
      const startLine = hunk.oldStart - 1;
      let contextIdx = 0;

      // Build expected old content
      const expectedOld: string[] = [];
      for (const raw of hunk.rawLines) {
        if (raw.startsWith(" ") || raw.startsWith("-")) {
          expectedOld.push(raw.substring(1));
        }
      }

      // Check if expected content matches
      let matches = true;
      for (let i = 0; i < expectedOld.length; i++) {
        const actualLine = fileLines[startLine + i];
        if (actualLine !== expectedOld[i]) {
          matches = false;
          break;
        }
      }

      if (!matches) {
        // Check if already applied
        const expectedNew: string[] = [];
        for (const raw of hunk.rawLines) {
          if (raw.startsWith(" ") || raw.startsWith("+")) {
            expectedNew.push(raw.substring(1));
          }
        }

        let alreadyApplied = true;
        for (let i = 0; i < expectedNew.length; i++) {
          if (fileLines[startLine + i] !== expectedNew[i]) {
            alreadyApplied = false;
            break;
          }
        }

        if (alreadyApplied) {
          conflicts.push({
            file: file.oldPath || file.newPath,
            hunkIndex: hunkIdx,
            type: "already_applied",
            description: `Hunk ${hunkIdx + 1} appears to be already applied`,
          });
        } else {
          conflicts.push({
            file: file.oldPath || file.newPath,
            hunkIndex: hunkIdx,
            type: "context_mismatch",
            description: `Context at line ${startLine + 1} doesn't match expected content`,
            suggestedResolution: "Try fuzzy matching or manual adjustment",
          });
        }
      }
    }
  }

  return conflicts;
}

/**
 * Detect overlapping changes between two patches.
 */
export function detectPatchOverlap(patch1: ParsedPatch, patch2: ParsedPatch): PatchConflict[] {
  const conflicts: PatchConflict[] = [];

  for (const file1 of patch1.files) {
    for (const file2 of patch2.files) {
      if (file1.newPath !== file2.newPath && file1.oldPath !== file2.oldPath) {
        continue;
      }

      // Check for overlapping hunks
      for (let i = 0; i < file1.hunks.length; i++) {
        const hunk1 = file1.hunks[i];
        for (let j = 0; j < file2.hunks.length; j++) {
          const hunk2 = file2.hunks[j];

          const start1 = hunk1.oldStart;
          const end1 = hunk1.oldStart + hunk1.oldLines;
          const start2 = hunk2.oldStart;
          const end2 = hunk2.oldStart + hunk2.oldLines;

          if (start1 < end2 && start2 < end1) {
            conflicts.push({
              file: file1.oldPath || file1.newPath,
              hunkIndex: i,
              type: "overlap",
              description: `Hunks overlap: patch1[${i}] lines ${start1}-${end1}, patch2[${j}] lines ${start2}-${end2}`,
              suggestedResolution: "Apply patches sequentially or merge manually",
            });
          }
        }
      }
    }
  }

  return conflicts;
}

// ============================================================================
// Fuzzy Matching
// ============================================================================

/**
 * Calculate similarity between two strings (0-1).
 */
function stringSimilarity(s1: string, s2: string): number {
  if (s1 === s2) return 1;
  if (!s1 || !s2) return 0;

  const longer = s1.length > s2.length ? s1 : s2;
  const shorter = s1.length > s2.length ? s2 : s1;

  if (longer.length === 0) return 1;

  // Levenshtein distance
  const costs: number[] = [];
  for (let i = 0; i <= s1.length; i++) {
    let lastValue = i;
    for (let j = 0; j <= s2.length; j++) {
      if (i === 0) {
        costs[j] = j;
      } else if (j > 0) {
        let newValue = costs[j - 1];
        if (s1[i - 1] !== s2[j - 1]) {
          newValue = Math.min(Math.min(newValue, lastValue), costs[j]) + 1;
        }
        costs[j - 1] = lastValue;
        lastValue = newValue;
      }
    }
    if (i > 0) {
      costs[s2.length] = lastValue;
    }
  }

  return (longer.length - costs[s2.length]) / longer.length;
}

/**
 * Find best matching position for a hunk using fuzzy matching.
 */
export function findFuzzyMatch(
  hunk: PatchHunk,
  fileLines: string[],
  options?: { maxOffset?: number; minSimilarity?: number },
): { offset: number; similarity: number } | null {
  const maxOffset = options?.maxOffset ?? 50;
  const minSimilarity = options?.minSimilarity ?? 0.8;

  // Build expected context (lines that should exist)
  // If rawLines is available, use it; otherwise fall back to context + removals
  let expectedLines: string[] = [];

  if (hunk.rawLines && hunk.rawLines.length > 0) {
    for (const raw of hunk.rawLines) {
      // Skip header lines starting with @@
      if (raw.startsWith("@@")) continue;
      if (raw.startsWith(" ") || raw.startsWith("-")) {
        expectedLines.push(raw.substring(1));
      }
    }
  } else {
    // Fall back to context + removals
    expectedLines = [...hunk.context, ...hunk.removals];
  }

  if (expectedLines.length === 0) {
    return { offset: 0, similarity: 1 };
  }

  let bestOffset = 0;
  let bestSimilarity = 0;

  // Search around the expected position
  const expectedStart = hunk.oldStart - 1;

  for (let offset = -maxOffset; offset <= maxOffset; offset++) {
    const startPos = expectedStart + offset;
    if (startPos < 0 || startPos + expectedLines.length > fileLines.length) {
      continue;
    }

    // Calculate similarity for this position
    let totalSimilarity = 0;
    for (let i = 0; i < expectedLines.length; i++) {
      totalSimilarity += stringSimilarity(expectedLines[i], fileLines[startPos + i]);
    }
    const avgSimilarity = totalSimilarity / expectedLines.length;

    // Update best match (including when avgSimilarity = 0 on first iteration)
    if (avgSimilarity > bestSimilarity || bestSimilarity === 0) {
      bestSimilarity = avgSimilarity;
      bestOffset = offset;
    }
  }

  if (bestSimilarity > 0 && bestSimilarity >= minSimilarity) {
    return { offset: bestOffset, similarity: bestSimilarity };
  }

  return null;
}

// ============================================================================
// Patch Application
// ============================================================================

/**
 * Apply a parsed patch to the workspace with fuzzy matching.
 */
export async function applyPatchAdvanced(
  patch: ParsedPatch,
  workspaceDir: string,
  options?: {
    dryRun?: boolean;
    fuzzyMatch?: boolean;
    maxFuzzyOffset?: number;
  },
): Promise<PatchApplicationResult> {
  const applied: string[] = [];
  const failed: string[] = [];
  const conflicts: PatchConflict[] = [];
  const fuzzyMatches: Array<{
    file: string;
    hunkIndex: number;
    offset: number;
    similarity: number;
  }> = [];

  const fuzzyMatch = options?.fuzzyMatch ?? true;
  const maxFuzzyOffset = options?.maxFuzzyOffset ?? 30;

  for (const file of patch.files) {
    const filePath = path.join(workspaceDir, file.newPath || file.oldPath);

    try {
      // Handle file deletion
      if (file.isDeleted) {
        if (!options?.dryRun) {
          await fs.unlink(filePath);
        }
        applied.push(file.oldPath);
        continue;
      }

      // Handle new file
      if (file.isNew) {
        const newContent = file.hunks.flatMap((h) => h.additions).join("\n");

        if (!options?.dryRun) {
          await fs.mkdir(path.dirname(filePath), { recursive: true });
          await fs.writeFile(filePath, newContent, "utf-8");
        }
        applied.push(file.newPath);
        continue;
      }

      // Handle modification
      let fileContent: string;
      try {
        fileContent = await fs.readFile(filePath, "utf-8");
      } catch {
        conflicts.push({
          file: file.oldPath || file.newPath,
          hunkIndex: -1,
          type: "missing_file",
          description: `File not found: ${file.oldPath || file.newPath}`,
        });
        failed.push(file.oldPath || file.newPath);
        continue;
      }

      const fileLines = fileContent.split("\n");
      let lineOffset = 0;
      let success = true;

      for (let hunkIdx = 0; hunkIdx < file.hunks.length; hunkIdx++) {
        const hunk = file.hunks[hunkIdx];
        const adjustedStart = hunk.oldStart - 1 + lineOffset;

        // Build expected and replacement content
        const expectedOld: string[] = [];
        const replacement: string[] = [];

        for (const raw of hunk.rawLines) {
          if (raw.startsWith(" ")) {
            expectedOld.push(raw.substring(1));
            replacement.push(raw.substring(1));
          } else if (raw.startsWith("-")) {
            expectedOld.push(raw.substring(1));
          } else if (raw.startsWith("+")) {
            replacement.push(raw.substring(1));
          }
        }

        // Check if hunk matches at expected position
        let matchStart = adjustedStart;
        let matched = true;

        for (let i = 0; i < expectedOld.length; i++) {
          if (fileLines[matchStart + i] !== expectedOld[i]) {
            matched = false;
            break;
          }
        }

        // Try fuzzy matching if enabled and exact match failed
        if (!matched && fuzzyMatch) {
          const fuzzyResult = findFuzzyMatch(hunk, fileLines, {
            maxOffset: maxFuzzyOffset,
            minSimilarity: 0.85,
          });

          if (fuzzyResult) {
            matchStart = adjustedStart + fuzzyResult.offset;
            matched = true;
            lineOffset += fuzzyResult.offset;

            fuzzyMatches.push({
              file: file.oldPath || file.newPath,
              hunkIndex: hunkIdx,
              offset: fuzzyResult.offset,
              similarity: fuzzyResult.similarity,
            });
          }
        }

        if (!matched) {
          conflicts.push({
            file: file.oldPath || file.newPath,
            hunkIndex: hunkIdx,
            type: "context_mismatch",
            description: `Context mismatch at line ${adjustedStart + 1}`,
          });
          success = false;
          break;
        }

        // Apply the hunk
        fileLines.splice(matchStart, expectedOld.length, ...replacement);
        lineOffset += replacement.length - expectedOld.length;
      }

      if (success) {
        if (!options?.dryRun) {
          await fs.writeFile(filePath, fileLines.join("\n"), "utf-8");
        }
        applied.push(file.oldPath || file.newPath);
      } else {
        failed.push(file.oldPath || file.newPath);
      }
    } catch (err) {
      conflicts.push({
        file: file.oldPath || file.newPath,
        hunkIndex: -1,
        type: "context_mismatch",
        description: err instanceof Error ? err.message : String(err),
      });
      failed.push(file.oldPath || file.newPath);
    }
  }

  return {
    success: failed.length === 0,
    applied,
    failed,
    conflicts,
    fuzzyMatches,
  };
}

// ============================================================================
// Patch Composition
// ============================================================================

/**
 * Compose multiple patches into a single patch.
 */
export function composePatches(patches: ParsedPatch[]): ComposedPatch {
  const conflicts: PatchConflict[] = [];

  // Check for overlaps between all pairs
  for (let i = 0; i < patches.length; i++) {
    for (let j = i + 1; j < patches.length; j++) {
      const overlaps = detectPatchOverlap(patches[i], patches[j]);
      conflicts.push(...overlaps);
    }
  }

  return {
    id: crypto
      .createHash("sha256")
      .update(patches.map((p) => p.id).join("-"))
      .digest("hex")
      .slice(0, 16),
    patches,
    conflicts,
    composable: conflicts.length === 0,
  };
}

/**
 * Apply multiple patches in sequence.
 */
export async function applyPatchSequence(
  patches: ParsedPatch[],
  workspaceDir: string,
  options?: {
    stopOnError?: boolean;
    dryRun?: boolean;
    fuzzyMatch?: boolean;
  },
): Promise<{
  success: boolean;
  results: PatchApplicationResult[];
  appliedCount: number;
  failedCount: number;
}> {
  const results: PatchApplicationResult[] = [];
  let appliedCount = 0;
  let failedCount = 0;

  for (const patch of patches) {
    const result = await applyPatchAdvanced(patch, workspaceDir, options);
    results.push(result);

    if (result.success) {
      appliedCount++;
    } else {
      failedCount++;
      if (options?.stopOnError) {
        break;
      }
    }
  }

  return {
    success: failedCount === 0,
    results,
    appliedCount,
    failedCount,
  };
}

// ============================================================================
// Patch Generation
// ============================================================================

/**
 * Generate a unified diff between two file contents.
 */
export function generateDiff(oldContent: string, newContent: string, filePath: string): string {
  const oldLines = oldContent.split("\n");
  const newLines = newContent.split("\n");

  // Simple diff algorithm (for now, just show as full replacement)
  // A proper implementation would use Myers diff or similar
  const lines: string[] = [];

  lines.push(`--- a/${filePath}`);
  lines.push(`+++ b/${filePath}`);
  lines.push(`@@ -1,${oldLines.length} +1,${newLines.length} @@`);

  for (const line of oldLines) {
    lines.push(`-${line}`);
  }
  for (const line of newLines) {
    lines.push(`+${line}`);
  }

  return lines.join("\n");
}

/**
 * Convert a parsed patch back to unified diff format.
 */
export function patchToUnifiedDiff(patch: ParsedPatch): string {
  const lines: string[] = [];

  for (const file of patch.files) {
    const oldPath = file.isNew ? "/dev/null" : `a/${file.oldPath}`;
    const newPath = file.isDeleted ? "/dev/null" : `b/${file.newPath}`;

    lines.push(`--- ${oldPath}`);
    lines.push(`+++ ${newPath}`);

    for (const hunk of file.hunks) {
      lines.push(`@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`);
      lines.push(...hunk.rawLines.slice(1)); // Skip the @@ line itself
    }
  }

  return lines.join("\n");
}
