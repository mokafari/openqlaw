#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import { existsSync, watch } from "node:fs";
import { join } from "node:path";
import { dirname } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const args = process.argv.slice(2);
const env = { ...process.env, OPENCLAW_DEV_WATCH: "1" };
const cwd = process.cwd();
const compiler = "tsdown";
const ENTRY_FILE = join(cwd, "dist", "entry.js");

const initialBuild = spawnSync("pnpm", ["exec", compiler], {
  cwd,
  env,
  stdio: "inherit",
});

if (initialBuild.status !== 0) {
  process.exit(initialBuild.status ?? 1);
}

// Capture build output for failure detection
let buildOutput = "";
let buildErrorOutput = "";

const compilerProcess = spawn("pnpm", ["exec", compiler, "--watch"], {
  cwd,
  env,
  stdio: ["inherit", "pipe", "pipe"],
});

// Capture stdout
compilerProcess.stdout?.on("data", (chunk) => {
  const text = chunk.toString();
  process.stdout.write(text); // Still output to console
  buildOutput += text;
  // Check for build failures
  detectBuildFailure(text);
});

// Capture stderr
compilerProcess.stderr?.on("data", (chunk) => {
  const text = chunk.toString();
  process.stderr.write(text); // Still output to console
  buildErrorOutput += text;
  buildOutput += text;
  // Check for build failures
  detectBuildFailure(text);
});

let nodeProcess = null;
let exiting = false;
let healthMonitorHandle = null;

function spawnNode() {
  const child = spawn(process.execPath, ["openclaw.mjs", ...args], {
    cwd,
    env,
    stdio: "inherit",
  });
  child.on("exit", (code, signal) => {
    if (signal || exiting) {
      return;
    }
    // If entry.js is missing, the build is in progress — wait for it
    if (!existsSync(ENTRY_FILE)) {
      console.log("[watch-node] Node exited while dist/ is being rebuilt. Waiting for build…");
      nodeProcess = null;
      return;
    }
    // Real crash — propagate
    cleanup(code ?? 1);
  });
  return child;
}

// NO automatic restart on file changes - agent controls rebuilds via rebuild_gateway tool
// Watch dist/ for build output changes (log only, no auto-restart)
const distDir = join(cwd, "dist");
try {
  watch(distDir, { recursive: true }, (event, filename) => {
    if (!filename || exiting) {
      return;
    }
    // Just log changes, don't auto-restart
    console.log(
      `[watch-node] File changed: ${filename} (not auto-restarting - agent can trigger rebuild via rebuild_gateway tool)`,
    );
  });
} catch (err) {
  console.error("[watch-node] Failed to watch dist/:", err.message);
  // Fall through — dev server still works
}

// Start health monitor
async function startHealthMonitor() {
  try {
    // Import health monitor (ESM import from dist)
    // Note: This requires the code to be built first
    const healthMonitorPath = join(cwd, "dist", "agents", "evolution", "health-monitor.js");
    if (!existsSync(healthMonitorPath)) {
      console.warn("[watch-node] Health monitor not available (dist not built), skipping");
      return;
    }

    const healthMonitorModule = await import(`file://${healthMonitorPath}`);
    const { HealthMonitor } = healthMonitorModule;

    const monitor = new HealthMonitor({
      intervalMs: 3600000, // 1 hour
      spawnAgentOnFailure: true,
      healthCheckTimeout: 10000,
      onUnhealthy: async () => {
        console.log("[watch-node] Gateway unhealthy, spawning agent for investigation...");
        // Agent will decide what to do
      },
    });

    healthMonitorHandle = monitor.start();
    console.log("[watch-node] Health monitor started (hourly checks)");
  } catch (err) {
    console.warn("[watch-node] Failed to start health monitor:", err.message);
    // Continue without health monitor
  }
}

// Detect build failures and spawn recovery agent
let lastFailureTime = 0;
const FAILURE_DEBOUNCE_MS = 10000; // Don't trigger recovery more than once per 10 seconds

async function detectBuildFailure(output) {
  // Check for TypeScript errors
  const hasError = /error\s+TS\d+:/i.test(output) || /Build failed/i.test(output);

  if (hasError) {
    const now = Date.now();
    if (now - lastFailureTime < FAILURE_DEBOUNCE_MS) {
      return; // Debounce rapid failures
    }
    lastFailureTime = now;

    console.log("[watch-node] Build failure detected, spawning recovery agent...");
    try {
      // Import recovery system from dist
      const recoveryPath = join(cwd, "dist", "agents", "evolution", "gateway-recovery.js");
      if (!existsSync(recoveryPath)) {
        console.warn("[watch-node] Recovery system not available (dist not built), skipping");
        return;
      }

      const recoveryModule = await import(`file://${recoveryPath}`);
      const { GatewayRecovery } = recoveryModule;

      const recovery = new GatewayRecovery({
        workspaceDir: cwd,
        maxRetries: 3,
        agentStrategy: "claude-code",
      });

      await recovery.handleBuildFailure({
        buildLog: buildOutput + buildErrorOutput,
        workspaceDir: cwd,
      });
    } catch (err) {
      console.error("[watch-node] Failed to spawn recovery agent:", err.message);
      // Continue watching
    }
  }
}

// Initial spawn
nodeProcess = spawnNode();

// Start health monitor
void startHealthMonitor();

function cleanup(code = 0) {
  if (exiting) {
    return;
  }
  exiting = true;
  if (healthMonitorHandle) {
    healthMonitorHandle.stop();
  }
  if (nodeProcess) {
    nodeProcess.kill("SIGTERM");
  }
  compilerProcess.kill("SIGTERM");
  process.exit(code);
}

process.on("SIGINT", () => cleanup(130));
process.on("SIGTERM", () => cleanup(143));

compilerProcess.on("exit", async (code) => {
  if (exiting) {
    return;
  }

  // Check if build failed
  if (code !== 0) {
    console.log("[watch-node] Build process exited with error, attempting recovery...");
    try {
      const recoveryPath = join(cwd, "dist", "agents", "evolution", "gateway-recovery.js");
      if (existsSync(recoveryPath)) {
        const recoveryModule = await import(`file://${recoveryPath}`);
        const { GatewayRecovery } = recoveryModule;

        const recovery = new GatewayRecovery({
          workspaceDir: cwd,
          maxRetries: 3,
          agentStrategy: "claude-code",
        });

        await recovery.handleBuildFailure({
          buildLog: buildOutput + buildErrorOutput,
          workspaceDir: cwd,
          exitCode: code,
        });
      } else {
        console.warn("[watch-node] Recovery system not available (dist not built)");
      }
    } catch (err) {
      console.error("[watch-node] Recovery failed:", err.message);
    }
  }

  // Don't exit on build failure - continue watching
  // Only exit on explicit termination
  if (code === null || code === 0) {
    // Normal exit
    cleanup(0);
  }
  // Otherwise continue watching (build failures are handled by recovery)
});
