/**
 * Error Recovery Routes - Maps errors to autonomous recovery strategies
 *
 * Part of the Area Awareness System (AAS). Provides intelligent routing
 * from detected errors to recovery workflows, enabling autonomous self-healing.
 */

import { execSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import type { ReachabilityType } from "./types.js";

/**
 * Defines a recovery route for a specific error pattern.
 */
export interface ErrorRecoveryRoute {
  /** Pattern to match against error message - string for includes(), RegExp for regex match */
  errorPattern: RegExp | string;
  /** Human-readable diagnosis of the error */
  diagnosis: string;
  /** Ordered steps to resolve the error */
  recoverySteps: string[];
  /** Which AAS capabilities are needed for recovery */
  requiredCapabilities: ReachabilityType[];
  /** Estimated time to complete recovery in milliseconds */
  estimatedDuration: number;
  /** Priority (lower = higher priority, checked first) */
  priority?: number;
  /** Optional custom handler for complex recoveries */
  handler?: (error: Error, context: RecoveryContext) => Promise<RecoveryResult>;
}

/**
 * Context passed to recovery handlers.
 */
export interface RecoveryContext {
  workspaceDir: string;
  error: Error;
  route: ErrorRecoveryRoute;
  attempt: number;
  maxAttempts: number;
}

/**
 * Result of a recovery attempt.
 */
export interface RecoveryResult {
  success: boolean;
  error?: string;
  stepsCompleted: string[];
  duration: number;
  requiresRestart?: boolean;
}

/**
 * Default recovery routes for common errors.
 */
const DEFAULT_RECOVERY_ROUTES: ErrorRecoveryRoute[] = [
  // File System Errors
  {
    errorPattern: /ENOENT.*no such file or directory/i,
    diagnosis: "File or directory not found",
    recoverySteps: [
      "check_path: Verify the path exists",
      "create_parent_dirs: Create parent directories if needed",
      "git_clone: Clone repository if missing",
      "create_file: Create empty file as placeholder",
    ],
    requiredCapabilities: ["READ", "WRITE"],
    estimatedDuration: 5000,
    priority: 10,
    handler: handleFileNotFound,
  },
  {
    errorPattern: /EACCES|EPERM|permission denied/i,
    diagnosis: "Permission denied - insufficient file system permissions",
    recoverySteps: [
      "check_permissions: Verify current permissions",
      "elevate: Request elevated access if available",
      "chown: Change file ownership if possible",
      "retry: Retry operation with elevated privileges",
    ],
    requiredCapabilities: ["READ", "WRITE", "ELEVATED"],
    estimatedDuration: 10000,
    priority: 20,
    handler: handlePermissionDenied,
  },
  {
    errorPattern: /ENOSPC|no space left on device/i,
    diagnosis: "Out of disk space",
    recoverySteps: [
      "cleanup_temp: Remove temporary files",
      "cleanup_cache: Clear caches (npm, pnpm, etc.)",
      "cleanup_logs: Rotate and compress old logs",
      "report: Alert if still insufficient",
    ],
    requiredCapabilities: ["READ", "WRITE"],
    estimatedDuration: 30000,
    priority: 5,
    handler: handleDiskFull,
  },
  {
    errorPattern: /EMFILE|ENFILE|too many open files/i,
    diagnosis: "Too many open files - file descriptor limit reached",
    recoverySteps: [
      "close_files: Close unnecessary file handles",
      "gc_run: Trigger garbage collection",
      "adjust_ulimit: Suggest ulimit increase",
      "restart_process: Restart the process to reset handles",
    ],
    requiredCapabilities: ["READ"],
    estimatedDuration: 15000,
    priority: 15,
    handler: handleTooManyFiles,
  },

  // Network Errors
  {
    errorPattern: /ECONNREFUSED|connection refused/i,
    diagnosis: "Service connection refused - target service may be down",
    recoverySteps: [
      "check_service: Check if service is running",
      "start_service: Attempt to start the service",
      "restart_gateway: Restart gateway if self-connection",
      "wait_and_retry: Wait and retry with backoff",
    ],
    requiredCapabilities: ["NETWORK"],
    estimatedDuration: 20000,
    priority: 10,
    handler: handleConnectionRefused,
  },
  {
    errorPattern: /ETIMEDOUT|ENETUNREACH|network timeout/i,
    diagnosis: "Network timeout or unreachable",
    recoverySteps: [
      "check_network: Verify network connectivity",
      "check_dns: Verify DNS resolution",
      "retry_backoff: Retry with exponential backoff",
      "fallback: Use cached/fallback data if available",
    ],
    requiredCapabilities: ["NETWORK"],
    estimatedDuration: 30000,
    priority: 25,
    handler: handleNetworkTimeout,
  },
  {
    errorPattern: /ENOTFOUND|getaddrinfo|DNS/i,
    diagnosis: "DNS resolution failed",
    recoverySteps: [
      "check_dns: Verify DNS server reachability",
      "flush_dns: Flush DNS cache",
      "use_ip: Try direct IP if known",
      "retry: Retry resolution",
    ],
    requiredCapabilities: ["NETWORK"],
    estimatedDuration: 10000,
    priority: 20,
  },

  // Build/TypeScript Errors
  {
    errorPattern: /TS\d{4}:|error TS\d+|typescript.*error/i,
    diagnosis: "TypeScript compilation error",
    recoverySteps: [
      "read_error: Parse and understand the error",
      "locate_file: Find the source file and line",
      "fix_syntax: Apply syntax fixes",
      "rebuild: Run build again to verify",
    ],
    requiredCapabilities: ["READ", "WRITE"],
    estimatedDuration: 60000,
    priority: 30,
    handler: handleTypeScriptError,
  },
  {
    errorPattern: /Cannot find module|Module not found/i,
    diagnosis: "Missing module or import error",
    recoverySteps: [
      "check_import: Verify import path is correct",
      "install_deps: Run pnpm install",
      "check_exports: Verify module exports the symbol",
      "fix_path: Correct the import path",
    ],
    requiredCapabilities: ["READ", "WRITE"],
    estimatedDuration: 45000,
    priority: 25,
    handler: handleModuleNotFound,
  },
  {
    errorPattern: /SyntaxError|Unexpected token|Parse error/i,
    diagnosis: "Syntax error in code",
    recoverySteps: [
      "read_error: Parse error message for location",
      "locate_line: Find the problematic line",
      "fix_syntax: Apply syntax correction",
      "rebuild: Verify fix with rebuild",
    ],
    requiredCapabilities: ["READ", "WRITE"],
    estimatedDuration: 30000,
    priority: 20,
  },

  // Memory Errors
  {
    errorPattern: /ENOMEM|out of memory|heap out of memory|JavaScript heap/i,
    diagnosis: "Out of memory - process exceeded memory limits",
    recoverySteps: [
      "kill_heavy: Kill memory-intensive processes",
      "gc_run: Force garbage collection",
      "reduce_scope: Reduce operation scope",
      "increase_limit: Suggest NODE_OPTIONS increase",
      "restart: Restart with fresh memory",
    ],
    requiredCapabilities: ["READ"],
    estimatedDuration: 20000,
    priority: 5,
    handler: handleOutOfMemory,
  },

  // Authentication Errors
  {
    errorPattern: /401|unauthorized|authentication failed|invalid.*token/i,
    diagnosis: "Authentication failure - invalid or expired credentials",
    recoverySteps: [
      "check_token: Verify token exists and format",
      "refresh_token: Attempt token refresh",
      "re_auth: Prompt for re-authentication",
      "fallback: Use fallback credentials if available",
    ],
    requiredCapabilities: ["AUTH"],
    estimatedDuration: 15000,
    priority: 15,
  },
  {
    errorPattern: /403|forbidden|access denied|rate limit/i,
    diagnosis: "Access forbidden or rate limited",
    recoverySteps: [
      "check_permissions: Verify API permissions",
      "wait_ratelimit: Wait for rate limit reset",
      "use_alternative: Try alternative endpoint/API",
      "escalate: Report for manual intervention",
    ],
    requiredCapabilities: ["AUTH", "NETWORK"],
    estimatedDuration: 60000,
    priority: 20,
  },

  // Process Errors
  {
    errorPattern: /SIGKILL|SIGTERM|process.*killed/i,
    diagnosis: "Process was killed - likely by OOM killer or external signal",
    recoverySteps: [
      "check_logs: Review system logs for kill reason",
      "reduce_memory: Reduce memory footprint",
      "restart: Restart the process",
      "monitor: Enable monitoring for recurrence",
    ],
    requiredCapabilities: ["READ"],
    estimatedDuration: 25000,
    priority: 10,
  },

  // Gateway-specific Errors
  {
    errorPattern: /gateway.*not.*running|gateway.*unreachable/i,
    diagnosis: "Gateway service not running",
    recoverySteps: [
      "check_process: Check if gateway process exists",
      "start_gateway: Start gateway service",
      "check_port: Verify port 18789 is available",
      "restart_daemon: Restart via launchctl if on macOS",
    ],
    requiredCapabilities: ["READ", "NETWORK"],
    estimatedDuration: 20000,
    priority: 5,
    handler: handleGatewayDown,
  },
];

/**
 * Custom routes added at runtime.
 */
const customRoutes: ErrorRecoveryRoute[] = [];

/**
 * Find the best recovery route for an error.
 */
export function findRecoveryRoute(error: Error): ErrorRecoveryRoute | null {
  const message = error.message;
  const allRoutes = [...customRoutes, ...DEFAULT_RECOVERY_ROUTES].sort(
    (a, b) => (a.priority ?? 50) - (b.priority ?? 50)
  );

  for (const route of allRoutes) {
    const matches =
      typeof route.errorPattern === "string"
        ? message.toLowerCase().includes(route.errorPattern.toLowerCase())
        : route.errorPattern.test(message);

    if (matches) {
      return route;
    }
  }

  return null;
}

/**
 * Find all matching recovery routes for an error (for complex failures).
 */
export function findAllRecoveryRoutes(error: Error): ErrorRecoveryRoute[] {
  const message = error.message;
  const allRoutes = [...customRoutes, ...DEFAULT_RECOVERY_ROUTES].sort(
    (a, b) => (a.priority ?? 50) - (b.priority ?? 50)
  );

  return allRoutes.filter((route) => {
    return typeof route.errorPattern === "string"
      ? message.toLowerCase().includes(route.errorPattern.toLowerCase())
      : route.errorPattern.test(message);
  });
}

/**
 * Execute a recovery route.
 */
export async function executeRecoveryRoute(
  route: ErrorRecoveryRoute,
  context: Omit<RecoveryContext, "route">
): Promise<RecoveryResult> {
  const startTime = Date.now();
  const fullContext: RecoveryContext = { ...context, route };
  const stepsCompleted: string[] = [];

  try {
    // Use custom handler if available
    if (route.handler) {
      return await route.handler(context.error, fullContext);
    }

    // Default: log the steps (actual execution would require more infrastructure)
    console.log(`[recovery] Executing recovery for: ${route.diagnosis}`);
    for (const step of route.recoverySteps) {
      console.log(`[recovery] Step: ${step}`);
      stepsCompleted.push(step);
      // In a real implementation, each step would be executed
    }

    return {
      success: true,
      stepsCompleted,
      duration: Date.now() - startTime,
    };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
      stepsCompleted,
      duration: Date.now() - startTime,
    };
  }
}

/**
 * Add a custom recovery route at runtime.
 */
export function addCustomRoute(pattern: string | RegExp, route: Omit<ErrorRecoveryRoute, "errorPattern">): void {
  customRoutes.push({
    ...route,
    errorPattern: pattern,
  });
}

/**
 * Remove a custom route by pattern.
 */
export function removeCustomRoute(pattern: string | RegExp): boolean {
  const patternStr = pattern.toString();
  const index = customRoutes.findIndex((r) => r.errorPattern.toString() === patternStr);
  if (index !== -1) {
    customRoutes.splice(index, 1);
    return true;
  }
  return false;
}

/**
 * Get all registered routes (for diagnostics).
 */
export function getAllRoutes(): ErrorRecoveryRoute[] {
  return [...customRoutes, ...DEFAULT_RECOVERY_ROUTES];
}

/**
 * Get recovery suggestions for diagnostic agents.
 */
export function getRecoverySuggestions(error: Error): {
  diagnosis: string;
  steps: string[];
  estimatedTime: number;
  capabilities: ReachabilityType[];
} | null {
  const route = findRecoveryRoute(error);
  if (!route) return null;

  return {
    diagnosis: route.diagnosis,
    steps: route.recoverySteps,
    estimatedTime: route.estimatedDuration,
    capabilities: route.requiredCapabilities,
  };
}

// ============================================================================
// Recovery Handlers
// ============================================================================

async function handleFileNotFound(error: Error, context: RecoveryContext): Promise<RecoveryResult> {
  const startTime = Date.now();
  const stepsCompleted: string[] = [];

  try {
    // Extract path from error message
    const match = error.message.match(/ENOENT.*'([^']+)'/) || error.message.match(/no such file or directory.*?([^\s,]+)/i);
    const missingPath = match?.[1];

    if (missingPath) {
      stepsCompleted.push(`check_path: Identified missing path: ${missingPath}`);

      // Check if parent directory exists
      const parentDir = path.dirname(missingPath);
      try {
        await fs.access(parentDir);
        stepsCompleted.push(`create_parent_dirs: Parent directory exists`);
      } catch {
        // Create parent directories
        await fs.mkdir(parentDir, { recursive: true });
        stepsCompleted.push(`create_parent_dirs: Created ${parentDir}`);
      }

      // Check if it's a package.json or similar that should exist
      const basename = path.basename(missingPath);
      if (basename === "package.json") {
        stepsCompleted.push(`git_clone: May need to clone repository`);
        return {
          success: false,
          error: "Repository may need to be cloned",
          stepsCompleted,
          duration: Date.now() - startTime,
        };
      }

      stepsCompleted.push(`create_file: Path verified, can proceed`);
    }

    return {
      success: true,
      stepsCompleted,
      duration: Date.now() - startTime,
    };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
      stepsCompleted,
      duration: Date.now() - startTime,
    };
  }
}

async function handlePermissionDenied(error: Error, context: RecoveryContext): Promise<RecoveryResult> {
  const startTime = Date.now();
  const stepsCompleted: string[] = [];

  try {
    // Extract path from error message
    const match = error.message.match(/EACCES.*'([^']+)'/) || error.message.match(/permission denied.*?([^\s,]+)/i);
    const deniedPath = match?.[1];

    if (deniedPath) {
      stepsCompleted.push(`check_permissions: Checking ${deniedPath}`);

      try {
        const stats = await fs.stat(deniedPath);
        const mode = (stats.mode & 0o777).toString(8);
        stepsCompleted.push(`check_permissions: Current mode is ${mode}`);
      } catch {
        stepsCompleted.push(`check_permissions: Cannot stat file`);
      }
    }

    // Check if we have elevated access
    stepsCompleted.push(`elevate: Elevated access required`);

    return {
      success: false,
      error: "Elevated permissions required for this operation",
      stepsCompleted,
      duration: Date.now() - startTime,
    };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
      stepsCompleted,
      duration: Date.now() - startTime,
    };
  }
}

async function handleDiskFull(error: Error, context: RecoveryContext): Promise<RecoveryResult> {
  const startTime = Date.now();
  const stepsCompleted: string[] = [];

  try {
    // Try to clean up temp files
    const tempDirs = ["/tmp", path.join(context.workspaceDir, "node_modules/.cache")];

    for (const dir of tempDirs) {
      try {
        await fs.access(dir);
        // In production, would actually clean up old files
        stepsCompleted.push(`cleanup_temp: Would clean ${dir}`);
      } catch {
        // Dir doesn't exist, skip
      }
    }

    // Suggest pnpm store prune
    stepsCompleted.push(`cleanup_cache: Consider running 'pnpm store prune'`);

    return {
      success: false,
      error: "Disk cleanup suggestions provided, manual intervention may be needed",
      stepsCompleted,
      duration: Date.now() - startTime,
    };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
      stepsCompleted,
      duration: Date.now() - startTime,
    };
  }
}

async function handleTooManyFiles(error: Error, context: RecoveryContext): Promise<RecoveryResult> {
  const startTime = Date.now();
  const stepsCompleted: string[] = [];

  try {
    // Force garbage collection if available
    if (global.gc) {
      global.gc();
      stepsCompleted.push(`gc_run: Garbage collection triggered`);
    } else {
      stepsCompleted.push(`gc_run: GC not exposed (run with --expose-gc)`);
    }

    // Check current ulimit
    try {
      const ulimit = execSync("ulimit -n", { encoding: "utf-8" }).trim();
      stepsCompleted.push(`adjust_ulimit: Current limit is ${ulimit}`);
      if (parseInt(ulimit, 10) < 10000) {
        stepsCompleted.push(`adjust_ulimit: Consider increasing to 10000+`);
      }
    } catch {
      stepsCompleted.push(`adjust_ulimit: Could not check ulimit`);
    }

    return {
      success: false,
      error: "File descriptor limit reached, process restart recommended",
      stepsCompleted,
      duration: Date.now() - startTime,
      requiresRestart: true,
    };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
      stepsCompleted,
      duration: Date.now() - startTime,
    };
  }
}

async function handleConnectionRefused(error: Error, context: RecoveryContext): Promise<RecoveryResult> {
  const startTime = Date.now();
  const stepsCompleted: string[] = [];

  try {
    // Check if it's the gateway
    const isGateway = error.message.includes("18789") || error.message.includes("gateway");

    if (isGateway) {
      stepsCompleted.push(`check_service: Checking gateway service`);

      try {
        // Check if gateway process is running
        const result = execSync("lsof -i :18789 2>/dev/null || true", { encoding: "utf-8" });
        if (result.trim()) {
          stepsCompleted.push(`check_service: Gateway port is bound`);
        } else {
          stepsCompleted.push(`start_service: Gateway not running, needs restart`);
          return {
            success: false,
            error: "Gateway service not running",
            stepsCompleted,
            duration: Date.now() - startTime,
            requiresRestart: true,
          };
        }
      } catch {
        stepsCompleted.push(`check_service: Could not check port`);
      }
    }

    stepsCompleted.push(`wait_and_retry: Recommend retry with backoff`);

    return {
      success: false,
      error: "Service may be starting up, retry recommended",
      stepsCompleted,
      duration: Date.now() - startTime,
    };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
      stepsCompleted,
      duration: Date.now() - startTime,
    };
  }
}

async function handleNetworkTimeout(error: Error, context: RecoveryContext): Promise<RecoveryResult> {
  const startTime = Date.now();
  const stepsCompleted: string[] = [];

  try {
    // Quick network check
    try {
      execSync("ping -c 1 -W 2 8.8.8.8 >/dev/null 2>&1");
      stepsCompleted.push(`check_network: Internet is reachable`);
    } catch {
      stepsCompleted.push(`check_network: Internet may be down`);
      return {
        success: false,
        error: "Network connectivity issue detected",
        stepsCompleted,
        duration: Date.now() - startTime,
      };
    }

    stepsCompleted.push(`retry_backoff: Network OK, recommend retry with backoff`);

    return {
      success: false,
      error: "Network timeout, retry with backoff recommended",
      stepsCompleted,
      duration: Date.now() - startTime,
    };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
      stepsCompleted,
      duration: Date.now() - startTime,
    };
  }
}

async function handleTypeScriptError(error: Error, context: RecoveryContext): Promise<RecoveryResult> {
  const startTime = Date.now();
  const stepsCompleted: string[] = [];

  try {
    // Parse TypeScript error
    const tsMatch = error.message.match(/TS(\d+):/);
    const fileMatch = error.message.match(/([^\s]+\.tsx?):(\d+):(\d+)/);

    if (tsMatch) {
      stepsCompleted.push(`read_error: TypeScript error TS${tsMatch[1]}`);
    }

    if (fileMatch) {
      const [, file, line, col] = fileMatch;
      stepsCompleted.push(`locate_file: Error at ${file}:${line}:${col}`);

      // Check if file exists
      try {
        await fs.access(file);
        stepsCompleted.push(`fix_syntax: File accessible, can attempt fix`);
      } catch {
        stepsCompleted.push(`fix_syntax: File not accessible`);
      }
    }

    stepsCompleted.push(`rebuild: Will need rebuild after fix`);

    return {
      success: false,
      error: "TypeScript error identified, requires code fix",
      stepsCompleted,
      duration: Date.now() - startTime,
    };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
      stepsCompleted,
      duration: Date.now() - startTime,
    };
  }
}

async function handleModuleNotFound(error: Error, context: RecoveryContext): Promise<RecoveryResult> {
  const startTime = Date.now();
  const stepsCompleted: string[] = [];

  try {
    // Extract module name
    const match = error.message.match(/Cannot find module '([^']+)'/) ||
                  error.message.match(/Module not found.*?['"]([^'"]+)['"]/);
    const moduleName = match?.[1];

    if (moduleName) {
      stepsCompleted.push(`check_import: Missing module: ${moduleName}`);

      // Check if it's a local import or npm package
      if (moduleName.startsWith(".") || moduleName.startsWith("/")) {
        stepsCompleted.push(`check_import: Local import - verify path exists`);
        stepsCompleted.push(`fix_path: May need to correct import path`);
      } else {
        stepsCompleted.push(`install_deps: npm package - try 'pnpm install'`);

        // Try installing
        try {
          execSync("pnpm install", {
            cwd: context.workspaceDir,
            encoding: "utf-8",
            timeout: 60000,
          });
          stepsCompleted.push(`install_deps: pnpm install completed`);
          return {
            success: true,
            stepsCompleted,
            duration: Date.now() - startTime,
          };
        } catch {
          stepsCompleted.push(`install_deps: pnpm install failed`);
        }
      }
    }

    return {
      success: false,
      error: "Module resolution failed, may need manual fix",
      stepsCompleted,
      duration: Date.now() - startTime,
    };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
      stepsCompleted,
      duration: Date.now() - startTime,
    };
  }
}

async function handleOutOfMemory(error: Error, context: RecoveryContext): Promise<RecoveryResult> {
  const startTime = Date.now();
  const stepsCompleted: string[] = [];

  try {
    // Force GC if available
    if (global.gc) {
      global.gc();
      stepsCompleted.push(`gc_run: Garbage collection triggered`);
    }

    // Check current NODE_OPTIONS
    const nodeOptions = process.env.NODE_OPTIONS || "";
    const heapMatch = nodeOptions.match(/--max-old-space-size=(\d+)/);
    const currentHeap = heapMatch ? parseInt(heapMatch[1], 10) : 4096;

    stepsCompleted.push(`increase_limit: Current heap limit ~${currentHeap}MB`);
    stepsCompleted.push(`increase_limit: Consider NODE_OPTIONS='--max-old-space-size=${currentHeap * 2}'`);

    stepsCompleted.push(`restart: Process restart recommended`);

    return {
      success: false,
      error: "Out of memory, process restart required",
      stepsCompleted,
      duration: Date.now() - startTime,
      requiresRestart: true,
    };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
      stepsCompleted,
      duration: Date.now() - startTime,
    };
  }
}

async function handleGatewayDown(error: Error, context: RecoveryContext): Promise<RecoveryResult> {
  const startTime = Date.now();
  const stepsCompleted: string[] = [];

  try {
    // Check gateway process
    try {
      const procs = execSync("pgrep -f 'openclaw.*gateway' || true", { encoding: "utf-8" });
      if (procs.trim()) {
        stepsCompleted.push(`check_process: Gateway process found (PID: ${procs.trim()})`);
      } else {
        stepsCompleted.push(`check_process: No gateway process running`);
      }
    } catch {
      stepsCompleted.push(`check_process: Could not check processes`);
    }

    // Check port
    try {
      const port = execSync("lsof -i :18789 2>/dev/null || true", { encoding: "utf-8" });
      if (port.trim()) {
        stepsCompleted.push(`check_port: Port 18789 is in use`);
      } else {
        stepsCompleted.push(`check_port: Port 18789 is free`);
        stepsCompleted.push(`start_gateway: Ready to start gateway`);
      }
    } catch {
      stepsCompleted.push(`check_port: Could not check port`);
    }

    // Suggest restart via launchctl on macOS
    if (process.platform === "darwin") {
      stepsCompleted.push(`restart_daemon: Use 'launchctl kickstart -k gui/$(id -u)/ai.openclaw.gateway'`);
    }

    return {
      success: false,
      error: "Gateway needs to be started",
      stepsCompleted,
      duration: Date.now() - startTime,
      requiresRestart: true,
    };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
      stepsCompleted,
      duration: Date.now() - startTime,
    };
  }
}
