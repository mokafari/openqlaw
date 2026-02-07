/**
 * Build Cache Analysis Tool
 *
 * Track what's being rebuilt, show cache hit/miss rates,
 * identify rebuild triggers, and suggest optimization opportunities.
 */

import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, writeFile, readdir, stat } from "node:fs/promises";
import { join, relative, dirname, basename } from "node:path";

/**
 * Build artifact record.
 */
export type BuildArtifact = {
  source: string;
  output: string;
  inputHash: string;
  outputHash?: string;
  buildTime: number;
  durationMs: number;
  cacheHit: boolean;
  triggers?: string[];
};

/**
 * Cache statistics.
 */
export type CacheStats = {
  totalBuilds: number;
  cacheHits: number;
  cacheMisses: number;
  hitRate: number;
  missRate: number;
  totalBuildTimeMs: number;
  savedTimeMs: number;
  avgBuildTimeMs: number;
  fastestBuildMs: number;
  slowestBuildMs: number;
};

/**
 * Rebuild trigger analysis.
 */
export type RebuildTrigger = {
  file: string;
  triggerCount: number;
  affectedFiles: string[];
  lastTriggered: Date;
  reason: "source-changed" | "dependency-changed" | "config-changed" | "force";
};

/**
 * Build optimization suggestion.
 */
export type OptimizationSuggestion = {
  type: "cache-config" | "dependency" | "parallel" | "incremental";
  priority: "high" | "medium" | "low";
  description: string;
  estimatedSavings?: string;
  action?: string;
};

/**
 * Build cache state (persisted to disk).
 */
type BuildCacheState = {
  version: number;
  artifacts: Record<string, BuildArtifact>;
  lastBuild: number;
  buildHistory: Array<{
    timestamp: number;
    durationMs: number;
    filesBuilt: number;
    cacheHits: number;
  }>;
};

/**
 * Build Cache Analysis tool.
 */
export class BuildCacheAnalyzer {
  private readonly rootDir: string;
  private readonly cacheFile: string;
  private state: BuildCacheState;

  constructor(rootDir: string, cacheFile?: string) {
    this.rootDir = rootDir;
    this.cacheFile = cacheFile ?? join(rootDir, ".build-cache.json");
    this.state = {
      version: 1,
      artifacts: {},
      lastBuild: 0,
      buildHistory: [],
    };
  }

  /**
   * Load cache state from disk.
   */
  async load(): Promise<void> {
    try {
      const content = await readFile(this.cacheFile, "utf-8");
      this.state = JSON.parse(content);
    } catch {
      // File doesn't exist or is invalid, use default state
    }
  }

  /**
   * Save cache state to disk.
   */
  async save(): Promise<void> {
    await writeFile(this.cacheFile, JSON.stringify(this.state, null, 2), "utf-8");
  }

  /**
   * Calculate hash for a file's content.
   */
  private async hashFile(filePath: string): Promise<string> {
    try {
      const content = await readFile(filePath);
      return createHash("sha256").update(content).digest("hex").slice(0, 16);
    } catch {
      return "unknown";
    }
  }

  /**
   * Record a build artifact.
   */
  async recordBuild(params: {
    source: string;
    output: string;
    durationMs: number;
    cacheHit: boolean;
    triggers?: string[];
  }): Promise<BuildArtifact> {
    const inputHash = await this.hashFile(params.source);
    const outputHash = await this.hashFile(params.output);

    const artifact: BuildArtifact = {
      source: relative(this.rootDir, params.source),
      output: relative(this.rootDir, params.output),
      inputHash,
      outputHash,
      buildTime: Date.now(),
      durationMs: params.durationMs,
      cacheHit: params.cacheHit,
      triggers: params.triggers,
    };

    this.state.artifacts[artifact.source] = artifact;
    await this.save();
    return artifact;
  }

  /**
   * Record a complete build session.
   */
  async recordBuildSession(params: {
    durationMs: number;
    filesBuilt: number;
    cacheHits: number;
  }): Promise<void> {
    this.state.lastBuild = Date.now();
    this.state.buildHistory.push({
      timestamp: Date.now(),
      durationMs: params.durationMs,
      filesBuilt: params.filesBuilt,
      cacheHits: params.cacheHits,
    });

    // Keep only last 100 builds
    if (this.state.buildHistory.length > 100) {
      this.state.buildHistory = this.state.buildHistory.slice(-100);
    }

    await this.save();
  }

  /**
   * Check if a file needs rebuilding.
   */
  async needsRebuild(sourcePath: string): Promise<{
    needsRebuild: boolean;
    reason?: string;
    lastHash?: string;
    currentHash?: string;
  }> {
    const relativePath = relative(this.rootDir, sourcePath);
    const cached = this.state.artifacts[relativePath];

    if (!cached) {
      return { needsRebuild: true, reason: "not-in-cache" };
    }

    const currentHash = await this.hashFile(sourcePath);
    if (cached.inputHash !== currentHash) {
      return {
        needsRebuild: true,
        reason: "source-changed",
        lastHash: cached.inputHash,
        currentHash,
      };
    }

    return { needsRebuild: false };
  }

  /**
   * Get cache statistics.
   */
  getStats(): CacheStats {
    const artifacts = Object.values(this.state.artifacts);
    if (artifacts.length === 0) {
      return {
        totalBuilds: 0,
        cacheHits: 0,
        cacheMisses: 0,
        hitRate: 0,
        missRate: 0,
        totalBuildTimeMs: 0,
        savedTimeMs: 0,
        avgBuildTimeMs: 0,
        fastestBuildMs: 0,
        slowestBuildMs: 0,
      };
    }

    const cacheHits = artifacts.filter((a) => a.cacheHit).length;
    const cacheMisses = artifacts.filter((a) => !a.cacheHit).length;
    const totalBuilds = artifacts.length;
    const durations = artifacts.map((a) => a.durationMs);
    const totalBuildTimeMs = durations.reduce((a, b) => a + b, 0);

    // Estimate saved time (assume cache hits would have taken avg build time)
    const avgBuildTime = totalBuildTimeMs / cacheMisses || 0;
    const savedTimeMs = cacheHits * avgBuildTime;

    return {
      totalBuilds,
      cacheHits,
      cacheMisses,
      hitRate: cacheHits / totalBuilds,
      missRate: cacheMisses / totalBuilds,
      totalBuildTimeMs,
      savedTimeMs,
      avgBuildTimeMs: totalBuildTimeMs / totalBuilds,
      fastestBuildMs: Math.min(...durations),
      slowestBuildMs: Math.max(...durations),
    };
  }

  /**
   * Get build history statistics.
   */
  getBuildHistory(limit = 10): BuildCacheState["buildHistory"] {
    return this.state.buildHistory.slice(-limit);
  }

  /**
   * Analyze rebuild triggers.
   */
  async analyzeRebuildTriggers(): Promise<RebuildTrigger[]> {
    const triggers: Map<string, RebuildTrigger> = new Map();

    for (const artifact of Object.values(this.state.artifacts)) {
      if (artifact.triggers) {
        for (const trigger of artifact.triggers) {
          const existing = triggers.get(trigger) ?? {
            file: trigger,
            triggerCount: 0,
            affectedFiles: [],
            lastTriggered: new Date(0),
            reason: "source-changed" as const,
          };

          existing.triggerCount++;
          existing.affectedFiles.push(artifact.source);
          if (new Date(artifact.buildTime) > existing.lastTriggered) {
            existing.lastTriggered = new Date(artifact.buildTime);
          }

          triggers.set(trigger, existing);
        }
      }
    }

    // Sort by trigger count
    return Array.from(triggers.values()).sort((a, b) => b.triggerCount - a.triggerCount);
  }

  /**
   * Get optimization suggestions.
   */
  async getOptimizationSuggestions(): Promise<OptimizationSuggestion[]> {
    const suggestions: OptimizationSuggestion[] = [];
    const stats = this.getStats();

    // Low cache hit rate
    if (stats.hitRate < 0.5 && stats.totalBuilds > 10) {
      suggestions.push({
        type: "cache-config",
        priority: "high",
        description: `Cache hit rate is only ${(stats.hitRate * 100).toFixed(1)}%. Consider reviewing cache configuration.`,
        estimatedSavings: `${(((1 - stats.hitRate) * stats.savedTimeMs) / 1000).toFixed(1)}s per build`,
        action: "Review tsconfig.json incremental settings and build cache paths",
      });
    }

    // Slow builds
    if (stats.slowestBuildMs > 5000) {
      suggestions.push({
        type: "parallel",
        priority: "medium",
        description: `Slowest build takes ${(stats.slowestBuildMs / 1000).toFixed(1)}s. Consider parallel builds.`,
        action: "Use pnpm build --parallel or split into smaller packages",
      });
    }

    // Analyze frequent rebuilds
    const triggers = await this.analyzeRebuildTriggers();
    const hotTriggers = triggers.filter((t) => t.triggerCount > 5);
    if (hotTriggers.length > 0) {
      suggestions.push({
        type: "dependency",
        priority: "high",
        description: `${hotTriggers.length} files trigger frequent rebuilds: ${hotTriggers
          .slice(0, 3)
          .map((t) => basename(t.file))
          .join(", ")}`,
        estimatedSavings: "Reduced cascade rebuilds",
        action: "Consider moving shared types to a separate package or using barrel exports",
      });
    }

    // Check for incremental build support
    try {
      const tsconfigPath = join(this.rootDir, "tsconfig.json");
      const tsconfig = JSON.parse(await readFile(tsconfigPath, "utf-8"));
      if (!tsconfig.compilerOptions?.incremental) {
        suggestions.push({
          type: "incremental",
          priority: "medium",
          description: "TypeScript incremental compilation is not enabled",
          estimatedSavings: "30-50% build time reduction",
          action: 'Add "incremental": true to tsconfig.json compilerOptions',
        });
      }
    } catch {
      // tsconfig might not exist
    }

    return suggestions.sort((a, b) => {
      const priorityOrder = { high: 0, medium: 1, low: 2 };
      return priorityOrder[a.priority] - priorityOrder[b.priority];
    });
  }

  /**
   * Parse TypeScript build output for cache information.
   */
  parseTscOutput(output: string): {
    filesCompiled: number;
    errors: number;
    cacheUsed: boolean;
    duration?: number;
  } {
    const lines = output.split("\n");
    let filesCompiled = 0;
    let errors = 0;
    let cacheUsed = false;
    let duration: number | undefined;

    for (const line of lines) {
      // Count compiled files
      if (line.includes(".ts") && !line.includes("error")) {
        filesCompiled++;
      }

      // Count errors
      const errorMatch = line.match(/Found (\d+) errors?/);
      if (errorMatch) {
        errors = parseInt(errorMatch[1], 10);
      }

      // Check for incremental cache
      if (line.includes("incremental") || line.includes("tsbuildinfo")) {
        cacheUsed = true;
      }

      // Parse duration
      const durationMatch = line.match(/Done in (\d+(?:\.\d+)?)s/);
      if (durationMatch) {
        duration = parseFloat(durationMatch[1]) * 1000;
      }
    }

    return { filesCompiled, errors, cacheUsed, duration };
  }

  /**
   * Parse vite/esbuild output for build information.
   */
  parseViteOutput(output: string): {
    bundlesBuilt: number;
    totalSize: number;
    duration?: number;
  } {
    const lines = output.split("\n");
    let bundlesBuilt = 0;
    let totalSize = 0;
    let duration: number | undefined;

    for (const line of lines) {
      // Parse bundle size lines (e.g., "dist/index.js  12.34 kB")
      const sizeMatch = line.match(/(\d+(?:\.\d+)?)\s*(?:kB|KB)/);
      if (sizeMatch) {
        bundlesBuilt++;
        totalSize += parseFloat(sizeMatch[1]) * 1024;
      }

      // Parse duration
      const durationMatch = line.match(/built in (\d+(?:\.\d+)?)(?:s|ms)/);
      if (durationMatch) {
        const value = parseFloat(durationMatch[1]);
        duration = line.includes("ms") ? value : value * 1000;
      }
    }

    return { bundlesBuilt, totalSize, duration };
  }

  /**
   * Get files that would be affected by changes to a source file.
   */
  async getAffectedByChange(changedFile: string): Promise<string[]> {
    const relativePath = relative(this.rootDir, changedFile);
    const affected: string[] = [];

    for (const [source, artifact] of Object.entries(this.state.artifacts)) {
      if (artifact.triggers?.includes(relativePath) || source === relativePath) {
        affected.push(source);
      }
    }

    return affected;
  }

  /**
   * Clear the cache.
   */
  async clear(): Promise<void> {
    this.state = {
      version: 1,
      artifacts: {},
      lastBuild: 0,
      buildHistory: [],
    };
    await this.save();
  }

  /**
   * Get summary for display.
   */
  getSummary(): string {
    const stats = this.getStats();
    const history = this.getBuildHistory(5);

    const lines: string[] = [
      "=== Build Cache Summary ===",
      "",
      `Total Builds: ${stats.totalBuilds}`,
      `Cache Hit Rate: ${(stats.hitRate * 100).toFixed(1)}%`,
      `Cache Misses: ${stats.cacheMisses}`,
      `Total Build Time: ${(stats.totalBuildTimeMs / 1000).toFixed(1)}s`,
      `Estimated Time Saved: ${(stats.savedTimeMs / 1000).toFixed(1)}s`,
      `Average Build: ${(stats.avgBuildTimeMs / 1000).toFixed(2)}s`,
      `Slowest Build: ${(stats.slowestBuildMs / 1000).toFixed(2)}s`,
      "",
      "Recent Builds:",
    ];

    for (const build of history) {
      const date = new Date(build.timestamp).toISOString().slice(0, 19);
      lines.push(
        `  ${date}: ${build.filesBuilt} files, ${(build.durationMs / 1000).toFixed(1)}s, ${build.cacheHits} cache hits`,
      );
    }

    return lines.join("\n");
  }
}

/**
 * Create a BuildCacheAnalyzer instance for the default project.
 */
export function createBuildCacheAnalyzer(rootDir?: string): BuildCacheAnalyzer {
  return new BuildCacheAnalyzer(rootDir ?? process.cwd());
}
