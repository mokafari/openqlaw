/**
 * Tool Surface Schema - Metadata about all available tools
 *
 * Defines preconditions, side effects, and context area associations
 * for each tool to enable AAS-aware tool selection and validation.
 *
 * Supports dynamic tool registration for skill-loaded tools.
 */

import type { ToolSurfaceMetadata } from "./types.js";

// ────────────────────────────────────────────────────────────────
// Dynamic Tool Registry
// ────────────────────────────────────────────────────────────────

export interface ToolRegistry {
  /** Register a tool surface (overwrites if already exists) */
  registerToolSurface(tool: ToolSurfaceMetadata): void;
  /** Unregister a tool by name */
  unregisterTool(toolName: string): void;
  /** Get a tool surface by name (checks dynamic registry first, then static) */
  getToolSurface(toolName: string): ToolSurfaceMetadata | null;
  /** List all registered tools (dynamic + static) */
  listRegisteredTools(): ToolSurfaceMetadata[];
  /** Get tools by context area */
  getToolsByContextArea(area: string): ToolSurfaceMetadata[];
}

/** Listeners for tool registration events */
export type ToolRegistrationListener = (event: {
  action: "register" | "unregister";
  toolName: string;
  tool?: ToolSurfaceMetadata;
}) => void;

/** Dynamic tool registry (skill-loaded tools) */
const dynamicRegistry = new Map<string, ToolSurfaceMetadata>();

/** Registration event listeners */
const registrationListeners: ToolRegistrationListener[] = [];

/**
 * Subscribe to tool registration/unregistration events
 * @returns Unsubscribe function
 */
export function onToolRegistration(listener: ToolRegistrationListener): () => void {
  registrationListeners.push(listener);
  return () => {
    const idx = registrationListeners.indexOf(listener);
    if (idx !== -1) {
      registrationListeners.splice(idx, 1);
    }
  };
}

function notifyListeners(
  action: "register" | "unregister",
  toolName: string,
  tool?: ToolSurfaceMetadata,
) {
  for (const listener of registrationListeners) {
    try {
      listener({ action, toolName, tool });
    } catch {
      // Non-fatal: listener errors shouldn't break registration
    }
  }
}

// ────────────────────────────────────────────────────────────────
// ToolRegistry Implementation
// ────────────────────────────────────────────────────────────────

export const toolRegistry: ToolRegistry = {
  registerToolSurface(tool: ToolSurfaceMetadata): void {
    dynamicRegistry.set(tool.toolName, tool);
    notifyListeners("register", tool.toolName, tool);
  },

  unregisterTool(toolName: string): void {
    const existed = dynamicRegistry.delete(toolName);
    if (existed) {
      notifyListeners("unregister", toolName);
    }
  },

  getToolSurface(toolName: string): ToolSurfaceMetadata | null {
    // Check dynamic registry first (allows overrides)
    const dynamic = dynamicRegistry.get(toolName);
    if (dynamic) {
      return dynamic;
    }
    // Fall back to static registry
    const stat = TOOL_SURFACE[toolName];
    return stat ?? null;
  },

  listRegisteredTools(): ToolSurfaceMetadata[] {
    // Merge static + dynamic, dynamic takes precedence
    const merged = new Map<string, ToolSurfaceMetadata>();
    for (const [name, meta] of Object.entries(TOOL_SURFACE)) {
      merged.set(name, meta);
    }
    for (const [name, meta] of dynamicRegistry) {
      merged.set(name, meta);
    }
    return [...merged.values()];
  },

  getToolsByContextArea(area: string): ToolSurfaceMetadata[] {
    return this.listRegisteredTools().filter((tool) => tool.contextAreas.includes(area));
  },
};

// ────────────────────────────────────────────────────────────────
// Static Tool Surface (built-in tools)
// ────────────────────────────────────────────────────────────────

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

  // Development & Build Tools
  rebuild_gateway: {
    toolName: "rebuild_gateway",
    contextAreas: ["system", "development"],
    preconditions: [],
    sideEffects: ["gateway.rebuilt", "gateway.restarted"],
    requiredCapabilities: ["CanBuild", "CanRestart"],
  },

  // Evolution & Self-Modification Tools
  evolution_propose_patch: {
    toolName: "evolution_propose_patch",
    contextAreas: ["development"],
    preconditions: [],
    sideEffects: ["patch.proposed"],
    requiredCapabilities: ["CanWrite"],
  },
  evolution_run_dojo_test: {
    toolName: "evolution_run_dojo_test",
    contextAreas: ["development"],
    preconditions: [],
    sideEffects: ["test.executed"],
    requiredCapabilities: ["CanTest"],
  },
  evolution_list_patches: {
    toolName: "evolution_list_patches",
    contextAreas: ["development"],
    preconditions: [],
    sideEffects: [],
    requiredCapabilities: ["CanRead"],
  },
  evolution_apply_approved_patch: {
    toolName: "evolution_apply_approved_patch",
    contextAreas: ["development"],
    preconditions: [],
    sideEffects: ["patch.applied", "filesystem.modified"],
    requiredCapabilities: ["CanWrite", "CanBuild", "CanCommit", "CanRestart"],
  },

  // Goal Management Tools (no special capabilities)
  goal_push: {
    toolName: "goal_push",
    contextAreas: ["system"],
    preconditions: [],
    sideEffects: ["goal.pushed"],
  },
  goal_pop: {
    toolName: "goal_pop",
    contextAreas: ["system"],
    preconditions: [],
    sideEffects: ["goal.popped"],
  },
  goal_status: {
    toolName: "goal_status",
    contextAreas: ["system"],
    preconditions: [],
    sideEffects: [],
  },

  // Meta-Learning Tools
  meta_learning: {
    toolName: "meta_learning",
    contextAreas: ["system"],
    preconditions: [],
    sideEffects: ["learning.logged"],
  },

  // Episodic Memory
  episodic_recall: {
    toolName: "episodic_recall",
    contextAreas: ["system"],
    preconditions: [],
    sideEffects: [],
  },
};

// ────────────────────────────────────────────────────────────────
// Helper Functions (use registry for dynamic lookup)
// ────────────────────────────────────────────────────────────────

export function getToolMetadata(toolName: string): ToolSurfaceMetadata | undefined {
  return toolRegistry.getToolSurface(toolName) ?? undefined;
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

// ────────────────────────────────────────────────────────────────
// Batch Registration Helper
// ────────────────────────────────────────────────────────────────

/**
 * Register multiple tools at once (e.g., when a skill loads)
 */
export function registerToolSurfaces(tools: ToolSurfaceMetadata[]): void {
  for (const tool of tools) {
    toolRegistry.registerToolSurface(tool);
  }
}

/**
 * Unregister multiple tools at once (e.g., when a skill unloads)
 */
export function unregisterToolSurfaces(toolNames: string[]): void {
  for (const name of toolNames) {
    toolRegistry.unregisterTool(name);
  }
}

// ────────────────────────────────────────────────────────────────
// Testing Utilities
// ────────────────────────────────────────────────────────────────

/** Clear dynamic registry (for testing) */
export function clearDynamicRegistry(): void {
  dynamicRegistry.clear();
}

/** Get count of dynamically registered tools */
export function getDynamicRegistrySize(): number {
  return dynamicRegistry.size;
}
