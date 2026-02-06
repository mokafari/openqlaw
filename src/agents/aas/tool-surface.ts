/**
 * Tool Surface Schema - Metadata about all available tools
 *
 * Defines preconditions, side effects, and context area associations
 * for each tool to enable AAS-aware tool selection and validation.
 */

import type { ToolSurfaceMetadata } from "./types.js";
import { CONTEXT_AREAS } from "./context-areas.js";

export const TOOL_SURFACE: Record<string, ToolSurfaceMetadata> = {
  // File system tools
  read: {
    toolName: "read",
    contextAreas: ["filesystem"],
    preconditions: [],
    sideEffects: [],
  },
  write: {
    toolName: "write",
    contextAreas: ["filesystem"],
    preconditions: [],
    sideEffects: ["filesystem.modified"],
  },
  edit: {
    toolName: "edit",
    contextAreas: ["filesystem"],
    preconditions: [],
    sideEffects: ["filesystem.modified"],
  },
  apply_patch: {
    toolName: "apply_patch",
    contextAreas: ["filesystem"],
    preconditions: [],
    sideEffects: ["filesystem.modified"],
  },
  grep: {
    toolName: "grep",
    contextAreas: ["filesystem"],
    preconditions: [],
    sideEffects: [],
  },
  find: {
    toolName: "find",
    contextAreas: ["filesystem"],
    preconditions: [],
    sideEffects: [],
  },
  ls: {
    toolName: "ls",
    contextAreas: ["filesystem"],
    preconditions: [],
    sideEffects: [],
  },
  // Browser tools
  browser: {
    toolName: "browser",
    contextAreas: ["browser"],
    preconditions: [],
    sideEffects: ["browser.open", "browser.navigation"],
    reachabilityEdges: ["filesystem->browser"],
  },
  // Terminal tools
  exec: {
    toolName: "exec",
    contextAreas: ["terminal", "filesystem"],
    preconditions: [],
    sideEffects: ["process.started"],
  },
  process: {
    toolName: "process",
    contextAreas: ["terminal"],
    preconditions: [],
    sideEffects: ["process.managed"],
  },
  // Web tools
  web_search: {
    toolName: "web_search",
    contextAreas: ["web"],
    preconditions: [],
    sideEffects: [],
  },
  web_fetch: {
    toolName: "web_fetch",
    contextAreas: ["web"],
    preconditions: [],
    sideEffects: [],
  },
  // Messaging tools
  message: {
    toolName: "message",
    contextAreas: ["messaging"],
    preconditions: [],
    sideEffects: ["message.sent"],
  },
  sessions_send: {
    toolName: "sessions_send",
    contextAreas: ["messaging"],
    preconditions: [],
    sideEffects: ["message.sent"],
  },
  sessions_spawn: {
    toolName: "sessions_spawn",
    contextAreas: ["messaging", "system"],
    preconditions: [],
    sideEffects: ["subagent.spawned"],
    reachabilityEdges: ["messaging->system"],
  },
  // Scheduling tools
  cron: {
    toolName: "cron",
    contextAreas: ["scheduling"],
    preconditions: [],
    sideEffects: ["cron.job_created", "cron.job_updated"],
    reachabilityEdges: ["scheduling->system"],
  },
  nodes: {
    toolName: "nodes",
    contextAreas: ["scheduling"],
    preconditions: [],
    sideEffects: [],
  },
  // System tools
  gateway: {
    toolName: "gateway",
    contextAreas: ["system"],
    preconditions: [],
    sideEffects: [],
  },
  agents_list: {
    toolName: "agents_list",
    contextAreas: ["system"],
    preconditions: [],
    sideEffects: [],
  },
  session_status: {
    toolName: "session_status",
    contextAreas: ["system"],
    preconditions: [],
    sideEffects: [],
  },
  sessions_list: {
    toolName: "sessions_list",
    contextAreas: ["system"],
    preconditions: [],
    sideEffects: [],
  },
  sessions_history: {
    toolName: "sessions_history",
    contextAreas: ["system"],
    preconditions: [],
    sideEffects: [],
  },
  // Canvas tool
  canvas: {
    toolName: "canvas",
    contextAreas: ["canvas"],
    preconditions: [],
    sideEffects: ["canvas.rendered"],
  },
  // Image tool
  image: {
    toolName: "image",
    contextAreas: ["filesystem"],
    preconditions: [],
    sideEffects: [],
  },
  // TTS tool
  tts: {
    toolName: "tts",
    contextAreas: ["messaging"],
    preconditions: [],
    sideEffects: ["audio.generated"],
  },
};

export function getToolMetadata(toolName: string): ToolSurfaceMetadata | undefined {
  return TOOL_SURFACE[toolName];
}

export function getToolPreconditions(toolName: string): string[] {
  const metadata = getToolMetadata(toolName);
  return metadata?.preconditions ?? [];
}

export function getToolSideEffects(toolName: string): string[] {
  const metadata = getToolMetadata(toolName);
  return metadata?.sideEffects ?? [];
}

export function getToolContextAreas(toolName: string): string[] {
  const metadata = getToolMetadata(toolName);
  return metadata?.contextAreas ?? [];
}

export function validateToolPreconditions(
  toolName: string,
  currentState: Set<string>,
): { valid: boolean; missing: string[] } {
  const preconditions = getToolPreconditions(toolName);
  const missing = preconditions.filter((p) => !currentState.has(p));
  return {
    valid: missing.length === 0,
    missing,
  };
}
