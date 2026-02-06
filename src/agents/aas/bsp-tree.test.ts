import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  filterContextByDepth,
  getContextDepth,
  getContextDepthInfo,
  getContextPortals,
  isContextPortal,
} from "./bsp-tree.js";

describe("BSP Tree", () => {
  const workspaceRoot = "/workspace/project";

  describe("getContextDepth", () => {
    it("should return depth 0 for paths outside workspace", () => {
      const depth = getContextDepth("/etc/passwd", workspaceRoot);
      expect(depth).toBe(0);
    });

    it("should return depth 1 for root-level files", () => {
      const depth = getContextDepth(path.join(workspaceRoot, "package.json"), workspaceRoot);
      expect(depth).toBe(1);
    });

    it("should return depth 1 for README.md at root", () => {
      const depth = getContextDepth(path.join(workspaceRoot, "README.md"), workspaceRoot);
      expect(depth).toBe(1);
    });

    it("should return depth 2 for files in top-level directories", () => {
      const depth = getContextDepth(path.join(workspaceRoot, "src", "index.ts"), workspaceRoot);
      expect(depth).toBe(2);
    });

    it("should return depth 3 for deeply nested files", () => {
      const depth = getContextDepth(
        path.join(workspaceRoot, "src", "agents", "fsm", "states.ts"),
        workspaceRoot,
      );
      expect(depth).toBe(3);
    });

    it("should return depth 0 when workspaceRoot is not provided", () => {
      const depth = getContextDepth("/some/path", undefined);
      expect(depth).toBe(0);
    });

    it("should return depth 1 for workspace root itself", () => {
      const depth = getContextDepth(workspaceRoot, workspaceRoot);
      expect(depth).toBe(1);
    });
  });

  describe("getContextDepthInfo", () => {
    it("should return depth info with description", () => {
      const info = getContextDepthInfo(path.join(workspaceRoot, "src", "index.ts"), workspaceRoot);
      expect(info.depth).toBe(2);
      expect(info.description).toBe("Module / Directory Level");
    });

    it("should return correct description for each depth level", () => {
      const level0 = getContextDepthInfo("/etc/passwd", workspaceRoot);
      expect(level0.description).toBe("Global OS / Environment Variables");

      const level1 = getContextDepthInfo(path.join(workspaceRoot, "package.json"), workspaceRoot);
      expect(level1.description).toBe("Project Root / package.json");

      const level2 = getContextDepthInfo(
        path.join(workspaceRoot, "src", "index.ts"),
        workspaceRoot,
      );
      expect(level2.description).toBe("Module / Directory Level");

      const level3 = getContextDepthInfo(
        path.join(workspaceRoot, "src", "agents", "fsm", "states.ts"),
        workspaceRoot,
      );
      expect(level3.description).toBe("Local File / Function Level");
    });
  });

  describe("filterContextByDepth", () => {
    const items = [
      { path: path.join(workspaceRoot, "package.json"), depth: 1 },
      { path: path.join(workspaceRoot, "src", "index.ts"), depth: 2 },
      { path: path.join(workspaceRoot, "src", "agents", "fsm", "states.ts"), depth: 3 },
      { path: "/etc/passwd", depth: 0 },
    ];

    it("should include items at current depth", () => {
      const filtered = filterContextByDepth(items, 2, workspaceRoot);
      expect(filtered).toContainEqual(items[1]); // depth 2
    });

    it("should include items within maxDepthDiff", () => {
      const filtered = filterContextByDepth(items, 2, workspaceRoot, 1);
      expect(filtered).toContainEqual(items[0]); // depth 1 (within diff of 1)
      expect(filtered).toContainEqual(items[1]); // depth 2 (current)
      expect(filtered).toContainEqual(items[2]); // depth 3 (within diff of 1)
    });

    it("should exclude items beyond maxDepthDiff", () => {
      const filtered = filterContextByDepth(items, 3, workspaceRoot, 1);
      // depth 1 is diff 2 from depth 3, so should be excluded
      expect(filtered).not.toContainEqual(items[0]); // depth 1 (diff = 2 > 1)
      expect(filtered).toContainEqual(items[2]); // depth 3 (current)
      // depth 2 is diff 1 from depth 3, so should be included
      expect(filtered).toContainEqual(items[1]); // depth 2 (diff = 1 <= 1)
    });

    it("should include items with explicit depth property", () => {
      const itemsWithDepth = [
        { depth: 1, path: "file1" },
        { depth: 3, path: "file2" },
      ];
      const filtered = filterContextByDepth(itemsWithDepth, 2, workspaceRoot, 1);
      expect(filtered).toContainEqual(itemsWithDepth[0]); // depth 1 (diff = 1 <= 1)
      // depth 3 is diff 1 from depth 2, so should be included (diff = 1 <= 1)
      expect(filtered).toContainEqual(itemsWithDepth[1]); // depth 3 (diff = 1 <= 1)
    });

    it("should include global items when currentDepth is 0", () => {
      const itemsWithoutPath = [{ name: "global" }];
      const filtered = filterContextByDepth(itemsWithoutPath, 0, workspaceRoot);
      expect(filtered).toEqual(itemsWithoutPath);
    });
  });

  describe("isContextPortal", () => {
    it("should return true for root-level portal files", () => {
      const portalPath = path.join(workspaceRoot, "package.json");
      const result = isContextPortal(portalPath, workspaceRoot);
      expect(result).toBe(true);
    });

    it("should return true for SOUL.md at root", () => {
      const portalPath = path.join(workspaceRoot, "SOUL.md");
      const result = isContextPortal(portalPath, workspaceRoot);
      expect(result).toBe(true);
    });

    it("should return false for portal files in subdirectories", () => {
      const nonPortalPath = path.join(workspaceRoot, "src", "package.json");
      const result = isContextPortal(nonPortalPath, workspaceRoot);
      expect(result).toBe(false);
    });

    it("should return false for non-portal files", () => {
      const nonPortalPath = path.join(workspaceRoot, "src", "index.ts");
      const result = isContextPortal(nonPortalPath, workspaceRoot);
      expect(result).toBe(false);
    });

    it("should return false when workspaceRoot is not provided", () => {
      const result = isContextPortal("/some/path", undefined);
      expect(result).toBe(false);
    });
  });

  describe("getContextPortals", () => {
    it("should return list of portal file paths", () => {
      const portals = getContextPortals(workspaceRoot);
      expect(portals.length).toBeGreaterThan(0);
      expect(portals.some((p) => p.includes("package.json"))).toBe(true);
      expect(portals.some((p) => p.includes("README.md"))).toBe(true);
      expect(portals.some((p) => p.includes("SOUL.md"))).toBe(true);
    });

    it("should return empty array when workspaceRoot is not provided", () => {
      const portals = getContextPortals(undefined);
      expect(portals).toEqual([]);
    });

    it("should include all expected portal files", () => {
      const portals = getContextPortals(workspaceRoot);
      const portalNames = portals.map((p) => path.basename(p));
      expect(portalNames).toContain("package.json");
      expect(portalNames).toContain("tsconfig.json");
      expect(portalNames).toContain("README.md");
      expect(portalNames).toContain(".gitignore");
      expect(portalNames).toContain("SOUL.md");
    });
  });
});
