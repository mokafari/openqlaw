#!/usr/bin/env node

import { existsSync } from "node:fs";
import module from "node:module";
import { join } from "node:path";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

// https://nodejs.org/api/module.html#module-compile-cache
if (module.enableCompileCache && !process.env.NODE_DISABLE_COMPILE_CACHE) {
  try {
    module.enableCompileCache();
  } catch {
    // Ignore errors
  }
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const entryPath = join(__dirname, "dist", "entry.js");

// Wait for entry.js to exist (handles race condition after build)
if (!existsSync(entryPath)) {
  console.error(`Error: Cannot find module '${entryPath}'`);
  console.error("The build may not have completed yet. Run 'pnpm build' first.");
  process.exit(1);
}

await import("./dist/entry.js");
