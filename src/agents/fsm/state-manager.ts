/**
 * FSM State Manager
 *
 * Manages agent FSM state transitions and persistence.
 */

import fs from "node:fs/promises";
import path from "node:path";
import type { NamedCapability } from "../aas/context-graph.js";
import type { ReachabilityCheckContext } from "../aas/types.js";
import type { AgentState, QuakeNode } from "./states.js";
import { ContextGraph } from "../aas/context-graph.js";
import { isValidState, isValidTransition, quakeNodeToState, stateToQuakeNode } from "./states.js";

export type FSMStateRecord = {
  state: AgentState;
  quakeNode: QuakeNode;
  enteredAt: number;
  previousState?: AgentState;
  metadata?: Record<string, unknown>;
};

/**
 * Map target states to the ContextGraph capabilities they require.
 * If a state isn't listed, no capability check is needed for it.
 */
const STATE_REQUIRED_CAPABILITIES: Partial<Record<AgentState, NamedCapability[]>> = {
  executing: ["CanWrite"],
  camping: ["CanNetwork"],
  mutating: ["CanWrite"],
  self_correcting: ["CanWrite", "CanCommit"],
};

export type FSMStateManagerOptions = {
  sessionId: string;
  sessionDir?: string;
  initialState?: AgentState;
  /** Optional reachability context for ContextGraph checks on transitions. */
  reachabilityContext?: ReachabilityCheckContext;
};

/**
 * FSM State Manager
 *
 * Handles state transitions, validation, and persistence.
 */
export class FSMStateManager {
  private currentState: AgentState;
  private currentQuakeNode: QuakeNode;
  private enteredAt: number;
  private previousState?: AgentState;
  private metadata: Record<string, unknown>;
  private sessionId: string;
  private stateFile?: string;
  private reachabilityContext?: ReachabilityCheckContext;

  constructor(options: FSMStateManagerOptions) {
    this.sessionId = options.sessionId;
    this.currentState = options.initialState ?? "idle";
    this.currentQuakeNode = stateToQuakeNode(this.currentState);
    this.enteredAt = Date.now();
    this.metadata = {};
    this.reachabilityContext = options.reachabilityContext;

    if (options.sessionDir) {
      this.stateFile = path.join(options.sessionDir, "fsm_state.json");
    }
  }

  /**
   * Get the state file path (for debugging/logging)
   */
  getStateFilePath(): string | undefined {
    return this.stateFile;
  }

  /** Update the reachability context (e.g. when workspace changes). */
  setReachabilityContext(ctx: ReachabilityCheckContext): void {
    this.reachabilityContext = ctx;
  }

  /**
   * Get current state
   */
  getState(): AgentState {
    return this.currentState;
  }

  /**
   * Get current Quake node
   */
  getQuakeNode(): QuakeNode {
    return this.currentQuakeNode;
  }

  /**
   * Get state record
   */
  getStateRecord(): FSMStateRecord {
    return {
      state: this.currentState,
      quakeNode: this.currentQuakeNode,
      enteredAt: this.enteredAt,
      previousState: this.previousState,
      metadata: this.metadata,
    };
  }

  /**
   * Transition to a new state
   */
  async transitionTo(newState: AgentState, metadata?: Record<string, unknown>): Promise<boolean> {
    if (!isValidState(newState)) {
      return false;
    }

    if (!isValidTransition(this.currentState, newState)) {
      // Invalid transition - log but don't throw
      console.warn(`Invalid FSM transition: ${this.currentState} -> ${newState}`);
      return false;
    }

    // ContextGraph capability check: verify target state prerequisites are met.
    const requiredCaps = STATE_REQUIRED_CAPABILITIES[newState];
    if (requiredCaps && requiredCaps.length > 0 && this.reachabilityContext) {
      for (const cap of requiredCaps) {
        try {
          const ok = await ContextGraph.check(this.reachabilityContext, cap);
          if (!ok) {
            console.warn(
              `FSM transition ${this.currentState} -> ${newState} blocked: missing capability "${cap}"`,
            );
            return false;
          }
        } catch {
          // ContextGraph check failure is non-fatal — allow transition
        }
      }
    }

    this.previousState = this.currentState;
    this.currentState = newState;
    this.currentQuakeNode = stateToQuakeNode(newState);
    this.enteredAt = Date.now();

    if (metadata) {
      this.metadata = { ...this.metadata, ...metadata };
    }

    await this.persist();
    return true;
  }

  /**
   * Transition to a Quake node (maps to state)
   */
  async transitionToNode(node: QuakeNode, metadata?: Record<string, unknown>): Promise<boolean> {
    const state = quakeNodeToState(node);
    return this.transitionTo(state, metadata);
  }

  /**
   * Update metadata without changing state
   */
  async updateMetadata(metadata: Record<string, unknown>): Promise<void> {
    this.metadata = { ...this.metadata, ...metadata };
    await this.persist();
  }

  /**
   * Persist state to disk
   */
  async persist(): Promise<void> {
    if (!this.stateFile) {
      return;
    }

    try {
      const record = this.getStateRecord();
      await fs.writeFile(this.stateFile, JSON.stringify(record, null, 2), "utf-8");
    } catch (error) {
      // Log but don't throw - persistence failures shouldn't break execution
      console.warn(`Failed to persist FSM state: ${String(error)}`);
    }
  }

  /**
   * Load state from disk
   */
  async load(): Promise<boolean> {
    if (!this.stateFile) {
      return false;
    }

    try {
      const content = await fs.readFile(this.stateFile, "utf-8");
      const record = JSON.parse(content) as FSMStateRecord;

      if (isValidState(record.state)) {
        this.currentState = record.state;
        this.currentQuakeNode = record.quakeNode;
        this.enteredAt = record.enteredAt ?? Date.now();
        this.previousState = record.previousState;
        this.metadata = record.metadata ?? {};
        console.log(
          `[FSM] Loaded state from ${this.stateFile}: ${this.currentState} (entered at ${new Date(this.enteredAt).toISOString()})`,
        );
        return true;
      } else {
        console.warn(`[FSM] Invalid state in ${this.stateFile}: ${JSON.stringify(record)}`);
      }
    } catch (error) {
      // File doesn't exist or invalid - start fresh
      if ((error as { code?: string }).code !== "ENOENT") {
        console.warn(`[FSM] Failed to load state from ${this.stateFile}: ${String(error)}`);
      } else {
        console.log(`[FSM] No state file found at ${this.stateFile}, starting fresh`);
      }
    }

    return false;
  }

  /**
   * Get time spent in current state (milliseconds)
   */
  getTimeInState(): number {
    return Date.now() - this.enteredAt;
  }
}

/**
 * Create a new FSM state manager
 */
export function createFSMStateManager(options: FSMStateManagerOptions): FSMStateManager {
  return new FSMStateManager(options);
}
