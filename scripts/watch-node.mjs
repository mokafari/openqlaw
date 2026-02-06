#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import { existsSync, watch } from "node:fs";
import { join } from "node:path";
import process from "node:process";

const args = process.argv.slice(2);
const env = { ...process.env, OPENCLAW_DEV_WATCH: "1" };
const cwd = process.cwd();
const compiler = "tsdown";
const DEBOUNCE_MS = 500;
const ENTRY_FILE = join(cwd, "dist", "entry.js");

const initialBuild = spawnSync("pnpm", ["exec", compiler], {
  cwd,
  env,
  stdio: "inherit",
});

if (initialBuild.status !== 0) {
  process.exit(initialBuild.status ?? 1);
}

const compilerProcess = spawn("pnpm", ["exec", compiler, "--watch"], {
  cwd,
  env,
  stdio: "inherit",
});

let nodeProcess = null;
let exiting = false;
let debounceTimer = null;

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

function restartNode() {
  if (exiting) {
    return;
  }
  if (nodeProcess) {
    const old = nodeProcess;
    nodeProcess = null;
    old.removeAllListeners("exit");
    old.kill("SIGTERM");
    // Wait for old process to exit before spawning new one
    old.on("exit", () => {
      if (!exiting) {
        nodeProcess = spawnNode();
      }
    });
    // Safety: force-kill after 3s if graceful shutdown stalls
    setTimeout(() => {
      try {
        old.kill("SIGKILL");
      } catch {}
    }, 3000);
  } else {
    nodeProcess = spawnNode();
  }
}

// Initial spawn
nodeProcess = spawnNode();

// Watch dist/ for build output changes and debounce restarts.
// tsdown cleans dist/ before rebuilding, so we must verify entry.js exists
// before restarting — otherwise we restart into a deleted dist/.
const distDir = join(cwd, "dist");
try {
  watch(distDir, { recursive: true }, (event, filename) => {
    if (!filename || exiting) {
      return;
    }
    // "rename" events fire on both create and delete; ignore bare deletes
    // by only scheduling a restart when the entry file is present.
    if (debounceTimer) {
      clearTimeout(debounceTimer);
    }
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      if (!existsSync(ENTRY_FILE)) {
        // Build still in progress (dist/ was cleaned but not yet repopulated)
        return;
      }
      console.log(`[watch-node] dist/ changed (${filename}), restarting…`);
      restartNode();
    }, DEBOUNCE_MS);
  });
} catch (err) {
  console.error("[watch-node] Failed to watch dist/:", err.message);
  // Fall through — dev server still works, just won't auto-restart
}

function cleanup(code = 0) {
  if (exiting) {
    return;
  }
  exiting = true;
  if (debounceTimer) {
    clearTimeout(debounceTimer);
  }
  if (nodeProcess) {
    nodeProcess.kill("SIGTERM");
  }
  compilerProcess.kill("SIGTERM");
  process.exit(code);
}

process.on("SIGINT", () => cleanup(130));
process.on("SIGTERM", () => cleanup(143));

compilerProcess.on("exit", (code) => {
  if (exiting) {
    return;
  }
  cleanup(code ?? 1);
});
