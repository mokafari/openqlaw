/**
 * Agent FSM States
 *
 * Defines the finite state machine states for agent operation,
 * inspired by Quake III Arena Bot's AI Network layer.
 */

export type AgentState =
  | "idle"
  | "gathering_info"
  | "planning"
  | "executing"
  | "verifying"
  | "camping"
  | "retreating"
  | "reporting"
  | "diagnostic"
  | "mutating"
  | "self_correcting";

/**
 * Quake-inspired AI Network Nodes
 *
 * These map to the explicit nodes from Quake III Bot's AI Network.
 * Each node represents a distinct behavioral mode.
 */
export type QuakeNode =
  | "NODE_STAND" // Waiting for user input
  | "NODE_PLAN" // Building the GoalStack
  | "NODE_SEEK_GOAL" // Executing the top of the stack
  | "NODE_BATTLE_ERROR" // Handling errors (reflexive fixing)
  | "NODE_CAMP" // Sleeping until long-running process finishes
  | "NODE_DIAGNOSTIC" // Analyzing failures and root causes
  | "NODE_MUTATION" // Proposing and applying code changes
  | "NODE_VERIFICATION"; // Validating changes in the Dojo

export const QUAKE_NODES = {
  STAND: "NODE_STAND" as const,
  PLAN: "NODE_PLAN" as const,
  SEEK_GOAL: "NODE_SEEK_GOAL" as const,
  BATTLE_ERROR: "NODE_BATTLE_ERROR" as const,
  CAMP: "NODE_CAMP" as const,
  DIAGNOSTIC: "NODE_DIAGNOSTIC" as const,
  MUTATION: "NODE_MUTATION" as const,
  VERIFICATION: "NODE_VERIFICATION" as const,
} as const;

export const AGENT_STATES = {
  IDLE: "idle" as const,
  GATHERING_INFO: "gathering_info" as const,
  PLANNING: "planning" as const,
  EXECUTING: "executing" as const,
  VERIFYING: "verifying" as const,
  CAMPING: "camping" as const,
  RETREATING: "retreating" as const,
  REPORTING: "reporting" as const,
  DIAGNOSTIC: "diagnostic" as const,
  MUTATING: "mutating" as const,
  SELF_CORRECTING: "self_correcting" as const,
} as const;

/**
 * Map Quake nodes to agent states
 */
export function quakeNodeToState(node: QuakeNode): AgentState {
  const mapping: Record<QuakeNode, AgentState> = {
    NODE_STAND: "idle",
    NODE_PLAN: "planning",
    NODE_SEEK_GOAL: "executing",
    NODE_BATTLE_ERROR: "retreating",
    NODE_CAMP: "camping",
    NODE_DIAGNOSTIC: "diagnostic",
    NODE_MUTATION: "mutating",
    NODE_VERIFICATION: "self_correcting",
  };
  return mapping[node];
}

/**
 * Map agent state to Quake node
 */
export function stateToQuakeNode(state: AgentState): QuakeNode {
  const mapping: Partial<Record<AgentState, QuakeNode>> = {
    idle: "NODE_STAND",
    planning: "NODE_PLAN",
    executing: "NODE_SEEK_GOAL",
    retreating: "NODE_BATTLE_ERROR",
    camping: "NODE_CAMP",
    diagnostic: "NODE_DIAGNOSTIC",
    mutating: "NODE_MUTATION",
    self_correcting: "NODE_VERIFICATION",
  };
  return mapping[state] ?? "NODE_STAND";
}

/**
 * Quake node mapping (exported for documentation/iteration)
 */
export const QUAKE_NODE_MAPPING: Partial<Record<AgentState, QuakeNode>> = {
  idle: "NODE_STAND",
  planning: "NODE_PLAN",
  executing: "NODE_SEEK_GOAL",
  retreating: "NODE_BATTLE_ERROR",
  camping: "NODE_CAMP",
  diagnostic: "NODE_DIAGNOSTIC",
  mutating: "NODE_MUTATION",
  self_correcting: "NODE_VERIFICATION",
};

export const STATE_DESCRIPTIONS: Record<AgentState, string> = {
  idle: "Agent is idle, waiting for input",
  gathering_info: "Collecting information needed for the task",
  planning: "Formulating a plan of action",
  executing: "Performing actions to achieve goals",
  verifying: "Checking results and validating outcomes",
  camping: "Waiting for an external event or condition",
  retreating: "Recovering from an error or obstacle",
  reporting: "Summarizing results and reporting back",
  diagnostic: "Analyzing failures and root causes for self-improvement",
  mutating: "Proposing and applying source code changes",
  self_correcting: "Validating self-modifications in the Dojo harness",
};

export const QUAKE_NODE_DESCRIPTIONS: Record<QuakeNode, string> = {
  NODE_STAND: "Waiting for user input (idle state)",
  NODE_PLAN: "Building the GoalStack (planning phase)",
  NODE_SEEK_GOAL: "Executing the top goal from stack (active execution)",
  NODE_BATTLE_ERROR: "Handling errors and obstacles (reflexive fixing)",
  NODE_CAMP: "Sleeping until long-running process finishes (waiting)",
  NODE_DIAGNOSTIC: "Analyzing failures and root causes (evolutionary diagnostic)",
  NODE_MUTATION: "Proposing and applying code changes (evolutionary mutation)",
  NODE_VERIFICATION: "Validating changes in the Dojo (evolutionary verification)",
};

/**
 * Valid state transitions
 *
 * Defines which states can transition to which other states.
 * Note: This is the authoritative source. transitions.ts provides
 * additional helper functions but uses the same transition rules.
 */
export const VALID_TRANSITIONS: Partial<Record<AgentState, AgentState[]>> = {
  idle: ["gathering_info", "planning", "executing", "diagnostic"],
  gathering_info: ["planning", "idle"],
  planning: ["executing", "gathering_info", "idle"],
  executing: ["verifying", "retreating", "camping", "reporting"],
  verifying: ["executing", "reporting", "planning"],
  camping: ["executing", "planning", "idle"],
  retreating: ["planning", "executing", "idle"],
  reporting: ["idle", "planning"],
  diagnostic: ["mutating", "idle", "reporting"],
  mutating: ["self_correcting", "diagnostic", "idle"],
  self_correcting: ["reporting", "mutating", "idle"],
};

/**
 * Check if a state transition is valid
 */
export function isValidTransition(from: AgentState, to: AgentState): boolean {
  if (from === to) {
    return true; // Self-transitions are always valid
  }
  const allowed = VALID_TRANSITIONS[from];
  return allowed?.includes(to) ?? false;
}

export function isValidState(state: string): state is AgentState {
  return Object.values(AGENT_STATES).includes(state as AgentState);
}

export function isValidQuakeNode(node: string): node is QuakeNode {
  return Object.values(QUAKE_NODES).includes(node as QuakeNode);
}

export function getStateDescription(state: AgentState): string {
  return STATE_DESCRIPTIONS[state] ?? "Unknown state";
}

export function getQuakeNodeDescription(node: QuakeNode): string {
  return QUAKE_NODE_DESCRIPTIONS[node] ?? "Unknown node";
}
