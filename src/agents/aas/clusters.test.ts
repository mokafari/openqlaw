import { describe, expect, it } from "vitest";
import type { ClusterId } from "./types.js";
import {
  filterToolsByCluster,
  getCluster,
  getClusterForTool,
  getClustersForTools,
  getAllToolsInCluster,
  getToolsForClusters,
  resolveActiveClusters,
  transitionCluster,
} from "./clusters.js";

describe("Tool Clusters", () => {
  describe("getCluster", () => {
    it("should return cluster for valid cluster ID", () => {
      const cluster = getCluster("coding");
      expect(cluster).toBeDefined();
      expect(cluster?.id).toBe("coding");
      expect(cluster?.name).toBe("Coding");
    });

    it("should return undefined for invalid cluster ID", () => {
      const cluster = getCluster("nonexistent" as ClusterId);
      expect(cluster).toBeUndefined();
    });
  });

  describe("getClusterForTool", () => {
    it("should return cluster ID for tool in coding cluster", () => {
      const cluster = getClusterForTool("read");
      expect(cluster).toBe("coding");
    });

    it("should return cluster ID for tool in messaging cluster", () => {
      const cluster = getClusterForTool("message");
      expect(cluster).toBe("messaging");
    });

    it("should return undefined for unknown tool", () => {
      const cluster = getClusterForTool("unknown-tool");
      expect(cluster).toBeUndefined();
    });
  });

  describe("getClustersForTools", () => {
    it("should return unique clusters for multiple tools", () => {
      const clusters = getClustersForTools(["read", "write", "message", "browser"]);
      expect(clusters).toContain("coding");
      expect(clusters).toContain("messaging");
      expect(clusters).toContain("web");
    });

    it("should return empty array for empty tool list", () => {
      const clusters = getClustersForTools([]);
      expect(clusters).toEqual([]);
    });

    it("should handle tools from same cluster", () => {
      const clusters = getClustersForTools(["read", "write", "edit"]);
      expect(clusters.length).toBe(1);
      expect(clusters).toContain("coding");
    });
  });

  describe("getAllToolsInCluster", () => {
    it("should return all tools in coding cluster", () => {
      const tools = getAllToolsInCluster("coding");
      expect(tools.length).toBeGreaterThan(0);
      expect(tools).toContain("read");
      expect(tools).toContain("write");
      expect(tools).toContain("edit");
    });

    it("should return empty array for invalid cluster", () => {
      const tools = getAllToolsInCluster("nonexistent" as ClusterId);
      expect(tools).toEqual([]);
    });
  });

  describe("getToolsForClusters", () => {
    it("should return all tools from multiple clusters", () => {
      const tools = getToolsForClusters(["coding", "messaging"]);
      expect(tools.length).toBeGreaterThan(0);
      expect(tools).toContain("read");
      expect(tools).toContain("message");
    });

    it("should return unique tools", () => {
      const tools = getToolsForClusters(["coding", "filesystem"]);
      const uniqueTools = new Set(tools);
      expect(tools.length).toBe(uniqueTools.size);
    });

    it("should return empty array for empty cluster list", () => {
      const tools = getToolsForClusters([]);
      expect(tools).toEqual([]);
    });
  });

  describe("filterToolsByCluster", () => {
    it("should filter tools to only those in active clusters", () => {
      const allTools = ["read", "write", "message", "browser", "cron"];
      const activeClusters: ClusterId[] = ["coding", "messaging"];

      const filtered = filterToolsByCluster(allTools, activeClusters);
      expect(filtered).toContain("read");
      expect(filtered).toContain("write");
      expect(filtered).toContain("message");
      expect(filtered).not.toContain("browser");
      expect(filtered).not.toContain("cron");
    });

    it("should return empty array when no tools match clusters", () => {
      const allTools = ["unknown-tool"];
      const activeClusters: ClusterId[] = ["coding"];

      const filtered = filterToolsByCluster(allTools, activeClusters);
      expect(filtered).toEqual([]);
    });
  });

  describe("resolveActiveClusters", () => {
    it("should return all clusters when no session state", () => {
      const clusters = resolveActiveClusters(undefined);
      expect(clusters.length).toBeGreaterThan(0);
      expect(clusters).toContain("coding");
      expect(clusters).toContain("messaging");
    });

    it("should return all clusters with session state", () => {
      const sessionState = {} as any;
      const clusters = resolveActiveClusters(sessionState);
      expect(clusters.length).toBeGreaterThan(0);
    });
  });

  describe("transitionCluster", () => {
    it("should find transition via shared tools", () => {
      const result = transitionCluster("coding", "filesystem");
      expect(result).toContain("shared tool");
    });

    it("should find transition via context areas", () => {
      const result = transitionCluster("coding", "messaging");
      expect(result).toBeDefined();
    });

    it("should handle invalid cluster transitions", () => {
      const result = transitionCluster("nonexistent" as ClusterId, "coding");
      expect(result).toContain("Invalid cluster transition");
    });
  });
});
