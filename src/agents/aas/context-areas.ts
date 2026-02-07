/**
 * Context Areas - Discrete zones in the agent's digital environment
 *
 * Each area represents a distinct operational context with its own
 * set of available tools and state requirements.
 */

import type { ContextArea } from "./types.js";

export const CONTEXT_AREAS: Record<string, ContextArea> = {
  filesystem: {
    id: "filesystem",
    name: "File System",
    description: "Local file system operations",
    tools: ["read", "write", "edit", "apply_patch", "grep", "find", "ls"],
    preconditions: [],
    entryActions: [],
    // Note: Don't require READ/WRITE here - individual tools have different requirements.
    // The read tool needs READ, write tool needs WRITE, etc. Reachability checks
    // should be done per-tool, not per-area, to avoid blocking write when READ is unavailable.
  },
  browser: {
    id: "browser",
    name: "Web Browser",
    description: "Browser automation and web interaction",
    tools: ["browser"],
    preconditions: ["browser.open"],
    entryActions: ["browser.open"],
    exitActions: ["browser.close"],
  },
  messaging: {
    id: "messaging",
    name: "Messaging Channels",
    description: "Communication with users via channels",
    tools: ["message", "sessions_send", "sessions_spawn"],
    preconditions: [],
    entryActions: [],
  },
  terminal: {
    id: "terminal",
    name: "Terminal/Shell",
    description: "Command execution and process management",
    tools: ["exec", "process"],
    preconditions: [],
    entryActions: [],
  },
  web: {
    id: "web",
    name: "Web Services",
    description: "Web search and HTTP requests",
    tools: ["web_search", "web_fetch"],
    preconditions: [],
    entryActions: [],
    requiredReachability: ["NETWORK"],
  },
  scheduling: {
    id: "scheduling",
    name: "Scheduling & Automation",
    description: "Cron jobs and node automation",
    tools: ["cron", "nodes"],
    preconditions: [],
    entryActions: [],
  },
  system: {
    id: "system",
    name: "System Management",
    description: "Gateway and agent management",
    tools: ["gateway", "agents_list", "session_status", "sessions_list", "sessions_history"],
    preconditions: [],
    entryActions: [],
  },
  canvas: {
    id: "canvas",
    name: "Canvas UI",
    description: "Interactive UI rendering",
    tools: ["canvas"],
    preconditions: [],
    entryActions: [],
  },
};

export function getContextArea(id: string): ContextArea | undefined {
  return CONTEXT_AREAS[id];
}

export function getContextAreasForTool(toolName: string): ContextArea[] {
  return Object.values(CONTEXT_AREAS).filter((area) => area.tools.includes(toolName));
}

export function getAllContextAreas(): ContextArea[] {
  return Object.values(CONTEXT_AREAS);
}
