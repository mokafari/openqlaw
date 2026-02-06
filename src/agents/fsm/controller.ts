/**
 * FSM Controller
 *
 * Manages agent state transitions and enforces state discipline.
 */

import type { AgentState } from "./states.js";
import { getStateDescription } from "./states.js";
import { canTransition, getDefaultTransition } from "./transitions.js";

export type FSMContext = {
  success?: boolean;
  error?: boolean;
  event?: string;
  message?: string;
  forced?: boolean;
};

export class FSMController {
  private currentState: AgentState;
  private stateHistory: Array<{ state: AgentState; timestamp: number; context?: FSMContext }>;
  private maxHistorySize: number;

  constructor(initialState: AgentState = "idle", maxHistorySize: number = 100) {
    this.currentState = initialState;
    this.stateHistory = [{ state: initialState, timestamp: Date.now() }];
    this.maxHistorySize = maxHistorySize;
  }

  getState(): AgentState {
    return this.currentState;
  }

  getStateHistory(): ReadonlyArray<{ state: AgentState; timestamp: number; context?: FSMContext }> {
    return this.stateHistory;
  }

  /**
   * Attempt to transition to a new state
   * @returns true if transition was successful, false otherwise
   */
  transition(to: AgentState, context?: FSMContext): boolean {
    if (!canTransition(this.currentState, to)) {
      return false;
    }

    const previousState = this.currentState;
    this.currentState = to;
    this.stateHistory.push({
      state: to,
      timestamp: Date.now(),
      context,
    });

    // Trim history if too long
    if (this.stateHistory.length > this.maxHistorySize) {
      this.stateHistory = this.stateHistory.slice(-this.maxHistorySize);
    }

    return true;
  }

  /**
   * Transition using default logic based on context
   */
  transitionDefault(context?: FSMContext): boolean {
    const nextState = getDefaultTransition(this.currentState, context);
    if (!nextState) {
      return false;
    }
    return this.transition(nextState, context);
  }

  /**
   * Force transition (bypasses validation) - use with caution
   */
  forceTransition(to: AgentState, context?: FSMContext): void {
    const previousState = this.currentState;
    this.currentState = to;
    this.stateHistory.push({
      state: to,
      timestamp: Date.now(),
      context: { ...context, forced: true },
    });
  }

  /**
   * Reset to initial state
   */
  reset(initialState: AgentState = "idle"): void {
    this.currentState = initialState;
    this.stateHistory = [{ state: initialState, timestamp: Date.now() }];
  }

  /**
   * Get a human-readable description of current state
   */
  getStateDescription(): string {
    return getStateDescription(this.currentState);
  }

  /**
   * Check if agent is in a terminal state (can end naturally)
   */
  isTerminalState(): boolean {
    return this.currentState === "idle" || this.currentState === "reporting";
  }

  /**
   * Check if agent is in an error recovery state
   */
  isErrorState(): boolean {
    return this.currentState === "retreating";
  }

  /**
   * Check if agent is waiting for external input
   */
  isWaitingState(): boolean {
    return this.currentState === "camping" || this.currentState === "idle";
  }
}
