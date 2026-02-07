/**
 * Tests for Build Cache Analysis Tool
 */

import { readFile, writeFile, readdir, stat } from "node:fs/promises";
import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  BuildCacheAnalyzer,
  createBuildCacheAnalyzer,
  analyzeBuildCache,
  findSlowFiles,
  suggestIncrementalTargets,
  trackBuildPerformance,
  type CacheStats,
  type OptimizationSuggestion,
  type CacheAnalysis,
  type SlowFile,
  type BuildMetrics,
} from "./build-cache.js";

// Mock fs promises
vi.mock("node:fs/promises", () => ({
  readFile: vi.fn(),
  writeFile: vi.fn(),
  readdir: vi.fn(),
  stat: vi.fn(),
}));

describe("BuildCacheAnalyzer", () => {
  let analyzer: BuildCacheAnalyzer;

  beforeEach(() => {
    analyzer = new BuildCacheAnalyzer("/fake/project");
    vi.clearAllMocks();
    vi.mocked(writeFile).mockResolvedValue(undefined);
  });

  describe("load", () => {
    it("loads existing cache state", async () => {
      const mockState = {
        version: 1,
        artifacts: {
          "src/file.ts": {
            source: "src/file.ts",
            output: "dist/file.js",
            inputHash: "abc123",
            buildTime: 1704067200000,
            durationMs: 100,
            cacheHit: false,
          },
        },
        lastBuild: 1704067200000,
        buildHistory: [],
      };

      vi.mocked(readFile).mockResolvedValue(JSON.stringify(mockState));

      await analyzer.load();
      const stats = analyzer.getStats();

      expect(stats.totalBuilds).toBe(1);
    });

    it("uses default state when file not found", async () => {
      vi.mocked(readFile).mockRejectedValue(new Error("ENOENT"));

      await analyzer.load();
      const stats = analyzer.getStats();

      expect(stats.totalBuilds).toBe(0);
    });
  });

  describe("recordBuild", () => {
    it("records build artifact correctly", async () => {
      vi.mocked(readFile).mockResolvedValue("content");

      const artifact = await analyzer.recordBuild({
        source: "/fake/project/src/file.ts",
        output: "/fake/project/dist/file.js",
        durationMs: 150,
        cacheHit: false,
        triggers: ["src/dep.ts"],
      });

      expect(artifact.source).toBe("src/file.ts");
      expect(artifact.output).toBe("dist/file.js");
      expect(artifact.durationMs).toBe(150);
      expect(artifact.cacheHit).toBe(false);
      expect(artifact.triggers).toContain("src/dep.ts");
    });
  });

  describe("getStats", () => {
    it("returns correct statistics", async () => {
      // Manually set up state
      vi.mocked(readFile).mockResolvedValue("content");

      await analyzer.recordBuild({
        source: "/fake/project/src/a.ts",
        output: "/fake/project/dist/a.js",
        durationMs: 100,
        cacheHit: false,
      });

      await analyzer.recordBuild({
        source: "/fake/project/src/b.ts",
        output: "/fake/project/dist/b.js",
        durationMs: 50,
        cacheHit: true,
      });

      const stats = analyzer.getStats();

      expect(stats.totalBuilds).toBe(2);
      expect(stats.cacheHits).toBe(1);
      expect(stats.cacheMisses).toBe(1);
      expect(stats.hitRate).toBe(0.5);
      expect(stats.totalBuildTimeMs).toBe(150);
    });

    it("handles empty state", () => {
      const stats = analyzer.getStats();

      expect(stats.totalBuilds).toBe(0);
      expect(stats.hitRate).toBe(0);
      expect(stats.avgBuildTimeMs).toBe(0);
    });
  });

  describe("needsRebuild", () => {
    it("returns true for files not in cache", async () => {
      const result = await analyzer.needsRebuild("/fake/project/src/new.ts");

      expect(result.needsRebuild).toBe(true);
      expect(result.reason).toBe("not-in-cache");
    });

    it("returns true when hash changed", async () => {
      // First add a file to cache
      vi.mocked(readFile).mockResolvedValue("original content");
      await analyzer.recordBuild({
        source: "/fake/project/src/file.ts",
        output: "/fake/project/dist/file.js",
        durationMs: 100,
        cacheHit: false,
      });

      // Now change the content
      vi.mocked(readFile).mockResolvedValue("modified content");
      const result = await analyzer.needsRebuild("/fake/project/src/file.ts");

      expect(result.needsRebuild).toBe(true);
      expect(result.reason).toBe("source-changed");
    });

    it("returns false when hash unchanged", async () => {
      vi.mocked(readFile).mockResolvedValue("same content");
      await analyzer.recordBuild({
        source: "/fake/project/src/file.ts",
        output: "/fake/project/dist/file.js",
        durationMs: 100,
        cacheHit: false,
      });

      const result = await analyzer.needsRebuild("/fake/project/src/file.ts");

      expect(result.needsRebuild).toBe(false);
    });
  });

  describe("parseTscOutput", () => {
    it("parses TypeScript build output", () => {
      const output = `
src/file.ts:10:5 - error TS2345: Argument of type 'string' is not assignable
Found 1 error
`;

      const result = analyzer.parseTscOutput(output);

      // Error lines don't count as compiled files
      expect(result.filesCompiled).toBe(0);
      expect(result.errors).toBe(1);
    });

    it("detects incremental cache usage", () => {
      const output = `
Using incremental compilation...
Done in 2.5s
`;

      const result = analyzer.parseTscOutput(output);

      expect(result.cacheUsed).toBe(true);
      expect(result.duration).toBe(2500);
    });
  });

  describe("parseViteOutput", () => {
    it("parses Vite build output", () => {
      const output = `
dist/index.js  12.34 kB │ gzip: 4.56 kB
dist/vendor.js  45.67 kB │ gzip: 12.34 kB
built in 1.5s
`;

      const result = analyzer.parseViteOutput(output);

      expect(result.bundlesBuilt).toBe(2);
      expect(result.duration).toBe(1500);
    });
  });

  describe("getOptimizationSuggestions", () => {
    it("suggests cache config for low hit rate", async () => {
      vi.mocked(readFile).mockResolvedValue("content");

      // Create 15 builds with low cache hit rate
      for (let i = 0; i < 15; i++) {
        await analyzer.recordBuild({
          source: `/fake/project/src/file${i}.ts`,
          output: `/fake/project/dist/file${i}.js`,
          durationMs: 100,
          cacheHit: i < 3, // Only 3 cache hits = 20% hit rate
        });
      }

      const suggestions = await analyzer.getOptimizationSuggestions();

      const cacheConfig = suggestions.find((s) => s.type === "cache-config");
      expect(cacheConfig).toBeDefined();
      expect(cacheConfig?.priority).toBe("high");
    });

    it("suggests parallel builds for slow builds", async () => {
      vi.mocked(readFile).mockResolvedValue("content");

      // Create a slow build
      await analyzer.recordBuild({
        source: "/fake/project/src/slow.ts",
        output: "/fake/project/dist/slow.js",
        durationMs: 10000, // 10 seconds
        cacheHit: false,
      });

      const suggestions = await analyzer.getOptimizationSuggestions();

      const parallel = suggestions.find((s) => s.type === "parallel");
      expect(parallel).toBeDefined();
    });
  });

  describe("getSummary", () => {
    it("generates human-readable summary", async () => {
      vi.mocked(readFile).mockResolvedValue("content");

      await analyzer.recordBuild({
        source: "/fake/project/src/file.ts",
        output: "/fake/project/dist/file.js",
        durationMs: 100,
        cacheHit: true,
      });

      const summary = analyzer.getSummary();

      expect(summary).toContain("Build Cache Summary");
      expect(summary).toContain("Total Builds: 1");
      expect(summary).toContain("Cache Hit Rate: 100.0%");
    });
  });
});

describe("createBuildCacheAnalyzer", () => {
  it("creates BuildCacheAnalyzer with default cwd", () => {
    const analyzer = createBuildCacheAnalyzer();
    expect(analyzer).toBeInstanceOf(BuildCacheAnalyzer);
  });

  it("creates BuildCacheAnalyzer with custom path", () => {
    const analyzer = createBuildCacheAnalyzer("/custom/path");
    expect(analyzer).toBeInstanceOf(BuildCacheAnalyzer);
  });
});

// ============================================================================
// Standalone API Function Tests
// ============================================================================

describe("analyzeBuildCache", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(writeFile).mockResolvedValue(undefined);
  });

  it("returns CacheAnalysis with all fields", async () => {
    const mockState = {
      version: 1,
      artifacts: {
        "src/file.ts": {
          source: "src/file.ts",
          output: "dist/file.js",
          inputHash: "abc123",
          outputHash: "def456",
          buildTime: Date.now() - 1000,
          durationMs: 150,
          cacheHit: false,
        },
      },
      lastBuild: Date.now(),
      buildHistory: [{ timestamp: Date.now(), durationMs: 150, filesBuilt: 1, cacheHits: 0 }],
    };

    vi.mocked(readFile).mockImplementation(async (path) => {
      if (String(path).includes(".build-cache.json")) {
        return JSON.stringify(mockState);
      }
      return "{}";
    });

    const analysis = await analyzeBuildCache("/fake/project");

    expect(analysis.buildDir).toBe("/fake/project");
    expect(analysis.stats).toBeDefined();
    expect(analysis.stats.totalBuilds).toBe(1);
    expect(analysis.artifacts).toHaveLength(1);
    expect(analysis.lastBuildTime).toBeInstanceOf(Date);
  });

  it("identifies stale artifacts", async () => {
    const staleTime = Date.now() - 48 * 60 * 60 * 1000; // 48 hours ago
    const mockState = {
      version: 1,
      artifacts: {
        "src/stale.ts": {
          source: "src/stale.ts",
          output: "dist/stale.js",
          inputHash: "abc",
          buildTime: staleTime,
          durationMs: 100,
          cacheHit: false,
        },
      },
      lastBuild: staleTime,
      buildHistory: [],
    };

    vi.mocked(readFile).mockResolvedValue(JSON.stringify(mockState));

    const analysis = await analyzeBuildCache("/fake/project");

    expect(analysis.staleArtifacts).toContain("src/stale.ts");
  });
});

describe("findSlowFiles", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(writeFile).mockResolvedValue(undefined);
  });

  it("finds files above threshold", async () => {
    const mockState = {
      version: 1,
      artifacts: {
        "src/fast.ts": {
          source: "src/fast.ts",
          output: "dist/fast.js",
          inputHash: "abc",
          buildTime: Date.now(),
          durationMs: 50,
          cacheHit: false,
        },
        "src/slow.ts": {
          source: "src/slow.ts",
          output: "dist/slow.js",
          inputHash: "def",
          buildTime: Date.now(),
          durationMs: 500,
          cacheHit: false,
        },
      },
      lastBuild: Date.now(),
      buildHistory: [],
    };

    vi.mocked(readFile).mockResolvedValue(JSON.stringify(mockState));

    const slowFiles = await findSlowFiles(200, "/fake/project");

    expect(slowFiles).toHaveLength(1);
    expect(slowFiles[0].file).toBe("src/slow.ts");
    expect(slowFiles[0].durationMs).toBe(500);
    expect(slowFiles[0].percentile).toBeGreaterThan(50);
  });

  it("returns empty array when no files exceed threshold", async () => {
    const mockState = {
      version: 1,
      artifacts: {
        "src/fast.ts": {
          source: "src/fast.ts",
          output: "dist/fast.js",
          inputHash: "abc",
          buildTime: Date.now(),
          durationMs: 50,
          cacheHit: false,
        },
      },
      lastBuild: Date.now(),
      buildHistory: [],
    };

    vi.mocked(readFile).mockResolvedValue(JSON.stringify(mockState));

    const slowFiles = await findSlowFiles(100, "/fake/project");

    expect(slowFiles).toHaveLength(0);
  });

  it("provides suggestions for very slow files", async () => {
    const mockState = {
      version: 1,
      artifacts: {
        "src/very-slow.ts": {
          source: "src/very-slow.ts",
          output: "dist/very-slow.js",
          inputHash: "abc",
          buildTime: Date.now(),
          durationMs: 6000, // 6 seconds
          cacheHit: false,
        },
      },
      lastBuild: Date.now(),
      buildHistory: [],
    };

    vi.mocked(readFile).mockResolvedValue(JSON.stringify(mockState));

    const slowFiles = await findSlowFiles(1000, "/fake/project");

    expect(slowFiles[0].suggestion).toBeDefined();
    expect(slowFiles[0].suggestion).toContain("lazy loading");
  });
});

describe("suggestIncrementalTargets", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(writeFile).mockResolvedValue(undefined);
  });

  it("suggests enabling incremental when not configured", async () => {
    const mockState = {
      version: 1,
      artifacts: {},
      lastBuild: 0,
      buildHistory: [],
    };

    vi.mocked(readFile).mockImplementation(async (path) => {
      if (String(path).includes("tsconfig.json")) {
        return JSON.stringify({ compilerOptions: {} });
      }
      return JSON.stringify(mockState);
    });

    const suggestions = await suggestIncrementalTargets("/fake/project");

    expect(suggestions.some((s) => s.includes("incremental: true"))).toBe(true);
  });

  it("suggests tsBuildInfoFile when missing", async () => {
    const mockState = {
      version: 1,
      artifacts: {},
      lastBuild: 0,
      buildHistory: [],
    };

    vi.mocked(readFile).mockImplementation(async (path) => {
      if (String(path).includes("tsconfig.json")) {
        return JSON.stringify({ compilerOptions: { incremental: true } });
      }
      return JSON.stringify(mockState);
    });

    const suggestions = await suggestIncrementalTargets("/fake/project");

    expect(suggestions.some((s) => s.includes("tsBuildInfoFile"))).toBe(true);
  });

  it("identifies directories with slow files", async () => {
    const mockState = {
      version: 1,
      artifacts: {},
      lastBuild: 0,
      buildHistory: [],
    };

    // Create 6 slow files in same directory
    for (let i = 0; i < 6; i++) {
      mockState.artifacts[`src/slow/file${i}.ts`] = {
        source: `src/slow/file${i}.ts`,
        output: `dist/slow/file${i}.js`,
        inputHash: `hash${i}`,
        buildTime: Date.now(),
        durationMs: 300,
        cacheHit: false,
      };
    }

    vi.mocked(readFile).mockImplementation(async (path) => {
      if (String(path).includes("tsconfig.json")) {
        return JSON.stringify({
          compilerOptions: { incremental: true, tsBuildInfoFile: ".tsbuildinfo" },
        });
      }
      return JSON.stringify(mockState);
    });

    const suggestions = await suggestIncrementalTargets("/fake/project");

    expect(suggestions.some((s) => s.includes("src/slow"))).toBe(true);
  });
});

describe("trackBuildPerformance", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(writeFile).mockResolvedValue(undefined);
    vi.mocked(readFile).mockResolvedValue(
      JSON.stringify({
        version: 1,
        artifacts: {},
        lastBuild: 0,
        buildHistory: [],
      }),
    );
  });

  it("parses build log and returns metrics", async () => {
    const buildLog = `
> pnpm build

src/index.ts
src/utils.ts
Done in 2.5s
`;

    const metrics = await trackBuildPerformance(buildLog, "/fake/project");

    expect(metrics.totalDurationMs).toBe(2500);
    expect(metrics.timestamp).toBeInstanceOf(Date);
  });

  it("detects incremental builds", async () => {
    const buildLog = `
Using incremental compilation...
Reusing resolution from previous build
Done in 1.2s
`;

    const metrics = await trackBuildPerformance(buildLog, "/fake/project");

    expect(metrics.incrementalBuild).toBe(true);
  });

  it("counts cache hits", async () => {
    const buildLog = `
src/a.ts - from cache
src/b.ts - cached
src/c.ts - unchanged
src/d.ts
Done in 0.5s
`;

    const metrics = await trackBuildPerformance(buildLog, "/fake/project");

    expect(metrics.filesFromCache).toBeGreaterThan(0);
    expect(metrics.cacheHitRate).toBeGreaterThan(0);
  });

  it("parses errors from log", async () => {
    const buildLog = `
src/broken.ts:10:5 - error TS2345
Found 1 error
`;

    const metrics = await trackBuildPerformance(buildLog, "/fake/project");

    expect(metrics.errors).toBe(1);
  });

  it("parses Vite bundle sizes", async () => {
    const buildLog = `
dist/index.js  50.00 kB │ gzip: 15.00 kB
built in 800ms
`;

    const metrics = await trackBuildPerformance(buildLog, "/fake/project");

    expect(metrics.bundleSize).toBeGreaterThan(0);
    expect(metrics.totalDurationMs).toBe(800);
  });
});
