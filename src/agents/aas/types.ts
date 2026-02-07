/**
 * Area Awareness System (AAS) types
 *
 * Inspired by Quake III Arena Bot's AAS, this defines the agent's
 * navigable action space - the "map" of what the agent can do and
 * where it can go in the digital environment.
 */

export type ContextArea = {
  id: string;
  name: string;
  description?: string;
  tools: string[]; // Tools available in this area
  preconditions: string[]; // Required state to enter (e.g., "browser.open")
  entryActions: string[]; // Actions that bring you here
  exitActions?: string[]; // Actions that leave this area
  requiredReachability?: ReachabilityType[]; // Required capability levels
};

export type Reachability = {
  from: string; // Source context area ID
  to: string; // Target context area ID
  via: string; // Tool or action that creates this edge
  cost: number; // Token cost estimate (0-1 normalized)
  bidirectional?: boolean; // Can traverse both ways
  requiredReachability?: ReachabilityType[]; // Required capabilities for this transition
};

export type ToolSurfaceMetadata = {
  toolName: string;
  contextAreas: string[]; // Which areas this tool operates in
  preconditions: string[]; // Required state before use
  sideEffects: string[]; // State changes after use
  reachabilityEdges?: string[]; // Context transitions this enables
  requiredCapabilities?: string[]; // Named capabilities required (e.g., "CanBuild", "CanTest")
};

export type ClusterId =
  | "coding"
  | "messaging"
  | "web"
  | "scheduling"
  | "system"
  | "filesystem"
  | "browser";

export type ToolCluster = {
  id: ClusterId;
  name: string;
  tools: string[];
  defaultContextArea?: string;
};

/**
 * Reachability Classification - Quake-inspired capability levels
 * Maps to Quake III movement types (WALK, JUMP, SWIM, TELEPORT, ROCKETJUMP)
 */
export type ReachabilityType =
  | "READ" // WALK - File existence + standard permissions
  | "WRITE" // JUMP - Write permissions + disk space
  | "NETWORK" // SWIM - Internet connectivity + DNS
  | "AUTH" // TELEPORT - API keys + valid session
  | "ELEVATED"; // ROCKETJUMP - Sudoers entry + passwordless config

export type ReachabilityRequirement = {
  type: ReachabilityType;
  description: string;
  check: (context: ReachabilityCheckContext) => Promise<boolean> | boolean;
};

export type ReachabilityCheckContext = {
  workspaceDir?: string;
  toolName?: string;
  targetPath?: string;
  apiKeys?: Record<string, string | undefined>;
  hasNetwork?: boolean;
  hasElevatedAccess?: boolean;
};
