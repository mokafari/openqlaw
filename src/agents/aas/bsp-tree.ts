/**
 * BSP State Trees - Context Depth Partitioning
 *
 * Inspired by Quake III's Binary Space Partitioning, this partitions
 * the agent's knowledge space by contextual depth to reduce context
 * window clutter. When an agent is working at Level 3 (local file),
 * it shouldn't be distracted by Level 0 (global OS) unless explicitly
 * needed.
 */

import path from "node:path";
import type { OpenClawConfig } from "../../config/config.js";

export type ContextDepth =
  | 0 // Global OS / Environment Variables
  | 1 // Project Root / package.json
  | 2 // Module / Directory Level
  | 3; // Local File / Function Level

export type ContextDepthInfo = {
  depth: ContextDepth;
  path: string;
  description: string;
};

/**
 * Determine the context depth from a workspace path
 */
export function getContextDepth(filePath: string, workspaceRoot?: string): ContextDepth {
  if (!filePath || !workspaceRoot) {
    return 0; // Global level if no path context
  }

  const normalizedPath = path.normalize(filePath);
  const normalizedRoot = path.normalize(workspaceRoot);
  const relativePath = path.relative(normalizedRoot, normalizedPath);

  // If path is outside workspace, it's global
  if (relativePath.startsWith("..")) {
    return 0;
  }

  // Count directory depth from workspace root
  const parts = relativePath.split(path.sep).filter((p) => p.length > 0);

  if (parts.length === 0) {
    return 1; // At root
  }

  // Level 1: Project root files (package.json, README.md, etc.)
  if (parts.length === 1 && isRootLevelFile(parts[0]!)) {
    return 1;
  }

  // Level 2: Module/directory level (src/, docs/, etc.)
  if (parts.length <= 2) {
    return 2;
  }

  // Level 3: Local file/function level (deep in directory tree)
  return 3;
}

/**
 * Check if a filename is a root-level configuration file
 */
function isRootLevelFile(filename: string): boolean {
  const rootFiles = [
    "package.json",
    "package-lock.json",
    "pnpm-lock.yaml",
    "yarn.lock",
    "README.md",
    "LICENSE",
    ".gitignore",
    ".env",
    ".env.local",
    "tsconfig.json",
    "jsconfig.json",
    "pyproject.toml",
    "Cargo.toml",
    "go.mod",
    "requirements.txt",
    "Pipfile",
    "poetry.lock",
    "SOUL.md",
  ];
  return rootFiles.includes(filename);
}

/**
 * Get context depth information for a path
 */
export function getContextDepthInfo(filePath: string, workspaceRoot?: string): ContextDepthInfo {
  const depth = getContextDepth(filePath, workspaceRoot);
  const descriptions: Record<ContextDepth, string> = {
    0: "Global OS / Environment Variables",
    1: "Project Root / package.json",
    2: "Module / Directory Level",
    3: "Local File / Function Level",
  };

  return {
    depth,
    path: filePath,
    description: descriptions[depth],
  };
}

/**
 * Filter context by depth - only include items at or near current depth
 *
 * This reduces context window clutter by excluding irrelevant levels.
 * For example, when working at Level 3 (local file), Level 0 (global OS)
 * context is excluded unless explicitly needed.
 */
export function filterContextByDepth<T extends { path?: string; depth?: ContextDepth }>(
  items: T[],
  currentDepth: ContextDepth,
  workspaceRoot?: string,
  maxDepthDiff: number = 1,
): T[] {
  return items.filter((item) => {
    // If item has explicit depth, use it
    if (item.depth != null) {
      const depthDiff = Math.abs(item.depth - currentDepth);
      return depthDiff <= maxDepthDiff;
    }

    // Otherwise, calculate depth from path
    if (item.path) {
      const itemDepth = getContextDepth(item.path, workspaceRoot);
      const depthDiff = Math.abs(itemDepth - currentDepth);
      return depthDiff <= maxDepthDiff;
    }

    // If no path or depth, include it (might be global context)
    return currentDepth === 0;
  });
}

/**
 * Get "portals" - context that bridges depth levels
 *
 * In Quake, portals connect areas. Here, portals are files/contexts
 * that should be visible across depth boundaries (e.g., package.json
 * is visible from any depth).
 */
export function getContextPortals(workspaceRoot?: string): string[] {
  if (!workspaceRoot) {
    return [];
  }

  const portalFiles = ["package.json", "tsconfig.json", "README.md", ".gitignore", "SOUL.md"];

  return portalFiles
    .map((file) => path.join(workspaceRoot, file))
    .filter((filePath) => {
      // In a real implementation, we'd check if file exists
      // For now, return all potential portals
      return true;
    });
}

/**
 * Check if a path is a context portal (visible across all depths)
 */
export function isContextPortal(filePath: string, workspaceRoot?: string): boolean {
  if (!workspaceRoot) {
    return false;
  }

  const relativePath = path.relative(workspaceRoot, filePath);
  const filename = path.basename(relativePath);
  return isRootLevelFile(filename) && path.dirname(relativePath) === ".";
}
