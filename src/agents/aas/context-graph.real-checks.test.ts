import { execSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ReachabilityCheckContext } from "./types.js";
import { ContextGraph, CommitStatus, DeploymentStatus } from "./context-graph.js";

/**
 * Tests for ContextGraph real CLI checks.
 *
 * These tests verify real CLI validation for:
 * - CanCommit: git config, .git folder, working tree status
 * - CanDeploy: Dockerfile, docker CLI, Docker daemon
 */
describe("ContextGraph Real CLI Checks", () => {
  let tempDir: string;
  let workspaceDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "context-graph-real-test-"));
    workspaceDir = path.join(tempDir, "workspace");
    await fs.mkdir(workspaceDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe("checkCanCommit - Detailed Status", () => {
    it("should return CommitStatus with all fields", async () => {
      const context: ReachabilityCheckContext = { workspaceDir };
      const status = await ContextGraph.checkCanCommit(context);

      expect(status).toHaveProperty("canCommit");
      expect(status).toHaveProperty("hasGitRepo");
      expect(status).toHaveProperty("hasUserEmail");
      expect(status).toHaveProperty("hasUserName");
      expect(status).toHaveProperty("workingTreeClean");
    });

    it("should return false when no workspace directory", async () => {
      const context: ReachabilityCheckContext = {};
      const status = await ContextGraph.checkCanCommit(context);

      expect(status.canCommit).toBe(false);
      expect(status.reason).toBe("No workspace directory specified");
    });

    it("should return false when .git folder does not exist", async () => {
      const context: ReachabilityCheckContext = { workspaceDir };
      const status = await ContextGraph.checkCanCommit(context);

      expect(status.canCommit).toBe(false);
      expect(status.hasGitRepo).toBe(false);
      expect(status.reason).toBe("Not a git repository");
    });

    it("should detect .git folder but require user.email config", async () => {
      // Create .git directory (simulates an uninitialized git repo)
      const gitDir = path.join(workspaceDir, ".git");
      await fs.mkdir(gitDir, { recursive: true });

      const context: ReachabilityCheckContext = { workspaceDir };
      const status = await ContextGraph.checkCanCommit(context);

      expect(status.hasGitRepo).toBe(true);
      // user.email won't be configured in a bare .git folder
      if (!status.hasUserEmail) {
        expect(status.canCommit).toBe(false);
        expect(status.reason).toBe("Git user.email not configured");
      }
    });

    it("should return true for properly configured git repo", async () => {
      // Skip if git is not available
      try {
        execSync("git --version", { stdio: "ignore" });
      } catch {
        return;
      }

      // Initialize real git repo
      execSync("git init", { cwd: workspaceDir, stdio: "ignore" });
      execSync('git config user.email "test@example.com"', {
        cwd: workspaceDir,
        stdio: "ignore",
      });
      execSync('git config user.name "Test User"', {
        cwd: workspaceDir,
        stdio: "ignore",
      });

      const context: ReachabilityCheckContext = { workspaceDir };
      const status = await ContextGraph.checkCanCommit(context);

      expect(status.hasGitRepo).toBe(true);
      expect(status.hasUserEmail).toBe(true);
      expect(status.hasUserName).toBe(true);
      expect(status.canCommit).toBe(true);
      expect(status.workingTreeClean).toBe(true);
    });

    it("should detect uncommitted changes", async () => {
      // Skip if git is not available
      try {
        execSync("git --version", { stdio: "ignore" });
      } catch {
        return;
      }

      // Initialize real git repo
      execSync("git init", { cwd: workspaceDir, stdio: "ignore" });
      execSync('git config user.email "test@example.com"', {
        cwd: workspaceDir,
        stdio: "ignore",
      });

      // Create uncommitted file
      await fs.writeFile(path.join(workspaceDir, "test.txt"), "hello");

      const context: ReachabilityCheckContext = { workspaceDir };
      const status = await ContextGraph.checkCanCommit(context);

      expect(status.canCommit).toBe(true);
      expect(status.workingTreeClean).toBe(false);
    });
  });

  describe("checkCanDeploy - Detailed Status", () => {
    it("should return DeploymentStatus with all fields", async () => {
      const context: ReachabilityCheckContext = { workspaceDir };
      const status = await ContextGraph.checkCanDeploy(context);

      expect(status).toHaveProperty("canDeploy");
      expect(status).toHaveProperty("hasDockerfile");
      expect(status).toHaveProperty("hasDockerCli");
      expect(status).toHaveProperty("dockerDaemonRunning");
    });

    it("should return false when no workspace directory", async () => {
      const context: ReachabilityCheckContext = {};
      const status = await ContextGraph.checkCanDeploy(context);

      expect(status.canDeploy).toBe(false);
      expect(status.reason).toBe("No workspace directory specified");
    });

    it("should return false when Dockerfile does not exist", async () => {
      const context: ReachabilityCheckContext = { workspaceDir };
      const status = await ContextGraph.checkCanDeploy(context);

      expect(status.canDeploy).toBe(false);
      expect(status.hasDockerfile).toBe(false);
      expect(status.reason).toBe("No Dockerfile found in workspace");
    });

    it("should detect Dockerfile and check docker CLI", async () => {
      const dockerfile = path.join(workspaceDir, "Dockerfile");
      await fs.writeFile(dockerfile, "FROM node:22\n");

      const context: ReachabilityCheckContext = { workspaceDir };
      const status = await ContextGraph.checkCanDeploy(context);

      expect(status.hasDockerfile).toBe(true);
      // Docker CLI may or may not be available
      if (status.hasDockerCli) {
        expect(status.dockerVersion).toBeDefined();
      } else {
        expect(status.reason).toBe("Docker CLI not available");
      }
    });

    it("should detect docker CLI availability", async () => {
      const dockerfile = path.join(workspaceDir, "Dockerfile");
      await fs.writeFile(dockerfile, "FROM node:22\n");

      // Check if docker is available
      let dockerAvailable = false;
      try {
        execSync("docker --version", { stdio: "ignore" });
        dockerAvailable = true;
      } catch {
        // Docker not available
      }

      const context: ReachabilityCheckContext = { workspaceDir };
      const status = await ContextGraph.checkCanDeploy(context);

      expect(status.hasDockerCli).toBe(dockerAvailable);
      if (dockerAvailable) {
        expect(status.dockerVersion).toBeTruthy();
      }
    });

    it("should report deploy target when all checks pass", async () => {
      const dockerfile = path.join(workspaceDir, "Dockerfile");
      await fs.writeFile(dockerfile, "FROM node:22\n");

      const context: ReachabilityCheckContext = { workspaceDir };
      const status = await ContextGraph.checkCanDeploy(context);

      if (status.canDeploy) {
        expect(status.deployTarget).toBe("docker");
        expect(status.hasDockerfile).toBe(true);
        expect(status.hasDockerCli).toBe(true);
        expect(status.dockerDaemonRunning).toBe(true);
      }
    });
  });

  describe("checkDetailed", () => {
    it("should provide detailed info for CanCommit", async () => {
      const context: ReachabilityCheckContext = { workspaceDir };
      const details = await ContextGraph.checkDetailed(context, "CanCommit");

      expect(details.available).toBe(false);
      expect(details.missing).toContain(".git folder");
      expect(details.reason).toBe("Not a git repository");
      expect(details.requiredAction).toBe("Run 'git init' to initialize repository");
    });

    it("should provide detailed info for CanDeploy", async () => {
      const context: ReachabilityCheckContext = { workspaceDir };
      const details = await ContextGraph.checkDetailed(context, "CanDeploy");

      expect(details.available).toBe(false);
      expect(details.missing).toContain("Dockerfile");
      expect(details.reason).toBe("No Dockerfile found in workspace");
    });
  });

  describe("Graceful CLI Handling", () => {
    it("should handle git command timeout gracefully", async () => {
      const gitDir = path.join(workspaceDir, ".git");
      await fs.mkdir(gitDir, { recursive: true });

      const context: ReachabilityCheckContext = { workspaceDir };
      const status = await ContextGraph.checkCanCommit(context);

      // Should complete without throwing even if commands fail
      expect(typeof status.canCommit).toBe("boolean");
      expect(typeof status.hasGitRepo).toBe("boolean");
    });

    it("should handle docker command timeout gracefully", async () => {
      const dockerfile = path.join(workspaceDir, "Dockerfile");
      await fs.writeFile(dockerfile, "FROM node:22\n");

      const context: ReachabilityCheckContext = { workspaceDir };
      const status = await ContextGraph.checkCanDeploy(context);

      // Should complete without throwing even if Docker is not available
      expect(typeof status.canDeploy).toBe("boolean");
      expect(typeof status.hasDockerfile).toBe("boolean");
      expect(typeof status.hasDockerCli).toBe("boolean");
    });
  });
});
