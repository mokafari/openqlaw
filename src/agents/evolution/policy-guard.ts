import fs from "node:fs/promises";
import path from "node:path";

export interface SelfModificationPolicy {
  rules: {
    allowed_paths: string[];
    blocked_paths: string[];
  };
  safety: {
    forbidden_keywords: string[];
    max_patch_size_bytes: number;
  };
}

let cachedPolicy: SelfModificationPolicy | null = null;

/**
 * Simple glob match: supports * and ** patterns.
 */
function simpleGlobMatch(pattern: string, filePath: string): boolean {
  const regex = pattern
    .replace(/\./g, "\\.")
    .replace(/\*\*/g, "{{GLOBSTAR}}")
    .replace(/\*/g, "[^/]*")
    .replace(/\{\{GLOBSTAR\}\}/g, ".*");
  return new RegExp(`^${regex}$`).test(filePath);
}

export async function loadPolicy(): Promise<SelfModificationPolicy> {
  if (cachedPolicy) return cachedPolicy;
  const policyPath = path.join(process.cwd(), "config", "self-modification-policy.json");
  const content = await fs.readFile(policyPath, "utf-8");
  cachedPolicy = JSON.parse(content) as SelfModificationPolicy;
  return cachedPolicy;
}

export async function validatePatch(params: {
  patch: string;
  targetFiles: string[];
}): Promise<{ allowed: boolean; reason?: string }> {
  const policy = await loadPolicy();

  // 1. Check file paths
  for (const file of params.targetFiles) {
    const isAllowed = policy.rules.allowed_paths.some((pattern) => simpleGlobMatch(pattern, file));
    const isBlocked = policy.rules.blocked_paths.some((pattern) => simpleGlobMatch(pattern, file));

    if (isBlocked || !isAllowed) {
      return {
        allowed: false,
        reason: `Path "${file}" is restricted by self-modification policy.`,
      };
    }
  }

  // 2. Check size
  if (Buffer.byteLength(params.patch) > policy.safety.max_patch_size_bytes) {
    return { allowed: false, reason: "Patch size exceeds safety limits." };
  }

  // 3. Check forbidden keywords
  for (const keyword of policy.safety.forbidden_keywords) {
    if (params.patch.includes(keyword)) {
      return { allowed: false, reason: `Patch contains forbidden keyword: "${keyword}"` };
    }
  }

  return { allowed: true };
}
