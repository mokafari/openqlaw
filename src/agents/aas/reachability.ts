/**
 * Reachability Graph - Valid transitions between context areas
 *
 * Defines which context areas can be reached from others and what
 * actions enable those transitions.
 */

import fs from "node:fs/promises";
import type {
  Reachability,
  ReachabilityCheckContext,
  ReachabilityRequirement,
  ReachabilityType,
} from "./types.js";
import { CONTEXT_AREAS } from "./context-areas.js";

export const REACHABILITY_GRAPH: Reachability[] = [
  // Browser transitions
  {
    from: "filesystem",
    to: "browser",
    via: "browser.open",
    cost: 0.1,
    bidirectional: false,
  },
  {
    from: "browser",
    to: "filesystem",
    via: "browser.close",
    cost: 0.05,
    bidirectional: false,
  },
  // Terminal can access filesystem
  {
    from: "terminal",
    to: "filesystem",
    via: "exec",
    cost: 0.2,
    bidirectional: true,
  },
  // Web services are accessible from browser
  {
    from: "browser",
    to: "web",
    via: "web_search",
    cost: 0.15,
    bidirectional: true,
  },
  // Messaging can spawn sub-agents
  {
    from: "messaging",
    to: "system",
    via: "sessions_spawn",
    cost: 0.3,
    bidirectional: false,
  },
  // Scheduling can trigger system events
  {
    from: "scheduling",
    to: "system",
    via: "cron",
    cost: 0.2,
    bidirectional: false,
  },
];

export function getReachability(from: string, to: string): Reachability | undefined {
  return REACHABILITY_GRAPH.find((r) => r.from === from && r.to === to);
}

export function getReachableAreas(from: string): Reachability[] {
  return REACHABILITY_GRAPH.filter((r) => r.from === from);
}

export function canReach(from: string, to: string): boolean {
  if (from === to) {
    return true;
  }
  const direct = getReachability(from, to);
  if (direct) {
    return true;
  }
  // Check transitive reachability (simple depth-first search)
  const visited = new Set<string>();
  const stack: string[] = [from];

  while (stack.length > 0) {
    const current = stack.pop()!;
    if (current === to) {
      return true;
    }
    if (visited.has(current)) {
      continue;
    }
    visited.add(current);
    const reachable = getReachableAreas(current);
    for (const r of reachable) {
      if (!visited.has(r.to)) {
        stack.push(r.to);
      }
    }
  }
  return false;
}

export function getTransitionCost(from: string, to: string): number {
  const reachability = getReachability(from, to);
  if (reachability) {
    return reachability.cost;
  }
  // Default high cost for unreachable transitions
  return 1.0;
}

/**
 * Default reachability requirements for each type
 */
const REACHABILITY_REQUIREMENTS: Record<ReachabilityType, ReachabilityRequirement> = {
  READ: {
    type: "READ",
    description: "File existence + standard permissions",
    check: async (ctx) => {
      if (ctx.targetPath) {
        try {
          await fs.access(ctx.targetPath, fs.constants.R_OK);
          return true;
        } catch {
          return false;
        }
      }
      // If no specific path, assume readable workspace
      return ctx.workspaceDir != null;
    },
  },
  WRITE: {
    type: "WRITE",
    description: "Write permissions + disk space",
    check: async (ctx) => {
      if (ctx.targetPath) {
        try {
          await fs.access(ctx.targetPath, fs.constants.W_OK);
          return true;
        } catch {
          return false;
        }
      }
      // Check workspace writability
      if (ctx.workspaceDir) {
        try {
          await fs.access(ctx.workspaceDir, fs.constants.W_OK);
          return true;
        } catch {
          return false;
        }
      }
      return false;
    },
  },
  NETWORK: {
    type: "NETWORK",
    description: "Internet connectivity + DNS",
    check: (ctx) => {
      // Check if network is available (can be enhanced with actual connectivity test)
      return ctx.hasNetwork ?? true; // Default to true if not specified
    },
  },
  AUTH: {
    type: "AUTH",
    description: "API keys + valid session",
    check: (ctx) => {
      // Check if relevant API keys are present
      if (ctx.apiKeys) {
        const hasAnyKey = Object.values(ctx.apiKeys).some(
          (key) => key != null && key.trim().length > 0,
        );
        return hasAnyKey;
      }
      return false;
    },
  },
  ELEVATED: {
    type: "ELEVATED",
    description: "Sudoers entry + passwordless config",
    check: (ctx) => {
      // Check if elevated access is available
      return ctx.hasElevatedAccess ?? false;
    },
  },
};

/**
 * Check if a reachability type is available in the given context
 */
export async function checkReachabilityType(
  type: ReachabilityType,
  context: ReachabilityCheckContext,
): Promise<boolean> {
  const requirement = REACHABILITY_REQUIREMENTS[type];
  if (!requirement) {
    return false;
  }
  return requirement.check(context);
}

/**
 * Check if all required reachability types are available
 */
export async function checkReachability(
  requiredTypes: ReachabilityType[],
  context: ReachabilityCheckContext,
): Promise<{ available: boolean; missing: ReachabilityType[] }> {
  if (requiredTypes.length === 0) {
    return { available: true, missing: [] };
  }

  const missing: ReachabilityType[] = [];
  for (const type of requiredTypes) {
    const available = await checkReachabilityType(type, context);
    if (!available) {
      missing.push(type);
    }
  }

  return {
    available: missing.length === 0,
    missing,
  };
}

/**
 * Validate reachability before attempting a transition
 */
export async function validateReachability(
  from: string,
  to: string,
  context: ReachabilityCheckContext,
): Promise<{ valid: boolean; missing: ReachabilityType[]; reason?: string }> {
  const reachability = getReachability(from, to);
  if (!reachability) {
    // Check transitive reachability
    if (!canReach(from, to)) {
      return {
        valid: false,
        missing: [],
        reason: `No path found from ${from} to ${to}`,
      };
    }
    // Transitive path exists but no direct edge - assume basic requirements
    return { valid: true, missing: [] };
  }

  if (reachability.requiredReachability && reachability.requiredReachability.length > 0) {
    const check = await checkReachability(reachability.requiredReachability, context);
    if (!check.available) {
      return {
        valid: false,
        missing: check.missing,
        reason: `Missing required capabilities: ${check.missing.join(", ")}`,
      };
    }
  }

  // Check target area requirements
  const targetArea = CONTEXT_AREAS[to];
  if (targetArea?.requiredReachability && targetArea.requiredReachability.length > 0) {
    const check = await checkReachability(targetArea.requiredReachability, context);
    if (!check.available) {
      return {
        valid: false,
        missing: check.missing,
        reason: `Target area ${to} requires capabilities: ${check.missing.join(", ")}`,
      };
    }
  }

  return { valid: true, missing: [] };
}
