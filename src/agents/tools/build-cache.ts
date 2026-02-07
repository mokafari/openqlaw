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

// ============================================================================
// Standalone API Functions (as specified in task requirements)
// ============================================================================

/**
 * Cache analysis result.
 */
export type CacheAnalysis = {
  buildDir: string;
  stats: CacheStats;
  artifacts: BuildArtifact[];
  suggestions: OptimizationSuggestion[];
  lastBuildTime: Date | null;
  cacheSize: number;
  staleArtifacts: string[];
};

/**
 * Slow file record.
 */
export type SlowFile = {
  file: string;
  durationMs: number;
  averageDurationMs: number;
  buildCount: number;
  percentile: number;
  suggestion?: string;
};

/**
 * Build metrics from log analysis.
 */
export type BuildMetrics = {
  totalDurationMs: number;
  filesCompiled: number;
  filesFromCache: number;
  errors: number;
  warnings: number;
  cacheHitRate: number;
  incrementalBuild: boolean;
  bundleSize?: number;
  timestamp: Date;
};

/**
 * Analyze build artifacts and caching for a directory.
 */
export async function analyzeBuildCache(buildDir: string): Promise<CacheAnalysis> {
  const analyzer = new BuildCacheAnalyzer(buildDir);
  await analyzer.load();

  const stats = analyzer.getStats();
  const suggestions = await analyzer.getOptimizationSuggestions();
  const history = analyzer.getBuildHistory(1);

  // Get all artifacts
  const artifacts = Object.values(
    (analyzer as unknown as { state: BuildCacheState }).state.artifacts,
  );

  // Find stale artifacts (older than 24 hours with no recent rebuild)
  const staleThreshold = Date.now() - 24 * 60 * 60 * 1000;
  const staleArtifacts = artifacts.filter((a) => a.buildTime < staleThreshold).map((a) => a.source);

  // Estimate cache size (sum of output files)
  const cacheSize = artifacts.reduce((sum, a) => {
    // Rough estimate: output hash length * 2 bytes per artifact
    return sum + (a.outputHash?.length ?? 0) * 2;
  }, 0);

  return {
    buildDir,
    stats,
    artifacts,
    suggestions,
    lastBuildTime: history.length > 0 ? new Date(history[0].timestamp) : null,
    cacheSize,
    staleArtifacts,
  };
}

/**
 * Find files that are slow to compile above a threshold.
 */
export async function findSlowFiles(threshold: number, buildDir?: string): Promise<SlowFile[]> {
  const analyzer = new BuildCacheAnalyzer(buildDir ?? process.cwd());
  await analyzer.load();

  const state = (analyzer as unknown as { state: BuildCacheState }).state;
  const artifacts = Object.values(state.artifacts);

  if (artifacts.length === 0) {
    return [];
  }

  // Calculate average and identify slow files
  const totalDuration = artifacts.reduce((sum, a) => sum + a.durationMs, 0);
  const avgDuration = totalDuration / artifacts.length;

  // Sort by duration to calculate percentiles
  const sortedByDuration = [...artifacts].sort((a, b) => b.durationMs - a.durationMs);

  const slowFiles: SlowFile[] = [];

  for (const artifact of sortedByDuration) {
    if (artifact.durationMs >= threshold) {
      // Find percentile rank
      const rank = sortedByDuration.findIndex((a) => a.source === artifact.source);
      const percentile = ((sortedByDuration.length - rank) / sortedByDuration.length) * 100;

      // Generate suggestion based on file type
      let suggestion: string | undefined;
      if (artifact.durationMs > avgDuration * 3) {
        suggestion = "Consider splitting into smaller modules";
      } else if (artifact.source.includes("index.ts") || artifact.source.includes("barrel")) {
        suggestion = "Barrel exports may cause cascade rebuilds";
      } else if (artifact.durationMs > 5000) {
        suggestion = "Consider lazy loading or code splitting";
      }

      slowFiles.push({
        file: artifact.source,
        durationMs: artifact.durationMs,
        averageDurationMs: avgDuration,
        buildCount: 1, // Would need history tracking for accurate count
        percentile,
        suggestion,
      });
    }
  }

  return slowFiles;
}

/**
 * Suggest targets for incremental build optimization.
 */
export async function suggestIncrementalTargets(buildDir?: string): Promise<string[]> {
  const analyzer = new BuildCacheAnalyzer(buildDir ?? process.cwd());
  await analyzer.load();

  const suggestions: string[] = [];
  const state = (analyzer as unknown as { state: BuildCacheState }).state;
  const artifacts = Object.values(state.artifacts);

  // Group files by directory
  const byDirectory: Map<string, BuildArtifact[]> = new Map();
  for (const artifact of artifacts) {
    const dir = dirname(artifact.source);
    const existing = byDirectory.get(dir) ?? [];
    existing.push(artifact);
    byDirectory.set(dir, existing);
  }

  // Find directories with many slow files - good candidates for separate incremental targets
  for (const [dir, files] of byDirectory.entries()) {
    const totalDuration = files.reduce((sum, f) => sum + f.durationMs, 0);
    const avgDuration = totalDuration / files.length;

    if (files.length >= 5 && avgDuration > 200) {
      suggestions.push(`${dir}/* (${files.length} files, avg ${avgDuration.toFixed(0)}ms)`);
    }
  }

  // Check for files that frequently trigger rebuilds
  const triggers = await analyzer.analyzeRebuildTriggers();
  for (const trigger of triggers.slice(0, 5)) {
    if (trigger.triggerCount > 3) {
      suggestions.push(`Isolate ${trigger.file} (triggers ${trigger.triggerCount} rebuilds)`);
    }
  }

  // Check tsconfig for incremental opportunities
  try {
    const tsconfigPath = join(buildDir ?? process.cwd(), "tsconfig.json");
    const tsconfig = JSON.parse(await readFile(tsconfigPath, "utf-8"));

    if (!tsconfig.compilerOptions?.incremental) {
      suggestions.push("Enable incremental: true in tsconfig.json");
    }
    if (!tsconfig.compilerOptions?.tsBuildInfoFile) {
      suggestions.push("Set tsBuildInfoFile for faster incremental builds");
    }
    if (tsconfig.references && tsconfig.references.length > 0) {
      suggestions.push(
        `Project references detected (${tsconfig.references.length}) - use pnpm build --filter for targeted builds`,
      );
    }
  } catch {
    suggestions.push("Consider adding tsconfig.json with incremental build settings");
  }

  return suggestions;
}

/**
 * Track build performance from a build log.
 */
export async function trackBuildPerformance(
  buildLog: string,
  buildDir?: string,
): Promise<BuildMetrics> {
  const analyzer = new BuildCacheAnalyzer(buildDir ?? process.cwd());

  // Parse both TypeScript and bundler output
  const tscResult = analyzer.parseTscOutput(buildLog);
  const viteResult = analyzer.parseViteOutput(buildLog);

  // Detect warnings
  const warningMatch = buildLog.match(/warning[s]?:?\s*(\d+)/gi);
  const warnings = warningMatch
    ? warningMatch.reduce((sum, m) => {
        const num = m.match(/\d+/);
        return sum + (num ? parseInt(num[0], 10) : 0);
      }, 0)
    : (buildLog.match(/⚠|warning/gi) ?? []).length;

  // Detect cache hits from various build tools
  const cacheHitPatterns = [/cache hit/gi, /from cache/gi, /cached/gi, /unchanged/gi, /skipped/gi];
  let cacheHits = 0;
  for (const pattern of cacheHitPatterns) {
    const matches = buildLog.match(pattern);
    if (matches) cacheHits += matches.length;
  }

  // Calculate total files (compiled + cached)
  const totalFiles = tscResult.filesCompiled + cacheHits;
  const cacheHitRate = totalFiles > 0 ? cacheHits / totalFiles : 0;

  // Determine if incremental
  const incrementalBuild =
    tscResult.cacheUsed || buildLog.includes("incremental") || buildLog.includes("tsbuildinfo");

  // Get duration from parsed output or estimate from log
  let totalDurationMs = tscResult.duration ?? viteResult.duration ?? 0;
  if (!totalDurationMs) {
    // Try to parse pnpm/npm timing
    const pnpmMatch = buildLog.match(/Done in (\d+(?:\.\d+)?)s/);
    if (pnpmMatch) {
      totalDurationMs = parseFloat(pnpmMatch[1]) * 1000;
    }
  }

  const metrics: BuildMetrics = {
    totalDurationMs,
    filesCompiled: tscResult.filesCompiled,
    filesFromCache: cacheHits,
    errors: tscResult.errors,
    warnings,
    cacheHitRate,
    incrementalBuild,
    bundleSize: viteResult.totalSize > 0 ? viteResult.totalSize : undefined,
    timestamp: new Date(),
  };

  // Record in analyzer for history tracking
  await analyzer.load();
  await analyzer.recordBuildSession({
    durationMs: totalDurationMs,
    filesBuilt: tscResult.filesCompiled,
    cacheHits,
  });

  return metrics;
}
