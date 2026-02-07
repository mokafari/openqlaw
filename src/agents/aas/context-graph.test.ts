import { execSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ReachabilityCheckContext } from "./types.js";
import { ContextGraph } from "./context-graph.js";

describe("ContextGraph", () => {
  let tempDir: string;
  let workspaceDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "quake-test-"));
    workspaceDir = path.join(tempDir, "workspace");
    await fs.mkdir(workspaceDir, { recursive: true });
    ContextGraph.clearCache();
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
    ContextGraph.clearCache();
  });

  describe("check", () => {
    it("should return true for CanRead when workspace exists", async () => {
      const context: ReachabilityCheckContext = {
        workspaceDir,
        targetPath: workspaceDir,
      };

      const result = await ContextGraph.check(context, "CanRead");
      expect(result).toBe(true);
    });

    it("should return true for CanRead when workspaceDir is provided (simplified check)", async () => {
      const context: ReachabilityCheckContext = {
        workspaceDir: "/nonexistent/path",
      };

      // Current implementation returns true if workspaceDir is provided
      // (simplified check - doesn't verify path actually exists)
      const result = await ContextGraph.check(context, "CanRead");
      expect(result).toBe(true);
    });

    it("should return true for CanWrite when workspace is writable", async () => {
      const context: ReachabilityCheckContext = {
        workspaceDir,
        targetPath: workspaceDir,
      };

      const result = await ContextGraph.check(context, "CanWrite");
      expect(result).toBe(true);
    });

    it("should return true for CanNetwork when hasNetwork is true", async () => {
      const context: ReachabilityCheckContext = {
        hasNetwork: true,
      };

      const result = await ContextGraph.check(context, "CanNetwork");
      expect(result).toBe(true);
    });

    it("should return false for CanNetwork when hasNetwork is false", async () => {
      const context: ReachabilityCheckContext = {
        hasNetwork: false,
      };

      const result = await ContextGraph.check(context, "CanNetwork");
      expect(result).toBe(false);
    });

    it("should return true for CanCommit when .git exists AND git config is set", async () => {
      // Skip if git is not available
      try {
        execSync("git --version", { stdio: "ignore" });
      } catch {
        return;
      }

      // Initialize real git repo with config
      execSync("git init", { cwd: workspaceDir, stdio: "ignore" });
      execSync('git config user.email "test@example.com"', {
        cwd: workspaceDir,
        stdio: "ignore",
      });

      const context: ReachabilityCheckContext = {
        workspaceDir,
      };

      const result = await ContextGraph.check(context, "CanCommit");
      expect(result).toBe(true);
    });

    it("should return false for CanCommit when .git does not exist", async () => {
      const context: ReachabilityCheckContext = {
        workspaceDir,
      };

      const result = await ContextGraph.check(context, "CanCommit");
      expect(result).toBe(false);
    });

    it("should return false for CanCommit when .git exists but no git config", async () => {
      // Just create .git folder without proper git init
      const gitDir = path.join(workspaceDir, ".git");
      await fs.mkdir(gitDir, { recursive: true });

      const context: ReachabilityCheckContext = {
        workspaceDir,
      };

      const result = await ContextGraph.check(context, "CanCommit");
      // Without proper git config, this should be false
      expect(result).toBe(false);
    });

    it("should check docker CLI for CanDeploy when Dockerfile exists", async () => {
      const dockerfile = path.join(workspaceDir, "Dockerfile");
      await fs.writeFile(dockerfile, "FROM node:22\n");

      const context: ReachabilityCheckContext = {
        workspaceDir,
      };

      // This now checks for docker CLI and daemon, not just Dockerfile
      const result = await ContextGraph.check(context, "CanDeploy");
      // Result depends on whether docker is installed and running
      expect(typeof result).toBe("boolean");
    });

    it("should return false for CanDeploy when Dockerfile does not exist", async () => {
      const context: ReachabilityCheckContext = {
        workspaceDir,
      };

      const result = await ContextGraph.check(context, "CanDeploy");
      expect(result).toBe(false);
    });
  });

  describe("checkDetailed", () => {
    it("should return detailed info for CanCommit when missing .git", async () => {
      const context: ReachabilityCheckContext = {
        workspaceDir,
      };

      const result = await ContextGraph.checkDetailed(context, "CanCommit");
      expect(result.available).toBe(false);
      expect(result.missing).toContain(".git folder");
      expect(result.reason).toBe("Not a git repository");
      expect(result.requiredAction).toBe("Run 'git init' to initialize repository");
    });

    it("should return detailed info for CanDeploy when missing Dockerfile", async () => {
      const context: ReachabilityCheckContext = {
        workspaceDir,
      };

      const result = await ContextGraph.checkDetailed(context, "CanDeploy");
      expect(result.available).toBe(false);
      expect(result.missing).toContain("Dockerfile");
      expect(result.reason).toBe("No Dockerfile found in workspace");
      expect(result.requiredAction).toBe("Create a Dockerfile in the workspace root");
    });

    it("should return available=true for CanCommit when properly configured", async () => {
      // Skip if git is not available
      try {
        execSync("git --version", { stdio: "ignore" });
      } catch {
        return;
      }

      // Initialize real git repo with config
      execSync("git init", { cwd: workspaceDir, stdio: "ignore" });
      execSync('git config user.email "test@example.com"', {
        cwd: workspaceDir,
        stdio: "ignore",
      });

      const context: ReachabilityCheckContext = {
        workspaceDir,
      };

      const result = await ContextGraph.checkDetailed(context, "CanCommit");
      expect(result.available).toBe(true);
      expect(result.missing).toEqual([]);
    });
  });

  describe("checkCanCommit status object", () => {
    it("should return detailed CommitStatus", async () => {
      const context: ReachabilityCheckContext = {
        workspaceDir,
      };

      const status = await ContextGraph.checkCanCommit(context);
      expect(status).toHaveProperty("canCommit");
      expect(status).toHaveProperty("hasGitRepo");
      expect(status).toHaveProperty("hasUserEmail");
      expect(status).toHaveProperty("hasUserName");
      expect(status).toHaveProperty("workingTreeClean");
    });
  });

  describe("checkCanDeploy status object", () => {
    it("should return detailed DeploymentStatus", async () => {
      const context: ReachabilityCheckContext = {
        workspaceDir,
      };

      const status = await ContextGraph.checkCanDeploy(context);
      expect(status).toHaveProperty("canDeploy");
      expect(status).toHaveProperty("hasDockerfile");
      expect(status).toHaveProperty("hasDockerCli");
      expect(status).toHaveProperty("dockerDaemonRunning");
    });
  });
});
