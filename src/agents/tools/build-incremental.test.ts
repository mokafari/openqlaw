import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  detectChangedFiles,
  buildDependencyGraph,
  findAffectedFiles,
  loadBuildManifest,
  saveBuildManifest,
  clearBuildCache,
  incrementalBuild,
  getBuildCacheStats,
  type BuildManifest,
} from "./build-incremental.js";

describe("Incremental Build System", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = path.join(os.tmpdir(), `build-test-${Date.now()}`);
    await fs.mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true });
  });

  describe("detectChangedFiles", () => {
    it("should detect new files", async () => {
      await fs.writeFile(path.join(testDir, "new-file.ts"), "export const x = 1;");

      const changed = await detectChangedFiles(testDir, null);

      expect(changed).toContain("new-file.ts");
    });

    it("should detect modified files", async () => {
      const filePath = path.join(testDir, "existing.ts");
      await fs.writeFile(filePath, "export const x = 1;");

      // Create manifest with old hash
      const manifest: BuildManifest = {
        version: 1,
        lastBuildTime: Date.now() - 10000,
        lastBuildDurationMs: 5000,
        files: {
          "existing.ts": {
            hash: "old-hash",
            mtime: Date.now() - 10000,
            dependencies: [],
            lastCompiledAt: Date.now() - 10000,
          },
        },
        buildConfig: {
          tsConfigPath: path.join(testDir, "tsconfig.json"),
          outDir: "dist",
          rootDir: "src",
        },
      };

      const changed = await detectChangedFiles(testDir, manifest);

      expect(changed).toContain("existing.ts");
    });

    it("should not flag unchanged files", async () => {
      const filePath = path.join(testDir, "unchanged.ts");
      const content = "export const x = 1;";
      await fs.writeFile(filePath, content);

      // Get actual hash
      const crypto = await import("crypto");
      const hash = crypto.createHash("sha256").update(content).digest("hex").slice(0, 16);
      const stat = await fs.stat(filePath);

      const manifest: BuildManifest = {
        version: 1,
        lastBuildTime: Date.now(),
        lastBuildDurationMs: 5000,
        files: {
          "unchanged.ts": {
            hash,
            mtime: stat.mtimeMs,
            dependencies: [],
            lastCompiledAt: Date.now(),
          },
        },
        buildConfig: {
          tsConfigPath: path.join(testDir, "tsconfig.json"),
          outDir: "dist",
          rootDir: "src",
        },
      };

      const changed = await detectChangedFiles(testDir, manifest);

      expect(changed).not.toContain("unchanged.ts");
    });
  });

  describe("buildDependencyGraph", () => {
    it("should parse imports from TypeScript files", async () => {
      // Create a simple module structure
      await fs.mkdir(path.join(testDir, "src"), { recursive: true });

      await fs.writeFile(
        path.join(testDir, "src", "main.ts"),
        `import { helper } from './helper.js';
export const main = () => helper();`,
      );

      await fs.writeFile(
        path.join(testDir, "src", "helper.ts"),
        `export const helper = () => 'hello';`,
      );

      const graph = await buildDependencyGraph(path.join(testDir, "src"));

      expect(graph.nodes.has("main.ts")).toBe(true);
      expect(graph.nodes.has("helper.ts")).toBe(true);

      const mainNode = graph.nodes.get("main.ts");
      expect(mainNode?.imports).toContain("helper.ts");

      const helperNode = graph.nodes.get("helper.ts");
      expect(helperNode?.importedBy).toContain("main.ts");
    });

    it("should identify entry points", async () => {
      await fs.mkdir(path.join(testDir, "src"), { recursive: true });

      await fs.writeFile(
        path.join(testDir, "src", "index.ts"),
        `import { lib } from './lib.js';
export default lib;`,
      );

      await fs.writeFile(path.join(testDir, "src", "lib.ts"), `export const lib = 42;`);

      const graph = await buildDependencyGraph(path.join(testDir, "src"));

      expect(graph.entryPoints).toContain("index.ts");
      expect(graph.entryPoints).not.toContain("lib.ts");
    });
  });

  describe("findAffectedFiles", () => {
    it("should find transitive dependents", async () => {
      await fs.mkdir(path.join(testDir, "src"), { recursive: true });

      // A imports B, B imports C
      await fs.writeFile(
        path.join(testDir, "src", "a.ts"),
        `import { b } from './b.js'; export const a = b;`,
      );
      await fs.writeFile(
        path.join(testDir, "src", "b.ts"),
        `import { c } from './c.js'; export const b = c;`,
      );
      await fs.writeFile(path.join(testDir, "src", "c.ts"), `export const c = 1;`);

      const graph = await buildDependencyGraph(path.join(testDir, "src"));

      // If C changes, both A and B should be affected
      const affected = findAffectedFiles(["c.ts"], graph);

      expect(affected).toContain("c.ts");
      expect(affected).toContain("b.ts");
      expect(affected).toContain("a.ts");
    });

    it("should not include unrelated files", async () => {
      await fs.mkdir(path.join(testDir, "src"), { recursive: true });

      await fs.writeFile(
        path.join(testDir, "src", "related.ts"),
        `import { dep } from './dep.js'; export const r = dep;`,
      );
      await fs.writeFile(path.join(testDir, "src", "dep.ts"), `export const dep = 1;`);
      await fs.writeFile(path.join(testDir, "src", "unrelated.ts"), `export const unrelated = 42;`);

      const graph = await buildDependencyGraph(path.join(testDir, "src"));
      const affected = findAffectedFiles(["dep.ts"], graph);

      expect(affected).toContain("dep.ts");
      expect(affected).toContain("related.ts");
      expect(affected).not.toContain("unrelated.ts");
    });
  });

  describe("Build Manifest", () => {
    it("should save and load manifest", async () => {
      const manifest: BuildManifest = {
        version: 1,
        lastBuildTime: Date.now(),
        lastBuildDurationMs: 5000,
        files: {
          "test.ts": {
            hash: "abc123",
            mtime: Date.now(),
            dependencies: [],
            lastCompiledAt: Date.now(),
          },
        },
        buildConfig: {
          tsConfigPath: path.join(testDir, "tsconfig.json"),
          outDir: "dist",
          rootDir: "src",
        },
      };

      await saveBuildManifest(testDir, manifest);
      const loaded = await loadBuildManifest(testDir);

      expect(loaded).not.toBeNull();
      expect(loaded?.files["test.ts"]?.hash).toBe("abc123");
    });

    it("should return null for non-existent manifest", async () => {
      const manifest = await loadBuildManifest("/nonexistent/path");
      expect(manifest).toBeNull();
    });
  });

  describe("getBuildCacheStats", () => {
    it("should return stats for existing cache", async () => {
      const manifest: BuildManifest = {
        version: 1,
        lastBuildTime: Date.now(),
        lastBuildDurationMs: 5000,
        files: {
          "file1.ts": {
            hash: "abc",
            mtime: Date.now(),
            dependencies: [],
            lastCompiledAt: Date.now(),
          },
          "file2.ts": {
            hash: "def",
            mtime: Date.now(),
            dependencies: [],
            lastCompiledAt: Date.now(),
          },
        },
        buildConfig: {
          tsConfigPath: path.join(testDir, "tsconfig.json"),
          outDir: "dist",
          rootDir: "src",
        },
      };

      await saveBuildManifest(testDir, manifest);
      const stats = await getBuildCacheStats(testDir);

      expect(stats.hasCacheentries).toBe(2);
      expect(stats.lastBuildTime).toBe(manifest.lastBuildTime);
      expect(stats.lastBuildDurationMs).toBe(5000);
    });

    it("should return empty stats for missing cache", async () => {
      const stats = await getBuildCacheStats("/nonexistent");

      expect(stats.hasCacheentries).toBe(0);
      expect(stats.lastBuildTime).toBeNull();
    });
  });

  describe("clearBuildCache", () => {
    it("should remove cached manifest", async () => {
      const manifest: BuildManifest = {
        version: 1,
        lastBuildTime: Date.now(),
        lastBuildDurationMs: 5000,
        files: {},
        buildConfig: {
          tsConfigPath: path.join(testDir, "tsconfig.json"),
          outDir: "dist",
          rootDir: "src",
        },
      };

      await saveBuildManifest(testDir, manifest);
      await clearBuildCache(testDir);

      const loaded = await loadBuildManifest(testDir);
      expect(loaded).toBeNull();
    });
  });
});
