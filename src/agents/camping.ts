/**
 * Camping State Management
 *
 * Implements event-driven camping state for waiting on long-running
 * processes. When an agent triggers a long-running job (e.g., CI pipeline),
 * it enters camping state, suspends execution, and wakes up when the
 * condition is met.
 */

export type CampingTriggerType = "process" | "webhook" | "cron" | "file";

export type CampingState = {
  sessionId: string;
  waitingFor: CampingTriggerType;
  triggerId: string; // Process PID, webhook URL, cron job ID, or file path
  resumeCondition: string; // Condition to check
  enteredAt: number;
  timeoutAt?: number;
  metadata?: Record<string, unknown>;
};

/**
 * Camping State Manager
 */
export class CampingManager {
  private activeCamping = new Map<string, CampingState>();

  /**
   * Enter camping state
   */
  enterCamping(params: {
    sessionId: string;
    waitingFor: CampingTriggerType;
    triggerId: string;
    resumeCondition: string;
    timeoutSeconds?: number;
    metadata?: Record<string, unknown>;
  }): CampingState {
    const camping: CampingState = {
      sessionId: params.sessionId,
      waitingFor: params.waitingFor,
      triggerId: params.triggerId,
      resumeCondition: params.resumeCondition,
      enteredAt: Date.now(),
      timeoutAt: params.timeoutSeconds ? Date.now() + params.timeoutSeconds * 1000 : undefined,
      metadata: params.metadata,
    };

    this.activeCamping.set(params.sessionId, camping);
    return camping;
  }

  /**
   * Exit camping state
   */
  exitCamping(sessionId: string): CampingState | undefined {
    const camping = this.activeCamping.get(sessionId);
    if (camping) {
      this.activeCamping.delete(sessionId);
    }
    return camping;
  }

  /**
   * Get camping state for session
   */
  getCamping(sessionId: string): CampingState | undefined {
    return this.activeCamping.get(sessionId);
  }

  /**
   * Check if session is camping
   */
  isCamping(sessionId: string): boolean {
    return this.activeCamping.has(sessionId);
  }

  /**
   * Check if camping state has timed out
   */
  isTimedOut(sessionId: string): boolean {
    const camping = this.activeCamping.get(sessionId);
    if (!camping || !camping.timeoutAt) {
      return false;
    }
    return Date.now() >= camping.timeoutAt;
  }

  /**
   * Get all active camping states
   */
  getAllCamping(): CampingState[] {
    return Array.from(this.activeCamping.values());
  }

  /**
   * Clear all camping states (for testing/cleanup)
   */
  clear(): void {
    this.activeCamping.clear();
  }

  /**
   * Restore camping state from persisted data
   * (Used when loading from disk)
   */
  restoreCamping(state: CampingState): void {
    this.activeCamping.set(state.sessionId, state);
  }
}

/**
 * Global camping manager instance
 */
export const globalCampingManager = new CampingManager();
