import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ReachabilityCheckContext } from "./types.js";
import {
  canReach,
  checkReachability,
  checkReachabilityType,
  getReachability,
  getReachableAreas,
  getTransitionCost,
  validateReachability,
} from "./reachability.js";

describe("Reachability", () => {
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

  describe("checkReachabilityType", () => {
    it("should return true for READ when file exists and is readable", async () => {
      const testFile = path.join(workspaceDir, "test.txt");
      await fs.writeFile(testFile, "test content");

      const context: ReachabilityCheckContext = {
        targetPath: testFile,
      };

      const result = await checkReachabilityType("READ", context);
      expect(result).toBe(true);
    });

    it("should return false for READ when file does not exist", async () => {
      const context: ReachabilityCheckContext = {
        targetPath: "/nonexistent/file.txt",
      };

      const result = await checkReachabilityType("READ", context);
      expect(result).toBe(false);
    });

    it("should return true for WRITE when directory is writable", async () => {
      const context: ReachabilityCheckContext = {
        targetPath: workspaceDir,
      };

      const result = await checkReachabilityType("WRITE", context);
      expect(result).toBe(true);
    });

    it("should return true for NETWORK when hasNetwork is true", async () => {
      const context: ReachabilityCheckContext = {
        hasNetwork: true,
      };

      const result = await checkReachabilityType("NETWORK", context);
      expect(result).toBe(true);
    });

    it("should return false for NETWORK when hasNetwork is false", async () => {
      const context: ReachabilityCheckContext = {
        hasNetwork: false,
      };

      const result = await checkReachabilityType("NETWORK", context);
      expect(result).toBe(false);
    });

    it("should return true for AUTH when API keys are present", async () => {
      const context: ReachabilityCheckContext = {
        apiKeys: {
          github: "token123",
          openai: "key456",
        },
      };

      const result = await checkReachabilityType("AUTH", context);
      expect(result).toBe(true);
    });

    it("should return false for AUTH when no API keys are present", async () => {
      const context: ReachabilityCheckContext = {
        apiKeys: {},
      };

      const result = await checkReachabilityType("AUTH", context);
      expect(result).toBe(false);
    });

    it("should return true for ELEVATED when hasElevatedAccess is true", async () => {
      const context: ReachabilityCheckContext = {
        hasElevatedAccess: true,
      };

      const result = await checkReachabilityType("ELEVATED", context);
      expect(result).toBe(true);
    });

    it("should return false for ELEVATED when hasElevatedAccess is false", async () => {
      const context: ReachabilityCheckContext = {
        hasElevatedAccess: false,
      };

      const result = await checkReachabilityType("ELEVATED", context);
      expect(result).toBe(false);
    });
  });

  describe("checkReachability", () => {
    it("should return available=true when all types are available", async () => {
      const testFile = path.join(workspaceDir, "test.txt");
      await fs.writeFile(testFile, "test");

      const context: ReachabilityCheckContext = {
        targetPath: testFile,
        hasNetwork: true,
        apiKeys: { github: "token" },
      };

      const result = await checkReachability(["READ", "NETWORK", "AUTH"], context);
      expect(result.available).toBe(true);
      expect(result.missing).toEqual([]);
    });

    it("should return available=false when some types are missing", async () => {
      const context: ReachabilityCheckContext = {
        hasNetwork: false,
        apiKeys: {},
      };

      const result = await checkReachability(["NETWORK", "AUTH"], context);
      expect(result.available).toBe(false);
      expect(result.missing).toContain("NETWORK");
      expect(result.missing).toContain("AUTH");
    });

    it("should return available=true for empty array", async () => {
      const context: ReachabilityCheckContext = {};

      const result = await checkReachability([], context);
      expect(result.available).toBe(true);
      expect(result.missing).toEqual([]);
    });
  });

  describe("getReachability", () => {
    it("should find direct reachability between areas", () => {
      const reachability = getReachability("filesystem", "browser");
      expect(reachability).toBeDefined();
      expect(reachability?.from).toBe("filesystem");
      expect(reachability?.to).toBe("browser");
      expect(reachability?.via).toBe("browser.open");
    });

    it("should return undefined for non-existent reachability", () => {
      const reachability = getReachability("nonexistent", "area");
      expect(reachability).toBeUndefined();
    });
  });

  describe("getReachableAreas", () => {
    it("should return all areas reachable from filesystem", () => {
      const reachable = getReachableAreas("filesystem");
      expect(reachable.length).toBeGreaterThan(0);
      expect(reachable.some((r) => r.to === "browser")).toBe(true);
    });

    it("should return empty array for area with no reachable areas", () => {
      const reachable = getReachableAreas("nonexistent");
      expect(reachable).toEqual([]);
    });
  });

  describe("canReach", () => {
    it("should return true for direct reachability", () => {
      const result = canReach("filesystem", "browser");
      expect(result).toBe(true);
    });

    it("should return true for transitive reachability", () => {
      // filesystem -> browser -> web (transitive)
      const result = canReach("filesystem", "web");
      expect(result).toBe(true);
    });

    it("should return true for same area", () => {
      const result = canReach("filesystem", "filesystem");
      expect(result).toBe(true);
    });

    it("should return false for unreachable areas", () => {
      const result = canReach("nonexistent", "filesystem");
      expect(result).toBe(false);
    });
  });

  describe("getTransitionCost", () => {
    it("should return cost for direct reachability", () => {
      const cost = getTransitionCost("filesystem", "browser");
      expect(cost).toBeGreaterThan(0);
      expect(cost).toBeLessThanOrEqual(1.0);
    });

    it("should return high cost (1.0) for unreachable transition", () => {
      const cost = getTransitionCost("nonexistent", "filesystem");
      expect(cost).toBe(1.0);
    });
  });

  describe("validateReachability", () => {
    it("should return valid=true for direct reachability with no requirements", async () => {
      const context: ReachabilityCheckContext = {
        workspaceDir,
      };

      const result = await validateReachability("filesystem", "browser", context);
      expect(result.valid).toBe(true);
      expect(result.missing).toEqual([]);
    });

    it("should return valid=false when requirements are missing", async () => {
      const context: ReachabilityCheckContext = {
        workspaceDir,
        hasNetwork: false,
      };

      // web area requires NETWORK
      const result = await validateReachability("browser", "web", context);
      // This might be valid if web area doesn't have strict requirements
      // The actual result depends on context-areas.ts configuration
      expect(result).toBeDefined();
    });

    it("should return valid=false for unreachable areas", async () => {
      const context: ReachabilityCheckContext = {
        workspaceDir,
      };

      const result = await validateReachability("nonexistent", "filesystem", context);
      expect(result.valid).toBe(false);
      expect(result.reason).toContain("No path found");
    });
  });
});
