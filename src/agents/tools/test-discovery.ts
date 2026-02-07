/**
 * Test Discovery Tool
 *
 * Find all test files, parse test structure, identify affected tests
 * for changed files, and generate coverage reports.
 */

import { execSync } from "node:child_process";
import { readFile, readdir, stat } from "node:fs/promises";
import { join, relative, dirname, basename } from "node:path";

/**
 * Parsed test case from a test file.
 */
export type TestCase = {
  name: string;
  type: "test" | "it" | "describe" | "suite";
  line: number;
  parent?: string;
  modifiers?: ("skip" | "only" | "todo" | "concurrent")[];
};

/**
 * Parsed test file with its tests.
 */
export type TestFile = {
  path: string;
  relativePath: string;
  tests: TestCase[];
  imports: string[];
  sourceFile?: string; // The source file this test covers
  framework: "vitest" | "jest" | "mocha" | "unknown";
};

/**
 * Test coverage summary.
 */
export type TestCoverageSummary = {
  totalTestFiles: number;
  totalTests: number;
  totalSuites: number;
  skippedTests: number;
  todoTests: number;
  byDirectory: Record<string, { files: number; tests: number }>;
  uncoveredSourceFiles: string[];
};

/**
 * Affected tests for changed files.
 */
export type AffectedTests = {
  changedFiles: string[];
  directlyAffected: TestFile[];
  indirectlyAffected: TestFile[];
  testCommands: string[];
};

/**
 * Test discovery configuration.
 */
export type TestDiscoveryConfig = {
  rootDir: string;
  testPatterns: string[];
  excludePatterns: string[];
  sourceDir?: string;
};

const DEFAULT_TEST_PATTERNS = [
  "**/*.test.ts",
  "**/*.test.tsx",
  "**/*.spec.ts",
  "**/*.spec.tsx",
  "**/__tests__/**/*.ts",
  "**/__tests__/**/*.tsx",
];

const DEFAULT_EXCLUDE_PATTERNS = ["**/node_modules/**", "**/dist/**", "**/build/**", "**/.git/**"];

/**
 * Test Discovery tool for finding and analyzing tests.
 */
export class TestDiscovery {
  private readonly config: TestDiscoveryConfig;
  private testFileCache: Map<string, TestFile> = new Map();

  constructor(config: Partial<TestDiscoveryConfig> & { rootDir: string }) {
    this.config = {
      testPatterns: DEFAULT_TEST_PATTERNS,
      excludePatterns: DEFAULT_EXCLUDE_PATTERNS,
      ...config,
    };
  }

  /**
   * Find all test files in the project.
   */
  async findTestFiles(): Promise<TestFile[]> {
    const testFiles: TestFile[] = [];
    await this.walkDirectory(this.config.rootDir, async (filePath) => {
      if (this.isTestFile(filePath)) {
        const testFile = await this.parseTestFile(filePath);
        testFiles.push(testFile);
        this.testFileCache.set(filePath, testFile);
      }
    });
    return testFiles;
  }

  /**
   * Walk directory recursively.
   */
  private async walkDirectory(
    dir: string,
    callback: (filePath: string) => Promise<void>,
  ): Promise<void> {
    try {
      const entries = await readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = join(dir, entry.name);
        const relativePath = relative(this.config.rootDir, fullPath);

        // Skip excluded directories
        if (this.isExcluded(relativePath)) {
          continue;
        }

        if (entry.isDirectory()) {
          await this.walkDirectory(fullPath, callback);
        } else if (entry.isFile()) {
          await callback(fullPath);
        }
      }
    } catch {
      // Directory might not exist or be unreadable
    }
  }

  /**
   * Check if a path is excluded.
   */
  private isExcluded(relativePath: string): boolean {
    for (const pattern of this.config.excludePatterns) {
      if (this.matchGlob(relativePath, pattern)) {
        return true;
      }
    }
    return false;
  }

  /**
   * Check if a file is a test file.
   */
  private isTestFile(filePath: string): boolean {
    const relativePath = relative(this.config.rootDir, filePath);
    for (const pattern of this.config.testPatterns) {
      if (this.matchGlob(relativePath, pattern)) {
        return true;
      }
    }
    return false;
  }

  /**
   * Simple glob matching (supports * and **).
   */
  private matchGlob(path: string, pattern: string): boolean {
    // Convert glob to regex
    // Order matters: escape special chars first, then handle globs
    const regexStr = pattern
      .replace(/\./g, "\\.") // Escape dots first
      .replace(/\?/g, ".") // ? matches any single char
      .replace(/\*\*/g, "<<<DOUBLESTAR>>>") // Temp placeholder for **
      .replace(/\*/g, "[^/]*") // * matches anything except /
      .replace(/<<<DOUBLESTAR>>>/g, ".*"); // ** matches anything including /
    const regex = new RegExp(`^${regexStr}$`);
    return regex.test(path);
  }

  /**
   * Parse a test file and extract test cases.
   */
  async parseTestFile(filePath: string): Promise<TestFile> {
    const content = await readFile(filePath, "utf-8");
    const lines = content.split("\n");

    const tests: TestCase[] = [];
    const imports: string[] = [];
    let framework: TestFile["framework"] = "unknown";

    // Track describe blocks for parent context
    const describeStack: string[] = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const lineNum = i + 1;

      // Detect imports
      const importMatch = line.match(/^import\s+.*from\s+['"](.+)['"]/);
      if (importMatch) {
        imports.push(importMatch[1]);
        // Detect framework from imports
        if (importMatch[1].includes("vitest")) {
          framework = "vitest";
        } else if (importMatch[1].includes("jest")) {
          framework = "jest";
        } else if (importMatch[1].includes("mocha")) {
          framework = "mocha";
        }
      }

      // Detect describe blocks
      const describeMatch = line.match(/\b(describe(?:\.skip|\.only)?)\s*\(\s*['"`](.+?)['"`]/);
      if (describeMatch) {
        const modifiers = this.extractModifiers(describeMatch[1]);
        const name = describeMatch[2];
        describeStack.push(name);
        tests.push({
          name,
          type: "describe",
          line: lineNum,
          parent: describeStack.length > 1 ? describeStack[describeStack.length - 2] : undefined,
          modifiers,
        });
      }

      // Detect test/it blocks
      const testMatch = line.match(
        /\b(test|it)(?:\.(skip|only|todo|concurrent))?\s*\(\s*['"`](.+?)['"`]/,
      );
      if (testMatch) {
        const modifiers = testMatch[2] ? [testMatch[2] as TestCase["modifiers"][number]] : [];
        tests.push({
          name: testMatch[3],
          type: testMatch[1] as "test" | "it",
          line: lineNum,
          parent: describeStack.length > 0 ? describeStack[describeStack.length - 1] : undefined,
          modifiers,
        });
      }

      // Detect end of describe block (simple heuristic)
      if (line.match(/^\s*\}\s*\)\s*;?\s*$/) && describeStack.length > 0) {
        // Check if this closes a describe block
        const prevLines = lines.slice(Math.max(0, i - 10), i).join("\n");
        if (prevLines.includes("describe")) {
          describeStack.pop();
        }
      }
    }

    // Try to find corresponding source file
    const sourceFile = this.findSourceFile(filePath);

    return {
      path: filePath,
      relativePath: relative(this.config.rootDir, filePath),
      tests,
      imports,
      sourceFile,
      framework,
    };
  }

  /**
   * Extract modifiers from test function name.
   */
  private extractModifiers(funcName: string): TestCase["modifiers"] {
    const modifiers: TestCase["modifiers"] = [];
    if (funcName.includes(".skip")) modifiers.push("skip");
    if (funcName.includes(".only")) modifiers.push("only");
    if (funcName.includes(".todo")) modifiers.push("todo");
    if (funcName.includes(".concurrent")) modifiers.push("concurrent");
    return modifiers;
  }

  /**
   * Find the source file that a test file covers.
   */
  private findSourceFile(testPath: string): string | undefined {
    const dir = dirname(testPath);
    const base = basename(testPath);

    // Remove test suffix
    const sourceBase = base
      .replace(/\.test\.(ts|tsx|js|jsx)$/, ".$1")
      .replace(/\.spec\.(ts|tsx|js|jsx)$/, ".$1");

    if (sourceBase === base) {
      return undefined;
    }

    // Check same directory
    const sameDirPath = join(dir, sourceBase);

    // Check parent directory (for __tests__ folders)
    const parentDirPath = join(dirname(dir), sourceBase);

    // Check src directory
    if (this.config.sourceDir) {
      const relativePath = relative(this.config.rootDir, testPath);
      const srcPath = join(
        this.config.rootDir,
        this.config.sourceDir,
        relativePath.replace(/__tests__\//, "").replace(/\.test\./, "."),
      );
      return srcPath;
    }

    return sameDirPath;
  }

  /**
   * Find tests affected by changed files.
   */
  async findAffectedTests(changedFiles: string[]): Promise<AffectedTests> {
    const allTests = await this.findTestFiles();
    const directlyAffected: TestFile[] = [];
    const indirectlyAffected: TestFile[] = [];

    // Normalize changed files to relative paths
    const normalizedChanged = changedFiles.map((f) =>
      f.startsWith("/") ? relative(this.config.rootDir, f) : f,
    );

    for (const testFile of allTests) {
      // Check if the test file itself changed
      if (normalizedChanged.includes(testFile.relativePath)) {
        directlyAffected.push(testFile);
        continue;
      }

      // Check if the source file being tested changed
      if (testFile.sourceFile) {
        const relativeSource = relative(this.config.rootDir, testFile.sourceFile);
        if (normalizedChanged.includes(relativeSource)) {
          directlyAffected.push(testFile);
          continue;
        }
      }

      // Check if any imported module changed
      for (const imp of testFile.imports) {
        // Skip external packages
        if (!imp.startsWith(".") && !imp.startsWith("/")) {
          continue;
        }

        // Resolve import path
        const testDir = dirname(testFile.path);
        const importPath = join(testDir, imp);
        const normalizedImport = relative(this.config.rootDir, importPath);

        // Check various extensions
        for (const ext of [".ts", ".tsx", ".js", ".jsx", ""]) {
          if (normalizedChanged.includes(normalizedImport + ext)) {
            indirectlyAffected.push(testFile);
            break;
          }
        }
      }
    }

    // Generate test commands
    const testCommands: string[] = [];
    const affectedPaths = [...directlyAffected, ...indirectlyAffected].map((t) => t.relativePath);
    if (affectedPaths.length > 0) {
      testCommands.push(`pnpm test -- --run ${affectedPaths.join(" ")}`);
    }

    return {
      changedFiles,
      directlyAffected,
      indirectlyAffected,
      testCommands,
    };
  }

  /**
   * Generate test coverage summary.
   */
  async getCoverageSummary(): Promise<TestCoverageSummary> {
    const testFiles = await this.findTestFiles();

    let totalTests = 0;
    let totalSuites = 0;
    let skippedTests = 0;
    let todoTests = 0;
    const byDirectory: Record<string, { files: number; tests: number }> = {};

    // Track covered source files
    const coveredFiles = new Set<string>();

    for (const testFile of testFiles) {
      const dir = dirname(testFile.relativePath);
      if (!byDirectory[dir]) {
        byDirectory[dir] = { files: 0, tests: 0 };
      }
      byDirectory[dir].files++;

      for (const test of testFile.tests) {
        if (test.type === "describe" || test.type === "suite") {
          totalSuites++;
        } else {
          totalTests++;
          byDirectory[dir].tests++;
        }

        if (test.modifiers?.includes("skip")) {
          skippedTests++;
        }
        if (test.modifiers?.includes("todo")) {
          todoTests++;
        }
      }

      if (testFile.sourceFile) {
        coveredFiles.add(testFile.sourceFile);
      }
    }

    // Find uncovered source files
    const uncoveredSourceFiles: string[] = [];
    const sourceDir = this.config.sourceDir ?? "src";
    await this.walkDirectory(join(this.config.rootDir, sourceDir), async (filePath) => {
      if (
        filePath.endsWith(".ts") &&
        !filePath.includes(".test.") &&
        !filePath.includes(".spec.")
      ) {
        if (!coveredFiles.has(filePath)) {
          uncoveredSourceFiles.push(relative(this.config.rootDir, filePath));
        }
      }
    });

    return {
      totalTestFiles: testFiles.length,
      totalTests,
      totalSuites,
      skippedTests,
      todoTests,
      byDirectory,
      uncoveredSourceFiles,
    };
  }

  /**
   * Get tests matching a pattern.
   */
  async findTestsByPattern(pattern: string): Promise<TestFile[]> {
    const allTests = await this.findTestFiles();
    const regex = new RegExp(pattern, "i");

    return allTests.filter((testFile) => {
      // Match file path
      if (regex.test(testFile.relativePath)) {
        return true;
      }

      // Match test names
      for (const test of testFile.tests) {
        if (regex.test(test.name)) {
          return true;
        }
      }

      return false;
    });
  }

  /**
   * Clear the cache.
   */
  clearCache(): void {
    this.testFileCache.clear();
  }
}

/**
 * Create a TestDiscovery instance for the default project.
 */
export function createTestDiscovery(rootDir?: string): TestDiscovery {
  return new TestDiscovery({
    rootDir: rootDir ?? process.cwd(),
    sourceDir: "src",
  });
}

// ============================================================================
// Standalone Helper Functions
// ============================================================================

/**
 * Test pattern discovered in a directory.
 */
export type TestPattern = {
  pattern: string;
  type: "suffix" | "directory" | "prefix";
  count: number;
  examples: string[];
};

/**
 * Result from running tests.
 */
export type TestResult = {
  success: boolean;
  testFiles: string[];
  passed: number;
  failed: number;
  skipped: number;
  duration: number;
  output: string;
  error?: string;
};

/**
 * Find test files related to a given source file.
 * Looks for *.test.ts, *.spec.ts, and __tests__/ patterns.
 */
export async function findRelatedTests(sourceFile: string, rootDir?: string): Promise<string[]> {
  const discovery = createTestDiscovery(rootDir);
  const affected = await discovery.findAffectedTests([sourceFile]);
  return [...affected.directlyAffected, ...affected.indirectlyAffected].map((t) => t.path);
}

/**
 * Discover test patterns used in a directory.
 * Returns patterns like *.test.ts, *.spec.ts, __tests__/, etc.
 */
export async function discoverTestPatterns(dir: string): Promise<TestPattern[]> {
  const patterns: Map<string, { type: TestPattern["type"]; files: string[] }> = new Map();

  const discovery = new TestDiscovery({ rootDir: dir });
  const testFiles = await discovery.findTestFiles();

  for (const testFile of testFiles) {
    const relativePath = testFile.relativePath;

    // Check for suffix patterns
    if (relativePath.includes(".test.")) {
      const key = "*.test.*";
      if (!patterns.has(key)) {
        patterns.set(key, { type: "suffix", files: [] });
      }
      patterns.get(key)!.files.push(relativePath);
    } else if (relativePath.includes(".spec.")) {
      const key = "*.spec.*";
      if (!patterns.has(key)) {
        patterns.set(key, { type: "suffix", files: [] });
      }
      patterns.get(key)!.files.push(relativePath);
    }

    // Check for __tests__ directory pattern
    if (relativePath.includes("__tests__/")) {
      const key = "__tests__/";
      if (!patterns.has(key)) {
        patterns.set(key, { type: "directory", files: [] });
      }
      patterns.get(key)!.files.push(relativePath);
    }

    // Check for test/ or tests/ directory pattern
    if (relativePath.match(/^tests?\//)) {
      const key = "test(s)/";
      if (!patterns.has(key)) {
        patterns.set(key, { type: "directory", files: [] });
      }
      patterns.get(key)!.files.push(relativePath);
    }
  }

  return Array.from(patterns.entries()).map(([pattern, data]) => ({
    pattern,
    type: data.type,
    count: data.files.length,
    examples: data.files.slice(0, 5),
  }));
}

/**
 * Map source files to their corresponding test files.
 * Returns a Map where keys are source files and values are arrays of test files.
 */
export async function mapSourceToTests(sourceDir: string): Promise<Map<string, string[]>> {
  const mapping = new Map<string, string[]>();
  const discovery = new TestDiscovery({ rootDir: sourceDir, sourceDir: "src" });
  const testFiles = await discovery.findTestFiles();

  for (const testFile of testFiles) {
    if (testFile.sourceFile) {
      const existing = mapping.get(testFile.sourceFile) ?? [];
      existing.push(testFile.path);
      mapping.set(testFile.sourceFile, existing);
    }
  }

  return mapping;
}

/**
 * Run tests related to a source file change.
 * Uses pnpm test by default (vitest).
 */
export async function runRelatedTests(sourceFile: string, rootDir?: string): Promise<TestResult> {
  const root = rootDir ?? process.cwd();
  const relatedTests = await findRelatedTests(sourceFile, root);

  if (relatedTests.length === 0) {
    return {
      success: true,
      testFiles: [],
      passed: 0,
      failed: 0,
      skipped: 0,
      duration: 0,
      output: "No related tests found",
    };
  }

  const testPaths = relatedTests.map((t) => relative(root, t)).join(" ");
  const startTime = Date.now();

  try {
    const output = execSync(`pnpm test -- --run ${testPaths}`, {
      cwd: root,
      encoding: "utf-8",
      timeout: 300000, // 5 minute timeout
      stdio: ["pipe", "pipe", "pipe"],
    });

    // Parse vitest output for stats
    const passedMatch = output.match(/(\d+)\s+passed/);
    const failedMatch = output.match(/(\d+)\s+failed/);
    const skippedMatch = output.match(/(\d+)\s+skipped/);

    return {
      success: true,
      testFiles: relatedTests,
      passed: passedMatch ? parseInt(passedMatch[1], 10) : 0,
      failed: failedMatch ? parseInt(failedMatch[1], 10) : 0,
      skipped: skippedMatch ? parseInt(skippedMatch[1], 10) : 0,
      duration: Date.now() - startTime,
      output,
    };
  } catch (err: unknown) {
    const error = err as { stdout?: string; stderr?: string; message?: string };
    const output = (error.stdout ?? "") + (error.stderr ?? "");

    // Parse output even on failure
    const passedMatch = output.match(/(\d+)\s+passed/);
    const failedMatch = output.match(/(\d+)\s+failed/);
    const skippedMatch = output.match(/(\d+)\s+skipped/);

    return {
      success: false,
      testFiles: relatedTests,
      passed: passedMatch ? parseInt(passedMatch[1], 10) : 0,
      failed: failedMatch ? parseInt(failedMatch[1], 10) : 1,
      skipped: skippedMatch ? parseInt(skippedMatch[1], 10) : 0,
      duration: Date.now() - startTime,
      output,
      error: error.message,
    };
  }
}
