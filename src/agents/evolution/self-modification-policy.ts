import { promises as fs } from "fs";
import path from "path";
import { resolveStateDir } from "../../config/paths.js";

/**
 * Self-modification policy defines what files can be modified by the evolution system.
 */
export type SelfModificationPolicy = {
  /** Glob patterns for allowed file paths (e.g., ["src/agents/tools/*.ts"]) */
  allowedPaths: string[];
  /** Glob patterns for blocked file paths (e.g., ["src/agents/security/*", "package.json"]) */
  blockedPaths: string[];
  /** Maximum lines changed per patch (0 = no limit) */
  maxPatchSize: number;
  /** Whether Dojo validation is required before applying patches */
  requireDojoValidation: boolean;
  /** Maximum number of concurrent mutations */
  maxConcurrentMutations?: number;
};

const DEFAULT_POLICY: SelfModificationPolicy = {
  allowedPaths: [
    "src/agents/tools/*.ts",
    "src/agents/evolution/*.ts",
    "src/utils/*.ts",
    "src/agents/pi-tools*.ts",
  ],
  blockedPaths: [
    "src/agents/security/*",
    "src/security/*",
    "package.json",
    "package-lock.json",
    "pnpm-lock.yaml",
    ".env",
    ".env.*",
    "src/config/*",
    "src/gateway/server.impl.ts", // Core gateway logic
    "src/infra/restart.ts", // Restart mechanism
  ],
  maxPatchSize: 500, // Max 500 lines changed per patch
  requireDojoValidation: true,
  maxConcurrentMutations: 1, // Only one mutation at a time for safety
};

/**
 * Load self-modification policy from file or return defaults.
 */
export async function loadSelfModificationPolicy(
  policyPath?: string,
): Promise<SelfModificationPolicy> {
  const defaultPath = path.join(resolveStateDir(), "evolution", "self-modification-policy.json");
  const filePath = policyPath ?? defaultPath;

  try {
    const content = await fs.readFile(filePath, "utf-8");
    const loaded = JSON.parse(content) as Partial<SelfModificationPolicy>;
    return {
      ...DEFAULT_POLICY,
      ...loaded,
      // Ensure arrays are properly merged
      allowedPaths: loaded.allowedPaths ?? DEFAULT_POLICY.allowedPaths,
      blockedPaths: loaded.blockedPaths ?? DEFAULT_POLICY.blockedPaths,
    };
  } catch (err) {
    if ((err as { code?: string }).code === "ENOENT") {
      // File doesn't exist, create default
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, JSON.stringify(DEFAULT_POLICY, null, 2), "utf-8");
      return DEFAULT_POLICY;
    }
    // Other error - return defaults
    return DEFAULT_POLICY;
  }
}

/**
 * Convert glob pattern to regex.
 */
function globToRegExp(pattern: string): RegExp {
  let regex = "^";
  let i = 0;
  while (i < pattern.length) {
    const ch = pattern[i];
    if (ch === "*") {
      const next = pattern[i + 1];
      if (next === "*") {
        regex += ".*";
        i += 2;
        continue;
      }
      regex += "[^/]*";
      i += 1;
      continue;
    }
    if (ch === "?") {
      regex += ".";
      i += 1;
      continue;
    }
    regex += ch.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\$&");
    i += 1;
  }
  regex += "$";
  return new RegExp(regex, "i");
}

/**
 * Check if a path matches a glob pattern.
 */
function matchesPattern(pattern: string, target: string): boolean {
  const normalizedPattern = pattern.replace(/\\/g, "/");
  const normalizedTarget = target.replace(/\\/g, "/");
  const regex = globToRegExp(normalizedPattern);
  return regex.test(normalizedTarget);
}

/**
 * Check if a file path is allowed by the policy.
 */
export function isPathAllowed(filePath: string, policy: SelfModificationPolicy): boolean {
  // Normalize path separators
  const normalized = filePath.replace(/\\/g, "/");

  // Check blocked paths first (blocked takes precedence)
  for (const blocked of policy.blockedPaths) {
    if (matchesPattern(blocked, normalized) || matchesPattern(`**/${blocked}`, normalized)) {
      return false;
    }
  }

  // Check allowed paths
  for (const allowed of policy.allowedPaths) {
    if (matchesPattern(allowed, normalized) || matchesPattern(`**/${allowed}`, normalized)) {
      return true;
    }
  }

  // If no allowed paths match, deny by default
  return false;
}

/**
 * Validate a patch against the policy.
 */
export type PatchValidationResult = {
  valid: boolean;
  errors: string[];
  warnings: string[];
};

export function validatePatch(
  patch: { files: Array<{ path: string; added?: number; removed?: number; modified?: number }> },
  policy: SelfModificationPolicy,
): PatchValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Check each file in the patch
  let totalLinesChanged = 0;
  for (const file of patch.files) {
    // Check if path is allowed
    if (!isPathAllowed(file.path, policy)) {
      errors.push(`File ${file.path} is not allowed by self-modification policy`);
      continue;
    }

    // Count lines changed
    const linesChanged = (file.added ?? 0) + (file.removed ?? 0) + (file.modified ?? 0);
    totalLinesChanged += linesChanged;
  }

  // Check patch size limit
  if (policy.maxPatchSize > 0 && totalLinesChanged > policy.maxPatchSize) {
    errors.push(
      `Patch exceeds maximum size: ${totalLinesChanged} lines changed (max: ${policy.maxPatchSize})`,
    );
  }

  // Warnings for large patches
  if (totalLinesChanged > policy.maxPatchSize * 0.8) {
    warnings.push(
      `Patch is large: ${totalLinesChanged} lines changed (approaching limit of ${policy.maxPatchSize})`,
    );
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Get a human-readable description of the policy.
 */
export function describePolicy(policy: SelfModificationPolicy): string {
  const lines: string[] = [];
  lines.push("Self-Modification Policy:");
  lines.push(`  Allowed paths: ${policy.allowedPaths.length} patterns`);
  lines.push(`  Blocked paths: ${policy.blockedPaths.length} patterns`);
  lines.push(`  Max patch size: ${policy.maxPatchSize} lines`);
  lines.push(`  Dojo validation required: ${policy.requireDojoValidation ? "yes" : "no"}`);
  if (policy.maxConcurrentMutations) {
    lines.push(`  Max concurrent mutations: ${policy.maxConcurrentMutations}`);
  }
  return lines.join("\n");
}
