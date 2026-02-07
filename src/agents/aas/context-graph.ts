/**
 * Context Graph - High-level reachability checks
 *
 * Provides named reachability checks like CanCommit, CanDeploy, CanBuild, etc.
 * as specified in the Quake Bot integration docs.
 *
 * Each capability check returns detailed diagnostics explaining why it failed.
 */

import { exec } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import type { ReachabilityCheckContext } from "./types.js";
import { checkReachabilityType } from "./reachability.js";

const execAsync = promisify(exec);

export type NamedCapability =
  | "CanCommit"
  | "CanDeploy"
  | "CanRead"
  | "CanWrite"
  | "CanNetwork"
  // Self-debugging capabilities
  | "CanBuild"
  | "CanTest"
  | "CanLint"
  | "CanRestart"
  | "CanRollback"
  | "CanDebugNode"
  | "CanProfile";

/**
 * Array of all named capabilities (for iteration/validation)
 */
export const NAMED_CAPABILITIES: readonly NamedCapability[] = [
  "CanCommit",
  "CanDeploy",
  "CanRead",
  "CanWrite",
  "CanNetwork",
  // Self-debugging capabilities
  "CanBuild",
  "CanTest",
  "CanLint",
  "CanRestart",
  "CanRollback",
  "CanDebugNode",
  "CanProfile",
] as const;

/**
 * Detailed check result with diagnostics
 */
export interface CapabilityCheckResult {
  available: boolean;
  missing: string[];
  reason?: string;
  requiredAction?: string;
  diagnostics?: {
    cliTools?: Record<string, boolean>;
    configFiles?: Record<string, boolean>;
    other?: Record<string, boolean | string>;
  };
}

/**
 * Commit status details
 */
export interface CommitStatus {
  canCommit: boolean;
  hasGitRepo: boolean;
  hasUserEmail: boolean;
  hasUserName: boolean;
  workingTreeClean: boolean | null;
  reason?: string;
}

/**
 * Deployment status details
 */
export interface DeploymentStatus {
  canDeploy: boolean;
  hasDockerfile: boolean;
  hasDockerCli: boolean;
  dockerDaemonRunning: boolean | null;
  reason?: string;
  dockerVersion?: string;
  deployTarget?: string;
}

// Cache for capability checks (cleared on workspace changes)
const capabilityCache = new Map<string, { result: CapabilityCheckResult; timestamp: number }>();
const CACHE_TTL_MS = 5000; // 5 second cache

/**
 * Check if a CLI tool is available in PATH
 */
async function checkCli(command: string): Promise<boolean> {
  try {
    await execAsync(`which ${command}`);
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if a file exists
 */
async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath, fs.constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if a directory exists
 */
async function dirExists(dirPath: string): Promise<boolean> {
  try {
    const stat = await fs.stat(dirPath);
    return stat.isDirectory();
  } catch {
    return false;
  }
}

/**
 * Context Graph - Provides high-level capability checks
 */
export class ContextGraph {
  /**
   * Clear the capability cache
   */
  static clearCache(): void {
    capabilityCache.clear();
  }

  /**
   * Check if a named capability is available
   *
   * @example
   * ```typescript
   * if (ContextGraph.check(ctx, 'CanDeploy')) {
   *   // Safe to propose deployment
   * } else {
   *   // Prerequisite missing: Plan a route to "fix docker" first
   * }
   * ```
   */
  static async check(
    context: ReachabilityCheckContext,
    capability: NamedCapability,
  ): Promise<boolean> {
    const result = await this.checkDetailed(context, capability);
    return result.available;
  }

  /**
   * Get detailed check result with missing prerequisites and diagnostics
   */
  static async checkDetailed(
    context: ReachabilityCheckContext,
    capability: NamedCapability,
  ): Promise<CapabilityCheckResult> {
    // Check cache
    const cacheKey = `${capability}:${context.workspaceDir || ""}`;
    const cached = capabilityCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
      return cached.result;
    }

    let result: CapabilityCheckResult;

    switch (capability) {
      case "CanCommit":
        result = await this._checkCanCommitDetailed(context);
        break;
      case "CanDeploy":
        result = await this._checkCanDeployDetailed(context);
        break;
      case "CanRead":
        result = await this._checkCanRead(context);
        break;
      case "CanWrite":
        result = await this._checkCanWrite(context);
        break;
      case "CanNetwork":
        result = await this._checkCanNetwork(context);
        break;
      case "CanBuild":
        result = await this._checkCanBuild(context);
        break;
      case "CanTest":
        result = await this._checkCanTest(context);
        break;
      case "CanLint":
        result = await this._checkCanLint(context);
        break;
      case "CanRestart":
        result = await this._checkCanRestart(context);
        break;
      case "CanRollback":
        result = await this._checkCanRollback(context);
        break;
      case "CanDebugNode":
        result = await this._checkCanDebugNode(context);
        break;
      case "CanProfile":
        result = await this._checkCanProfile(context);
        break;
      default:
        result = { available: false, missing: ["Unknown capability"] };
    }

    // Update cache
    capabilityCache.set(cacheKey, { result, timestamp: Date.now() });
    return result;
  }

  /**
   * Check commit capability and return status object
   */
  static async checkCanCommit(context: ReachabilityCheckContext): Promise<CommitStatus> {
    if (!context.workspaceDir) {
      return {
        canCommit: false,
        hasGitRepo: false,
        hasUserEmail: false,
        hasUserName: false,
        workingTreeClean: null,
        reason: "No workspace directory specified",
      };
    }

    const gitDir = path.join(context.workspaceDir, ".git");
    const hasGitRepo = await dirExists(gitDir);

    let hasUserEmail = false;
    let hasUserName = false;
    let workingTreeClean: boolean | null = null;

    if (hasGitRepo) {
      try {
        const { stdout: email } = await execAsync("git config user.email", {
          cwd: context.workspaceDir,
        });
        hasUserEmail = email.trim().length > 0;
      } catch {
        hasUserEmail = false;
      }

      try {
        const { stdout: name } = await execAsync("git config user.name", {
          cwd: context.workspaceDir,
        });
        hasUserName = name.trim().length > 0;
      } catch {
        hasUserName = false;
      }

      try {
        const { stdout } = await execAsync("git status --porcelain", {
          cwd: context.workspaceDir,
        });
        workingTreeClean = stdout.trim().length === 0;
      } catch {
        workingTreeClean = null;
      }
    }

    // Determine reason for failure
    let reason: string | undefined;
    if (!hasGitRepo) {
      reason = "Not a git repository";
    } else if (!hasUserEmail) {
      reason = "Git user.email not configured";
    }

    return {
      canCommit: hasGitRepo && hasUserEmail,
      hasGitRepo,
      hasUserEmail,
      hasUserName,
      workingTreeClean,
      reason,
    };
  }

  /**
   * Check deployment capability and return status object
   */
  static async checkCanDeploy(context: ReachabilityCheckContext): Promise<DeploymentStatus> {
    if (!context.workspaceDir) {
      return {
        canDeploy: false,
        hasDockerfile: false,
        hasDockerCli: false,
        dockerDaemonRunning: null,
        reason: "No workspace directory specified",
      };
    }

    const dockerfile = path.join(context.workspaceDir, "Dockerfile");
    const hasDockerfile = await fileExists(dockerfile);
    const hasDockerCli = await checkCli("docker");

    let dockerDaemonRunning: boolean | null = null;
    let dockerVersion: string | undefined;
    if (hasDockerCli) {
      try {
        const { stdout } = await execAsync("docker --version", { timeout: 5000 });
        dockerVersion = stdout.trim();
      } catch {
        // Version check failed, but CLI exists
      }
      try {
        await execAsync("docker ps", { timeout: 5000 });
        dockerDaemonRunning = true;
      } catch {
        dockerDaemonRunning = false;
      }
    }

    // Determine reason for failure
    let reason: string | undefined;
    if (!hasDockerfile) {
      reason = "No Dockerfile found in workspace";
    } else if (!hasDockerCli) {
      reason = "Docker CLI not available";
    } else if (!dockerDaemonRunning) {
      reason = "Docker daemon not running";
    }

    const canDeploy = hasDockerfile && hasDockerCli && dockerDaemonRunning === true;

    return {
      canDeploy,
      hasDockerfile,
      hasDockerCli,
      dockerDaemonRunning,
      reason,
      dockerVersion,
      deployTarget: canDeploy ? "docker" : undefined,
    };
  }

  /**
   * Check multiple capabilities at once
   */
  static async checkAll(
    context: ReachabilityCheckContext,
    capabilities: NamedCapability[],
  ): Promise<Record<NamedCapability, CapabilityCheckResult>> {
    const results: Partial<Record<NamedCapability, CapabilityCheckResult>> = {};
    for (const cap of capabilities) {
      results[cap] = await this.checkDetailed(context, cap);
    }
    return results as Record<NamedCapability, CapabilityCheckResult>;
  }

  /**
   * CanCommit: Requires .git folder + user.email config
   */
  private static async _checkCanCommitDetailed(
    context: ReachabilityCheckContext,
  ): Promise<CapabilityCheckResult> {
    const missing: string[] = [];
    const cliTools: Record<string, boolean> = {};
    const configFiles: Record<string, boolean> = {};
    const other: Record<string, boolean | string> = {};

    if (!context.workspaceDir) {
      return {
        available: false,
        missing: ["workspaceDir not set"],
        reason: "No workspace directory specified",
      };
    }

    // Check for git CLI
    cliTools["git"] = await checkCli("git");
    if (!cliTools["git"]) {
      missing.push("git CLI");
      return {
        available: false,
        missing,
        reason: "Git CLI not found",
        requiredAction: "Install git",
        diagnostics: { cliTools, configFiles, other },
      };
    }

    // Check for .git folder
    const gitDir = path.join(context.workspaceDir, ".git");
    configFiles[".git"] = await dirExists(gitDir);
    if (!configFiles[".git"]) {
      missing.push(".git folder");
      return {
        available: false,
        missing,
        reason: "Not a git repository",
        requiredAction: "Run 'git init' to initialize repository",
        diagnostics: { cliTools, configFiles, other },
      };
    }

    // Check for git user.email config
    try {
      const { stdout } = await execAsync("git config user.email", {
        cwd: context.workspaceDir,
      });
      other["user.email"] = stdout.trim() || false;
      if (!other["user.email"]) {
        missing.push("git user.email config");
      }
    } catch {
      other["user.email"] = false;
      missing.push("git user.email config");
    }

    if (missing.length > 0) {
      return {
        available: false,
        missing,
        reason: "Git configuration incomplete",
        requiredAction: "Run 'git config user.email \"you@example.com\"'",
        diagnostics: { cliTools, configFiles, other },
      };
    }

    return {
      available: true,
      missing: [],
      diagnostics: { cliTools, configFiles, other },
    };
  }

  /**
   * CanDeploy: Requires Dockerfile + docker CLI + Running Daemon
   */
  private static async _checkCanDeployDetailed(
    context: ReachabilityCheckContext,
  ): Promise<CapabilityCheckResult> {
    const missing: string[] = [];
    const cliTools: Record<string, boolean> = {};
    const configFiles: Record<string, boolean> = {};
    const other: Record<string, boolean | string> = {};

    if (!context.workspaceDir) {
      return {
        available: false,
        missing: ["workspaceDir not set"],
        reason: "No workspace directory specified",
      };
    }

    // Check for Dockerfile first (most common issue)
    const dockerfile = path.join(context.workspaceDir, "Dockerfile");
    configFiles["Dockerfile"] = await fileExists(dockerfile);
    if (!configFiles["Dockerfile"]) {
      missing.push("Dockerfile");
      return {
        available: false,
        missing,
        reason: "No Dockerfile found in workspace",
        requiredAction: "Create a Dockerfile in the workspace root",
        diagnostics: { cliTools, configFiles, other },
      };
    }

    // Check for docker CLI
    cliTools["docker"] = await checkCli("docker");
    if (!cliTools["docker"]) {
      missing.push("docker CLI");
      return {
        available: false,
        missing,
        reason: "Docker CLI not found",
        requiredAction: "Install Docker",
        diagnostics: { cliTools, configFiles, other },
      };
    }

    // Check for running daemon
    try {
      await execAsync("docker ps", { timeout: 5000 });
      other["docker daemon"] = true;
    } catch {
      other["docker daemon"] = false;
      missing.push("running Docker daemon");
      return {
        available: false,
        missing,
        reason: "Docker daemon not running",
        requiredAction: "Start Docker daemon",
        diagnostics: { cliTools, configFiles, other },
      };
    }

    return {
      available: true,
      missing: [],
      diagnostics: { cliTools, configFiles, other },
    };
  }

  /**
   * CanRead: Basic read permissions
   */
  private static async _checkCanRead(
    context: ReachabilityCheckContext,
  ): Promise<CapabilityCheckResult> {
    const available = await checkReachabilityType("READ", context);
    return {
      available,
      missing: available ? [] : ["READ permissions"],
      reason: available ? undefined : "Read permissions not available",
    };
  }

  /**
   * CanWrite: Write permissions
   */
  private static async _checkCanWrite(
    context: ReachabilityCheckContext,
  ): Promise<CapabilityCheckResult> {
    const available = await checkReachabilityType("WRITE", context);
    return {
      available,
      missing: available ? [] : ["WRITE permissions"],
      reason: available ? undefined : "Write permissions not available",
    };
  }

  /**
   * CanNetwork: Network connectivity
   */
  private static async _checkCanNetwork(
    context: ReachabilityCheckContext,
  ): Promise<CapabilityCheckResult> {
    const available = await checkReachabilityType("NETWORK", context);
    return {
      available,
      missing: available ? [] : ["NETWORK connectivity"],
      reason: available ? undefined : "Network connectivity not available",
    };
  }

  /**
   * CanBuild: pnpm/npm available + package.json exists + tsconfig.json exists
   */
  private static async _checkCanBuild(
    context: ReachabilityCheckContext,
  ): Promise<CapabilityCheckResult> {
    const missing: string[] = [];
    const cliTools: Record<string, boolean> = {};
    const configFiles: Record<string, boolean> = {};

    if (!context.workspaceDir) {
      return {
        available: false,
        missing: ["workspaceDir not set"],
        reason: "No workspace directory specified",
      };
    }

    // Check for package managers
    cliTools["pnpm"] = await checkCli("pnpm");
    cliTools["npm"] = await checkCli("npm");
    if (!cliTools["pnpm"] && !cliTools["npm"]) {
      missing.push("pnpm or npm");
    }

    // Check for package.json
    const packageJson = path.join(context.workspaceDir, "package.json");
    configFiles["package.json"] = await fileExists(packageJson);
    if (!configFiles["package.json"]) {
      missing.push("package.json");
    }

    // Check for tsconfig.json
    const tsconfig = path.join(context.workspaceDir, "tsconfig.json");
    configFiles["tsconfig.json"] = await fileExists(tsconfig);
    if (!configFiles["tsconfig.json"]) {
      missing.push("tsconfig.json");
    }

    return {
      available: missing.length === 0,
      missing,
      reason: missing.length > 0 ? "Build prerequisites missing" : undefined,
      requiredAction: missing.length > 0 ? `Install/create: ${missing.join(", ")}` : undefined,
      diagnostics: { cliTools, configFiles },
    };
  }

  /**
   * CanTest: vitest/jest configured + test directory exists
   */
  private static async _checkCanTest(
    context: ReachabilityCheckContext,
  ): Promise<CapabilityCheckResult> {
    const missing: string[] = [];
    const cliTools: Record<string, boolean> = {};
    const configFiles: Record<string, boolean> = {};
    const other: Record<string, boolean | string> = {};

    if (!context.workspaceDir) {
      return {
        available: false,
        missing: ["workspaceDir not set"],
        reason: "No workspace directory specified",
      };
    }

    // Check for test runners in CLI
    cliTools["vitest"] = await checkCli("vitest");
    cliTools["jest"] = await checkCli("jest");

    // Check for test configs
    const vitestConfig = path.join(context.workspaceDir, "vitest.config.ts");
    const vitestConfigJs = path.join(context.workspaceDir, "vitest.config.js");
    const vitestConfigMjs = path.join(context.workspaceDir, "vitest.config.mjs");
    const jestConfig = path.join(context.workspaceDir, "jest.config.js");
    const jestConfigTs = path.join(context.workspaceDir, "jest.config.ts");
    const jestConfigJson = path.join(context.workspaceDir, "jest.config.json");

    configFiles["vitest.config"] =
      (await fileExists(vitestConfig)) ||
      (await fileExists(vitestConfigJs)) ||
      (await fileExists(vitestConfigMjs));
    configFiles["jest.config"] =
      (await fileExists(jestConfig)) ||
      (await fileExists(jestConfigTs)) ||
      (await fileExists(jestConfigJson));

    // Check for package.json test script or vitest/jest dependency
    const packageJsonPath = path.join(context.workspaceDir, "package.json");
    let hasTestDep = false;
    let hasTestScript = false;
    try {
      const pkgContent = await fs.readFile(packageJsonPath, "utf-8");
      const pkg = JSON.parse(pkgContent);
      const deps = { ...pkg.dependencies, ...pkg.devDependencies };
      hasTestDep = "vitest" in deps || "jest" in deps;
      hasTestScript = pkg.scripts?.test !== undefined;
      other["test script"] = hasTestScript;
      other["test dependency"] = hasTestDep;
    } catch {
      other["package.json readable"] = false;
    }

    // Check for test directories
    const testDir = path.join(context.workspaceDir, "test");
    const testsDir = path.join(context.workspaceDir, "tests");
    const __testsDir = path.join(context.workspaceDir, "__tests__");
    const srcTestDir = path.join(context.workspaceDir, "src", "__tests__");

    const hasTestDir =
      (await dirExists(testDir)) ||
      (await dirExists(testsDir)) ||
      (await dirExists(__testsDir)) ||
      (await dirExists(srcTestDir));

    // Also check for *.test.ts files in src
    let hasInlineTests = false;
    try {
      const srcDir = path.join(context.workspaceDir, "src");
      if (await dirExists(srcDir)) {
        const { stdout } = await execAsync(
          `find ${srcDir} -name "*.test.ts" -o -name "*.spec.ts" | head -1`,
        );
        hasInlineTests = stdout.trim().length > 0;
      }
    } catch {
      // Ignore find errors
    }

    other["test directory"] = hasTestDir || hasInlineTests;

    // Determine if testing is available
    const hasTestRunner = configFiles["vitest.config"] || configFiles["jest.config"] || hasTestDep;
    const hasTests = hasTestDir || hasInlineTests;

    if (!hasTestRunner) {
      missing.push("vitest or jest configured");
    }
    if (!hasTests) {
      missing.push("test files or directory");
    }

    return {
      available: missing.length === 0,
      missing,
      reason: missing.length > 0 ? "Test infrastructure not configured" : undefined,
      requiredAction: missing.length > 0 ? "Add vitest/jest and create test files" : undefined,
      diagnostics: { cliTools, configFiles, other },
    };
  }

  /**
   * CanLint: ESLint/TypeScript configured
   */
  private static async _checkCanLint(
    context: ReachabilityCheckContext,
  ): Promise<CapabilityCheckResult> {
    const missing: string[] = [];
    const cliTools: Record<string, boolean> = {};
    const configFiles: Record<string, boolean> = {};

    if (!context.workspaceDir) {
      return {
        available: false,
        missing: ["workspaceDir not set"],
        reason: "No workspace directory specified",
      };
    }

    // Check for ESLint CLI
    cliTools["eslint"] = await checkCli("eslint");

    // Check for TypeScript CLI
    cliTools["tsc"] = await checkCli("tsc");

    // Check for ESLint configs
    const eslintrc = path.join(context.workspaceDir, ".eslintrc");
    const eslintrcJson = path.join(context.workspaceDir, ".eslintrc.json");
    const eslintrcJs = path.join(context.workspaceDir, ".eslintrc.js");
    const eslintrcCjs = path.join(context.workspaceDir, ".eslintrc.cjs");
    const eslintConfig = path.join(context.workspaceDir, "eslint.config.js");
    const eslintConfigMjs = path.join(context.workspaceDir, "eslint.config.mjs");

    configFiles["eslint.config"] =
      (await fileExists(eslintrc)) ||
      (await fileExists(eslintrcJson)) ||
      (await fileExists(eslintrcJs)) ||
      (await fileExists(eslintrcCjs)) ||
      (await fileExists(eslintConfig)) ||
      (await fileExists(eslintConfigMjs));

    // Check for TypeScript config
    const tsconfig = path.join(context.workspaceDir, "tsconfig.json");
    configFiles["tsconfig.json"] = await fileExists(tsconfig);

    // Need at least one linter configured
    const hasEslint = configFiles["eslint.config"];
    const hasTypescript = configFiles["tsconfig.json"] && cliTools["tsc"];

    if (!hasEslint && !hasTypescript) {
      if (!configFiles["eslint.config"]) {
        missing.push("ESLint config");
      }
      if (!configFiles["tsconfig.json"]) {
        missing.push("tsconfig.json");
      }
    }

    return {
      available: hasEslint || hasTypescript,
      missing,
      reason: missing.length > 0 ? "No linting configuration found" : undefined,
      requiredAction: missing.length > 0 ? "Configure ESLint or TypeScript" : undefined,
      diagnostics: { cliTools, configFiles },
    };
  }

  /**
   * CanRestart: launchctl or systemd available for gateway restart
   */
  private static async _checkCanRestart(
    context: ReachabilityCheckContext,
  ): Promise<CapabilityCheckResult> {
    const missing: string[] = [];
    const cliTools: Record<string, boolean> = {};
    const other: Record<string, boolean | string> = {};

    // Check for launchctl (macOS)
    cliTools["launchctl"] = await checkCli("launchctl");

    // Check for systemctl (Linux)
    cliTools["systemctl"] = await checkCli("systemctl");

    // Check if OpenClaw service is registered
    if (cliTools["launchctl"]) {
      try {
        const { stdout } = await execAsync("launchctl list | grep openclaw");
        other["openclaw service (launchd)"] = stdout.trim().length > 0;
      } catch {
        other["openclaw service (launchd)"] = false;
      }
    }

    if (cliTools["systemctl"]) {
      try {
        const { stdout } = await execAsync("systemctl list-units --user | grep openclaw");
        other["openclaw service (systemd)"] = stdout.trim().length > 0;
      } catch {
        other["openclaw service (systemd)"] = false;
      }
    }

    // Also check if openclaw CLI has restart capability
    cliTools["openclaw"] = await checkCli("openclaw");
    if (cliTools["openclaw"]) {
      other["openclaw CLI"] = true;
    }

    const hasServiceManager =
      cliTools["launchctl"] || cliTools["systemctl"] || cliTools["openclaw"];

    if (!hasServiceManager) {
      missing.push("launchctl, systemctl, or openclaw CLI");
    }

    return {
      available: hasServiceManager,
      missing,
      reason: missing.length > 0 ? "No service manager available for restart" : undefined,
      requiredAction:
        missing.length > 0 ? "Install launchctl (macOS) or systemctl (Linux)" : undefined,
      diagnostics: { cliTools, other },
    };
  }

  /**
   * CanRollback: git history exists + clean working tree
   */
  private static async _checkCanRollback(
    context: ReachabilityCheckContext,
  ): Promise<CapabilityCheckResult> {
    const missing: string[] = [];
    const cliTools: Record<string, boolean> = {};
    const configFiles: Record<string, boolean> = {};
    const other: Record<string, boolean | string> = {};

    if (!context.workspaceDir) {
      return {
        available: false,
        missing: ["workspaceDir not set"],
        reason: "No workspace directory specified",
      };
    }

    // Check for git CLI
    cliTools["git"] = await checkCli("git");
    if (!cliTools["git"]) {
      missing.push("git CLI");
      return {
        available: false,
        missing,
        reason: "Git not available",
        requiredAction: "Install git",
        diagnostics: { cliTools, configFiles, other },
      };
    }

    // Check for .git folder
    const gitDir = path.join(context.workspaceDir, ".git");
    configFiles[".git"] = await dirExists(gitDir);
    if (!configFiles[".git"]) {
      missing.push(".git folder");
      return {
        available: false,
        missing,
        reason: "Not a git repository",
        requiredAction: "Initialize git repository",
        diagnostics: { cliTools, configFiles, other },
      };
    }

    // Check for git history (at least one commit)
    try {
      const { stdout } = await execAsync("git rev-parse HEAD", {
        cwd: context.workspaceDir,
      });
      other["has commits"] = stdout.trim().length > 0;
    } catch {
      other["has commits"] = false;
      missing.push("git history (no commits)");
    }

    // Check for clean working tree
    try {
      const { stdout } = await execAsync("git status --porcelain", {
        cwd: context.workspaceDir,
      });
      const isClean = stdout.trim().length === 0;
      other["clean working tree"] = isClean;
      if (!isClean) {
        const changedFiles = stdout.trim().split("\n").length;
        other["uncommitted changes"] = `${changedFiles} file(s)`;
        // Note: Not adding to missing - we can still rollback with uncommitted changes,
        // but it's a warning. The stash command can be used.
      }
    } catch {
      other["clean working tree"] = "unknown";
    }

    return {
      available: missing.length === 0,
      missing,
      reason: missing.length > 0 ? "Git rollback prerequisites missing" : undefined,
      requiredAction: missing.length > 0 ? "Ensure git repository has commits" : undefined,
      diagnostics: { cliTools, configFiles, other },
    };
  }

  /**
   * CanDebugNode: Node.js --inspect flag available
   */
  private static async _checkCanDebugNode(
    context: ReachabilityCheckContext,
  ): Promise<CapabilityCheckResult> {
    const missing: string[] = [];
    const cliTools: Record<string, boolean> = {};
    const other: Record<string, boolean | string> = {};

    // Check for Node.js
    cliTools["node"] = await checkCli("node");
    if (!cliTools["node"]) {
      missing.push("Node.js");
      return {
        available: false,
        missing,
        reason: "Node.js not available",
        requiredAction: "Install Node.js",
        diagnostics: { cliTools, other },
      };
    }

    // Get Node.js version
    try {
      const { stdout } = await execAsync("node --version");
      other["node version"] = stdout.trim();
    } catch {
      other["node version"] = "unknown";
    }

    // Check if --inspect is supported (available in all modern Node versions)
    try {
      // Just check that node can understand the --inspect flag
      await execAsync("node --inspect --eval 'process.exit(0)' 2>&1 || true");
      other["--inspect supported"] = true;
    } catch {
      other["--inspect supported"] = false;
      missing.push("Node.js --inspect support");
    }

    // Check for debugging tools
    cliTools["chrome"] = await checkCli("chrome");
    cliTools["node-inspect"] = await checkCli("node-inspect");

    return {
      available: missing.length === 0,
      missing,
      reason: missing.length > 0 ? "Node.js debugging not available" : undefined,
      requiredAction: missing.length > 0 ? "Install Node.js with debugging support" : undefined,
      diagnostics: { cliTools, other },
    };
  }

  /**
   * CanProfile: profiling tools available (perf, flamegraph, clinic)
   */
  private static async _checkCanProfile(
    context: ReachabilityCheckContext,
  ): Promise<CapabilityCheckResult> {
    const missing: string[] = [];
    const cliTools: Record<string, boolean> = {};
    const other: Record<string, boolean | string> = {};

    // Check for Node.js (required for Node profiling)
    cliTools["node"] = await checkCli("node");

    // Check for various profiling tools
    cliTools["clinic"] = await checkCli("clinic");
    cliTools["0x"] = await checkCli("0x");
    cliTools["flamegraph"] = await checkCli("flamegraph");
    cliTools["perf"] = await checkCli("perf");
    cliTools["dtrace"] = await checkCli("dtrace");
    cliTools["autocannon"] = await checkCli("autocannon");

    // Node.js has built-in profiler via --prof
    if (cliTools["node"]) {
      other["node --prof"] = true;
      other["node --cpu-prof"] = true;
      other["node --heap-prof"] = true;
    }

    // Check if at least one profiling tool is available
    const hasProfiler =
      cliTools["clinic"] ||
      cliTools["0x"] ||
      cliTools["flamegraph"] ||
      cliTools["perf"] ||
      cliTools["dtrace"] ||
      (cliTools["node"] && other["node --prof"]);

    if (!hasProfiler) {
      missing.push("profiling tools (clinic, 0x, perf, or Node.js --prof)");
    }

    return {
      available: hasProfiler,
      missing,
      reason: missing.length > 0 ? "No profiling tools available" : undefined,
      requiredAction: missing.length > 0 ? "Install clinic, 0x, or perf" : undefined,
      diagnostics: { cliTools, other },
    };
  }
}

/**
 * Map of tools to their required capabilities
 * Tools may require multiple capabilities to function properly
 */
export const TOOL_REQUIRED_CAPABILITIES: Record<string, NamedCapability[]> = {
  // Build & Development
  "exec:pnpm build": ["CanBuild"],
  "exec:npm build": ["CanBuild"],
  "exec:pnpm test": ["CanTest"],
  "exec:npm test": ["CanTest"],
  "exec:vitest": ["CanTest"],
  "exec:jest": ["CanTest"],
  "exec:eslint": ["CanLint"],
  "exec:tsc --noEmit": ["CanLint"],

  // Version Control
  "exec:git commit": ["CanCommit"],
  "exec:git push": ["CanCommit", "CanNetwork"],
  "exec:git reset": ["CanRollback"],
  "exec:git revert": ["CanRollback"],
  "exec:git stash": ["CanRollback"],

  // Deployment
  "exec:docker build": ["CanDeploy"],
  "exec:docker push": ["CanDeploy", "CanNetwork"],

  // Gateway Management
  "gateway:restart": ["CanRestart"],
  rebuild_gateway: ["CanBuild", "CanRestart"],

  // Debugging
  "exec:node --inspect": ["CanDebugNode"],
  "exec:clinic": ["CanProfile"],
  "exec:0x": ["CanProfile"],
};

/**
 * FSM State - Required capabilities before state transitions
 * Maps agent states to capabilities required to enter them
 */
export const STATE_REQUIRED_CAPABILITIES: Record<string, NamedCapability[]> = {
  // Idle state - no requirements
  idle: [],

  // Planning state - read capability for context gathering
  planning: ["CanRead"],

  // Executing state - depends on what's being executed
  executing: ["CanRead", "CanWrite"],

  // Building state - requires full build capabilities
  building: ["CanBuild"],

  // Testing state - requires test infrastructure
  testing: ["CanTest"],

  // Deploying state - requires deployment capabilities
  deploying: ["CanDeploy", "CanNetwork"],

  // Debugging state - requires debugging capabilities
  debugging: ["CanDebugNode"],

  // Profiling state - requires profiling tools
  profiling: ["CanProfile"],

  // Committing state - requires git capabilities
  committing: ["CanCommit"],

  // Rolling back state - requires rollback capabilities
  rolling_back: ["CanRollback"],

  // Restarting state - requires restart capabilities
  restarting: ["CanRestart"],

  // Camping state - waiting for events, minimal requirements
  camping: [],

  // Retreating state - error recovery, minimal requirements
  retreating: ["CanRead"],

  // Error state - no requirements (already in error)
  error: [],
};

/**
 * Get capabilities required for a state transition
 */
export function getRequiredCapabilitiesForState(state: string): NamedCapability[] {
  return STATE_REQUIRED_CAPABILITIES[state] ?? [];
}

/**
 * Get capabilities required for a tool
 */
export function getRequiredCapabilitiesForTool(tool: string): NamedCapability[] {
  // Check exact match first
  if (TOOL_REQUIRED_CAPABILITIES[tool]) {
    return TOOL_REQUIRED_CAPABILITIES[tool];
  }

  // Check prefix matches (e.g., "exec:git commit -m" matches "exec:git commit")
  for (const [pattern, caps] of Object.entries(TOOL_REQUIRED_CAPABILITIES)) {
    if (tool.startsWith(pattern)) {
      return caps;
    }
  }

  return [];
}

/**
 * Validate capabilities before state transition
 */
export async function validateStateTransition(
  context: ReachabilityCheckContext,
  targetState: string,
): Promise<{
  valid: boolean;
  missingCapabilities: NamedCapability[];
  details: Record<NamedCapability, CapabilityCheckResult>;
}> {
  const requiredCaps = getRequiredCapabilitiesForState(targetState);
  if (requiredCaps.length === 0) {
    return { valid: true, missingCapabilities: [], details: {} as any };
  }

  const results = await ContextGraph.checkAll(context, requiredCaps);
  const missingCapabilities = requiredCaps.filter((cap) => !results[cap].available);

  return {
    valid: missingCapabilities.length === 0,
    missingCapabilities,
    details: results,
  };
}

/**
 * Validate capabilities before tool execution
 */
export async function validateToolExecution(
  context: ReachabilityCheckContext,
  tool: string,
): Promise<{
  valid: boolean;
  missingCapabilities: NamedCapability[];
  details: Record<NamedCapability, CapabilityCheckResult>;
}> {
  const requiredCaps = getRequiredCapabilitiesForTool(tool);
  if (requiredCaps.length === 0) {
    return { valid: true, missingCapabilities: [], details: {} as any };
  }

  const results = await ContextGraph.checkAll(context, requiredCaps);
  const missingCapabilities = requiredCaps.filter((cap) => !results[cap].available);

  return {
    valid: missingCapabilities.length === 0,
    missingCapabilities,
    details: results,
  };
}
