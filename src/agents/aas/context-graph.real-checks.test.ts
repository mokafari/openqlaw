import { execSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ReachabilityCheckContext } from "./types.js";
import { ContextGraph } from "./context-graph.js";

/**
 * Tests for ContextGraph real CLI checks.
 *
 * NOTE: The current implementation uses simplified checks (file existence)
 * rather than real Docker/Git CLI validation. These tests verify the current
 * behavior and document the limitation.
 *
 * Future enhancement: Implement real CLI checks:
 * - CanCommit: Run `git config user.email` to verify git config
 * - CanDeploy: Run `docker --version` and `docker ps` to verify Docker CLI and daemon
 */
describe("ContextGraph Real Checks (Current Implementation)", () => {
  let tempDir: string;
  let workspaceDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "context-graph-test-"));
    workspaceDir = path.join(tempDir, "workspace");
    await fs.mkdir(workspaceDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe("CanCommit - Current Simplified Implementation", () => {
    it("should return true when .git folder exists (simplified check)", async () => {
      const gitDir = path.join(workspaceDir, ".git");
      await fs.mkdir(gitDir, { recursive: true });

      const context: ReachabilityCheckContext = {
        workspaceDir,
      };

      const result = await ContextGraph.check(context, "CanCommit");
      expect(result).toBe(true);
    });

    it("should return false when .git folder does not exist", async () => {
      const context: ReachabilityCheckContext = {
        workspaceDir,
      };

      const result = await ContextGraph.check(context, "CanCommit");
      expect(result).toBe(false);
    });

    it("should NOT verify git user.email config (limitation)", async () => {
      // Create .git but don't configure user.email
      const gitDir = path.join(workspaceDir, ".git");
      await fs.mkdir(gitDir, { recursive: true });

      const context: ReachabilityCheckContext = {
        workspaceDir,
      };

      const result = await ContextGraph.check(context, "CanCommit");
      // Current implementation returns true even without git config
      // This is a limitation - real implementation would check `git config user.email`
      expect(result).toBe(true);
    });

    it("should provide detailed info about missing prerequisites", async () => {
      const context: ReachabilityCheckContext = {
        workspaceDir,
      };

      const details = await ContextGraph.checkDetailed(context, "CanCommit");
      expect(details.available).toBe(false);
      expect(details.missing).toContain(".git folder");
      expect(details.missing).toContain("git user.email config");
      expect(details.reason).toBe("Git repository not configured");
    });
  });

  describe("CanDeploy - Current Simplified Implementation", () => {
    it("should return true when Dockerfile exists (simplified check)", async () => {
      const dockerfile = path.join(workspaceDir, "Dockerfile");
      await fs.writeFile(dockerfile, "FROM node:22\n");

      const context: ReachabilityCheckContext = {
        workspaceDir,
      };

      const result = await ContextGraph.check(context, "CanDeploy");
      expect(result).toBe(true);
    });

    it("should return false when Dockerfile does not exist", async () => {
      const context: ReachabilityCheckContext = {
        workspaceDir,
      };

      const result = await ContextGraph.check(context, "CanDeploy");
      expect(result).toBe(false);
    });

    it("should NOT verify docker CLI availability (limitation)", async () => {
      const dockerfile = path.join(workspaceDir, "Dockerfile");
      await fs.writeFile(dockerfile, "FROM node:22\n");

      const context: ReachabilityCheckContext = {
        workspaceDir,
      };

      const result = await ContextGraph.check(context, "CanDeploy");
      // Current implementation returns true even if docker CLI is not available
      // This is a limitation - real implementation would check `which docker` or `docker --version`
      expect(result).toBe(true);
    });

    it("should NOT verify Docker daemon is running (limitation)", async () => {
      const dockerfile = path.join(workspaceDir, "Dockerfile");
      await fs.writeFile(dockerfile, "FROM node:22\n");

      const context: ReachabilityCheckContext = {
        workspaceDir,
      };

      const result = await ContextGraph.check(context, "CanDeploy");
      // Current implementation returns true even if Docker daemon is not running
      // This is a limitation - real implementation would check `docker ps`
      expect(result).toBe(true);
    });

    it("should provide detailed info about missing prerequisites", async () => {
      const context: ReachabilityCheckContext = {
        workspaceDir,
      };

      const details = await ContextGraph.checkDetailed(context, "CanDeploy");
      expect(details.available).toBe(false);
      expect(details.missing).toContain("Dockerfile");
      expect(details.missing).toContain("docker CLI");
      expect(details.missing).toContain("running Docker daemon");
      expect(details.reason).toBe("Docker deployment prerequisites missing");
    });
  });

  describe("Future Enhancement: Real CLI Checks", () => {
    it("should verify git user.email when real checks are implemented", async () => {
      // This test documents the expected behavior when real CLI checks are added
      const gitDir = path.join(workspaceDir, ".git");
      await fs.mkdir(gitDir, { recursive: true });

      // Initialize git repo
      try {
        execSync("git init", { cwd: workspaceDir, stdio: "ignore" });
      } catch {
        // Git might not be available in test environment
        // Skip this test if git is not available
        return;
      }

      const context: ReachabilityCheckContext = {
        workspaceDir,
      };

      // Current implementation: returns true (simplified)
      const currentResult = await ContextGraph.check(context, "CanCommit");
      expect(currentResult).toBe(true);

      // Future implementation would check:
      // try {
      //   execSync('git config user.email', { cwd: workspaceDir, stdio: 'ignore' });
      //   return true;
      // } catch {
      //   return false;
      // }
    });

    it("should verify docker CLI when real checks are implemented", async () => {
      const dockerfile = path.join(workspaceDir, "Dockerfile");
      await fs.writeFile(dockerfile, "FROM node:22\n");

      const context: ReachabilityCheckContext = {
        workspaceDir,
      };

      // Current implementation: returns true (simplified)
      const currentResult = await ContextGraph.check(context, "CanDeploy");
      expect(currentResult).toBe(true);

      // Future implementation would check:
      // try {
      //   execSync('docker --version', { stdio: 'ignore' });
      //   execSync('docker ps', { stdio: 'ignore' });
      //   return true;
      // } catch {
      //   return false;
      // }
    });
  });

  describe("documentation of limitations", () => {
    it("should document that real CLI checks are not implemented", () => {
      // This test serves as documentation that:
      // 1. CanCommit only checks for .git folder existence, not git config
      // 2. CanDeploy only checks for Dockerfile existence, not docker CLI/daemon
      // 3. Real CLI checks would require:
      //    - Executing `git config user.email` for CanCommit
      //    - Executing `docker --version` and `docker ps` for CanDeploy
      //    - Handling cases where CLI tools are not installed
      //    - Handling cases where CLI tools are installed but not configured

      expect(true).toBe(true); // Placeholder to document limitation
    });
  });
});
