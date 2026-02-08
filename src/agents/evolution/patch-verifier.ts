/**
 * Patch Verifier - Property preservation checks for self-modification
 * Part of AGI 2026 TIER 1: Reliable Self-Modification
 */

import { exec } from "child_process";
import * as fs from "fs/promises";
import * as path from "path";
import { promisify } from "util";

const execAsync = promisify(exec);

// Types
export interface VerificationResult {
  success: boolean;
  phase: "pre-snapshot" | "apply" | "build" | "typecheck" | "tests" | "rollback";
  error?: string;
  details?: string;
  duration: number;
}

export interface PatchVerification {
  patchId: string;
  startTime: number;
  endTime?: number;
  snapshotBranch?: string;
  results: VerificationResult[];
  finalStatus: "pending" | "success" | "failed" | "rolled-back";
}

// Configuration
const OPENCLAW_DIR = process.env.OPENCLAW_DIR || "/Users/gustav/openclaw";
const VERIFICATION_TIMEOUT = 120000; // 2 minutes per step

// Create a snapshot before applying patch
export async function createSnapshot(
  patchId: string,
): Promise<{ success: boolean; branch?: string; error?: string }> {
  const branchName = `pre-patch-${patchId}-${Date.now()}`;

  try {
    // Check for uncommitted changes
    const { stdout: status } = await execAsync("git status --porcelain", { cwd: OPENCLAW_DIR });

    if (status.trim()) {
      // Stash changes
      await execAsync('git stash push -m "Pre-patch snapshot"', { cwd: OPENCLAW_DIR });
    }

    // Create snapshot branch from current HEAD
    await execAsync(`git branch ${branchName}`, { cwd: OPENCLAW_DIR });

    return { success: true, branch: branchName };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

// Run build verification
export async function verifyBuild(): Promise<VerificationResult> {
  const start = Date.now();

  try {
    const { stdout, stderr } = await execAsync("pnpm build", {
      cwd: OPENCLAW_DIR,
      timeout: VERIFICATION_TIMEOUT,
    });

    // Check for build errors (not just warnings)
    if (stderr.includes("error TS") || stderr.includes("ERROR")) {
      return {
        success: false,
        phase: "build",
        error: "Build produced errors",
        details: stderr.slice(0, 1000),
        duration: Date.now() - start,
      };
    }

    return {
      success: true,
      phase: "build",
      details: `Build completed in ${Date.now() - start}ms`,
      duration: Date.now() - start,
    };
  } catch (error: any) {
    return {
      success: false,
      phase: "build",
      error: error.message,
      details: error.stderr?.slice(0, 1000),
      duration: Date.now() - start,
    };
  }
}

// Run TypeScript type check
export async function verifyTypeCheck(): Promise<VerificationResult> {
  const start = Date.now();

  try {
    await execAsync("pnpm exec tsc --noEmit", {
      cwd: OPENCLAW_DIR,
      timeout: VERIFICATION_TIMEOUT,
    });

    return {
      success: true,
      phase: "typecheck",
      details: "No type errors",
      duration: Date.now() - start,
    };
  } catch (error: any) {
    // Count errors
    const errorCount = (error.stdout?.match(/error TS/g) || []).length;

    return {
      success: false,
      phase: "typecheck",
      error: `${errorCount} TypeScript error(s)`,
      details: error.stdout?.slice(0, 1000),
      duration: Date.now() - start,
    };
  }
}

// Run tests (optional, can be skipped for speed)
export async function verifyTests(skipTests: boolean = true): Promise<VerificationResult> {
  const start = Date.now();

  if (skipTests) {
    return {
      success: true,
      phase: "tests",
      details: "Tests skipped (fast mode)",
      duration: 0,
    };
  }

  try {
    await execAsync("pnpm test", {
      cwd: OPENCLAW_DIR,
      timeout: VERIFICATION_TIMEOUT * 2,
    });

    return {
      success: true,
      phase: "tests",
      details: "All tests passed",
      duration: Date.now() - start,
    };
  } catch (error: any) {
    return {
      success: false,
      phase: "tests",
      error: "Tests failed",
      details: error.stdout?.slice(0, 1000),
      duration: Date.now() - start,
    };
  }
}

// Rollback to snapshot
export async function rollback(snapshotBranch: string): Promise<VerificationResult> {
  const start = Date.now();

  try {
    // Hard reset to snapshot
    await execAsync(`git reset --hard ${snapshotBranch}`, { cwd: OPENCLAW_DIR });

    // Restore stash if exists
    try {
      await execAsync("git stash pop", { cwd: OPENCLAW_DIR });
    } catch {
      // No stash to pop, that's fine
    }

    // Delete snapshot branch
    await execAsync(`git branch -D ${snapshotBranch}`, { cwd: OPENCLAW_DIR });

    return {
      success: true,
      phase: "rollback",
      details: `Rolled back to ${snapshotBranch}`,
      duration: Date.now() - start,
    };
  } catch (error: any) {
    return {
      success: false,
      phase: "rollback",
      error: error.message,
      duration: Date.now() - start,
    };
  }
}

// Clean up snapshot after successful verification
export async function cleanupSnapshot(snapshotBranch: string): Promise<void> {
  try {
    await execAsync(`git branch -D ${snapshotBranch}`, { cwd: OPENCLAW_DIR });
  } catch {
    // Ignore cleanup errors
  }
}

// Full verification pipeline
export async function verifyPatch(
  patchId: string,
  applyPatchFn: () => Promise<void>,
  options: { skipTests?: boolean; skipTypeCheck?: boolean } = {},
): Promise<PatchVerification> {
  const verification: PatchVerification = {
    patchId,
    startTime: Date.now(),
    results: [],
    finalStatus: "pending",
  };

  // Step 1: Create snapshot
  const snapshot = await createSnapshot(patchId);
  if (!snapshot.success) {
    verification.results.push({
      success: false,
      phase: "pre-snapshot",
      error: snapshot.error,
      duration: 0,
    });
    verification.finalStatus = "failed";
    verification.endTime = Date.now();
    return verification;
  }
  verification.snapshotBranch = snapshot.branch;
  verification.results.push({
    success: true,
    phase: "pre-snapshot",
    details: `Snapshot: ${snapshot.branch}`,
    duration: 0,
  });

  // Step 2: Apply patch
  const applyStart = Date.now();
  try {
    await applyPatchFn();
    verification.results.push({
      success: true,
      phase: "apply",
      details: "Patch applied",
      duration: Date.now() - applyStart,
    });
  } catch (error: any) {
    verification.results.push({
      success: false,
      phase: "apply",
      error: error.message,
      duration: Date.now() - applyStart,
    });

    // Rollback
    const rollbackResult = await rollback(snapshot.branch!);
    verification.results.push(rollbackResult);
    verification.finalStatus = "rolled-back";
    verification.endTime = Date.now();
    return verification;
  }

  // Step 3: Build
  const buildResult = await verifyBuild();
  verification.results.push(buildResult);

  if (!buildResult.success) {
    const rollbackResult = await rollback(snapshot.branch!);
    verification.results.push(rollbackResult);
    verification.finalStatus = "rolled-back";
    verification.endTime = Date.now();
    return verification;
  }

  // Step 4: TypeScript check (optional)
  if (!options.skipTypeCheck) {
    const typeResult = await verifyTypeCheck();
    verification.results.push(typeResult);

    if (!typeResult.success) {
      const rollbackResult = await rollback(snapshot.branch!);
      verification.results.push(rollbackResult);
      verification.finalStatus = "rolled-back";
      verification.endTime = Date.now();
      return verification;
    }
  }

  // Step 5: Tests (optional)
  const testResult = await verifyTests(options.skipTests ?? true);
  verification.results.push(testResult);

  if (!testResult.success) {
    const rollbackResult = await rollback(snapshot.branch!);
    verification.results.push(rollbackResult);
    verification.finalStatus = "rolled-back";
    verification.endTime = Date.now();
    return verification;
  }

  // All checks passed
  await cleanupSnapshot(snapshot.branch!);
  verification.finalStatus = "success";
  verification.endTime = Date.now();

  return verification;
}

// Log verification to file
export async function logVerification(verification: PatchVerification): Promise<void> {
  const logDir = path.join(OPENCLAW_DIR, "..", ".openclaw", "evolution", "verification-logs");
  await fs.mkdir(logDir, { recursive: true });

  const logFile = path.join(logDir, `${verification.patchId}.json`);
  await fs.writeFile(logFile, JSON.stringify(verification, null, 2));
}

// Export summary for display
export function summarizeVerification(verification: PatchVerification): string {
  const duration = verification.endTime
    ? `${((verification.endTime - verification.startTime) / 1000).toFixed(1)}s`
    : "ongoing";

  const statusEmoji = {
    pending: "⏳",
    success: "✅",
    failed: "❌",
    "rolled-back": "↩️",
  }[verification.finalStatus];

  const steps = verification.results
    .map((r) => `  ${r.success ? "✓" : "✗"} ${r.phase}: ${r.error || r.details || "OK"}`)
    .join("\n");

  return `${statusEmoji} Patch ${verification.patchId} [${verification.finalStatus}] (${duration})\n${steps}`;
}
