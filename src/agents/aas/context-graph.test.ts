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
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
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

    it("should return true for CanCommit when .git exists", async () => {
      const gitDir = path.join(workspaceDir, ".git");
      await fs.mkdir(gitDir, { recursive: true });

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

    it("should return true for CanDeploy when Dockerfile exists", async () => {
      const dockerfile = path.join(workspaceDir, "Dockerfile");
      await fs.writeFile(dockerfile, "FROM node:22\n");

      const context: ReachabilityCheckContext = {
        workspaceDir,
      };

      const result = await ContextGraph.check(context, "CanDeploy");
      expect(result).toBe(true);
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
    it("should return detailed info for CanCommit when missing", async () => {
      const context: ReachabilityCheckContext = {
        workspaceDir,
      };

      const result = await ContextGraph.checkDetailed(context, "CanCommit");
      expect(result.available).toBe(false);
      expect(result.missing).toContain(".git folder");
      expect(result.missing).toContain("git user.email config");
      expect(result.reason).toBe("Git repository not configured");
    });

    it("should return detailed info for CanDeploy when missing", async () => {
      const context: ReachabilityCheckContext = {
        workspaceDir,
      };

      const result = await ContextGraph.checkDetailed(context, "CanDeploy");
      expect(result.available).toBe(false);
      expect(result.missing).toContain("Dockerfile");
      expect(result.missing).toContain("docker CLI");
      expect(result.missing).toContain("running Docker daemon");
      expect(result.reason).toBe("Docker deployment prerequisites missing");
    });

    it("should return available=true when capability exists", async () => {
      const gitDir = path.join(workspaceDir, ".git");
      await fs.mkdir(gitDir, { recursive: true });

      const context: ReachabilityCheckContext = {
        workspaceDir,
      };

      const result = await ContextGraph.checkDetailed(context, "CanCommit");
      expect(result.available).toBe(true);
      expect(result.missing).toEqual([]);
    });
  });
});
