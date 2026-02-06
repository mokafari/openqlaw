/**
 * FSM State Transitions
 *
 * Defines valid state transitions and their conditions.
 */

import type { NamedCapability } from "../aas/context-graph.js";
import type { ReachabilityCheckContext } from "../aas/types.js";
import type { AgentState } from "./states.js";

export type TransitionCondition = {
  type: "always" | "on_success" | "on_error" | "on_timeout" | "on_event" | "custom";
  value?: string | boolean | number;
};

export type StateTransition = {
  from: AgentState;
  to: AgentState;
  condition?: TransitionCondition;
  description?: string;
};

// Import authoritative transitions from states.ts
import { VALID_TRANSITIONS } from "./states.js";

// Re-export as STATE_TRANSITIONS for backward compatibility
// This ensures consistency - both files use the same transition rules
export const STATE_TRANSITIONS: Record<AgentState, AgentState[]> = {
  idle: VALID_TRANSITIONS.idle ?? [],
  gathering_info: VALID_TRANSITIONS.gathering_info ?? [],
  planning: VALID_TRANSITIONS.planning ?? [],
  executing: VALID_TRANSITIONS.executing ?? [],
  verifying: VALID_TRANSITIONS.verifying ?? [],
  camping: VALID_TRANSITIONS.camping ?? [],
  retreating: VALID_TRANSITIONS.retreating ?? [],
  reporting: VALID_TRANSITIONS.reporting ?? [],
  diagnostic: VALID_TRANSITIONS.diagnostic ?? [],
  mutating: VALID_TRANSITIONS.mutating ?? [],
  self_correcting: VALID_TRANSITIONS.self_correcting ?? [],
};

export function canTransition(from: AgentState, to: AgentState): boolean {
  const allowed = STATE_TRANSITIONS[from];
  return allowed?.includes(to) ?? false;
}

export function getAllowedTransitions(from: AgentState): AgentState[] {
  return STATE_TRANSITIONS[from] ?? [];
}

export function getDefaultTransition(
  from: AgentState,
  context?: { success?: boolean; error?: boolean; event?: string },
): AgentState | undefined {
  const allowed = getAllowedTransitions(from);

  if (allowed.length === 0) {
    return undefined;
  }

  // Default transitions based on context
  if (context?.error && allowed.includes("retreating")) {
    return "retreating";
  }

  // Transition to diagnostic state on high tool error rate
  if (context?.event === "high_tool_error_rate" && allowed.includes("diagnostic")) {
    return "diagnostic";
  }

  if (context?.success && from === "verifying" && allowed.includes("reporting")) {
    return "reporting";
  }

  if (context?.event && from === "camping" && allowed.includes("gathering_info")) {
    return "gathering_info";
  }

  // Self-modification flow transitions
  if (
    from === "diagnostic" &&
    context?.event === "root_cause_found" &&
    allowed.includes("mutating")
  ) {
    return "mutating";
  }

  if (
    from === "mutating" &&
    context?.event === "patch_generated" &&
    allowed.includes("self_correcting")
  ) {
    return "self_correcting";
  }

  if (from === "self_correcting" && context?.success && allowed.includes("reporting")) {
    return "reporting";
  }

  if (from === "self_correcting" && context?.error && allowed.includes("mutating")) {
    return "mutating"; // Retry mutation if verification fails
  }

  // Return first allowed transition as default
  return allowed[0];
}

/**
 * Capability requirements for target states.
 * Transitions to these states require the listed capabilities to be available.
 */
export const STATE_CAPABILITY_REQUIREMENTS: Partial<Record<AgentState, NamedCapability[]>> = {
  executing: ["CanRead"],
  mutating: ["CanCommit", "CanWrite"],
  self_correcting: ["CanRead", "CanWrite"],
};

/**
 * Async transition check that validates both FSM rules and capability requirements.
 * Falls back to basic canTransition when no reachability context is provided.
 */
export async function canTransitionAsync(
  from: AgentState,
  to: AgentState,
  reachCtx?: ReachabilityCheckContext,
): Promise<{ allowed: boolean; reason?: string }> {
  if (!canTransition(from, to)) {
    return {
      allowed: false,
      reason: `Transition from ${from} to ${to} is not allowed by FSM rules`,
    };
  }

  if (!reachCtx) {
    return { allowed: true };
  }

  const required = STATE_CAPABILITY_REQUIREMENTS[to];
  if (!required || required.length === 0) {
    return { allowed: true };
  }

  // Lazy import to avoid circular dependency at module load time
  const { ContextGraph } = await import("../aas/context-graph.js");

  const missing: string[] = [];
  for (const cap of required) {
    const available = await ContextGraph.check(reachCtx, cap);
    if (!available) {
      missing.push(cap);
    }
  }

  if (missing.length > 0) {
    return {
      allowed: false,
      reason: `Missing capabilities for state ${to}: ${missing.join(", ")}`,
    };
  }

  return { allowed: true };
}
