/**
 * Goal Stack Manager
 *
 * Implements LIFO goal stack for complex multi-step tasks with obstacle handling.
 * Inspired by Quake III Arena Bot's puzzle-solving mechanism.
 */

import crypto from "node:crypto";
import type { Goal, GoalStatus, GoalType } from "./types.js";

export class GoalStack {
  private sessionKey: string;
  private goals: Goal[];

  constructor(sessionKey: string, goals: Goal[] = []) {
    this.sessionKey = sessionKey;
    this.goals = [...goals];
  }

  /**
   * Push a new goal onto the stack
   * @returns The ID of the newly created goal
   */
  push(goal: Omit<Goal, "id" | "status" | "createdAt">): string {
    const id = crypto.randomUUID();
    const newGoal: Goal = {
      ...goal,
      id,
      status: "pending",
      createdAt: Date.now(),
    };
    this.goals.push(newGoal);
    return id;
  }

  /**
   * Pop the topmost active goal from the stack
   */
  pop(): Goal | undefined {
    // Find the topmost active goal
    for (let i = this.goals.length - 1; i >= 0; i--) {
      const goal = this.goals[i];
      if (goal.status === "active" || goal.status === "pending") {
        goal.status = "completed";
        goal.resolvedAt = Date.now();
        return goal;
      }
    }
    return undefined;
  }

  /**
   * Peek at the topmost active goal without removing it
   */
  peek(): Goal | undefined {
    for (let i = this.goals.length - 1; i >= 0; i--) {
      const goal = this.goals[i];
      if (goal.status === "active" || goal.status === "pending") {
        return goal;
      }
    }
    return undefined;
  }

  /**
   * Get all goals
   */
  getAll(): ReadonlyArray<Goal> {
    return [...this.goals];
  }

  /**
   * Get goal by ID
   */
  getById(id: string): Goal | undefined {
    return this.goals.find((g) => g.id === id);
  }

  /**
   * Activate a goal (mark as active)
   */
  activate(id: string): boolean {
    const goal = this.getById(id);
    if (goal && (goal.status === "pending" || goal.status === "blocked")) {
      goal.status = "active";
      return true;
    }
    return false;
  }

  /**
   * Block the current active goal with an obstacle
   * @returns The ID of the created obstacle goal
   */
  blockCurrent(obstacle: string): string {
    const current = this.peek();
    if (!current) {
      throw new Error("No active goal to block");
    }

    const obstacleId = this.push({
      type: "obstacle",
      description: obstacle,
      parentId: current.id,
    });

    current.status = "blocked";
    current.blockedBy = obstacleId;

    // Activate the obstacle
    this.activate(obstacleId);

    return obstacleId;
  }

  /**
   * Unblock a goal by resolving its obstacle
   */
  unblock(obstacleId: string): boolean {
    const obstacle = this.getById(obstacleId);
    if (!obstacle || obstacle.type !== "obstacle") {
      return false;
    }

    // Mark obstacle as completed
    obstacle.status = "completed";
    obstacle.resolvedAt = Date.now();

    // Unblock the parent goal
    if (obstacle.parentId) {
      const parent = this.getById(obstacle.parentId);
      if (parent && parent.status === "blocked" && parent.blockedBy === obstacleId) {
        parent.status = "active";
        parent.blockedBy = undefined;
        return true;
      }
    }

    return false;
  }

  /**
   * Mark a goal as failed
   */
  fail(id: string): boolean {
    const goal = this.getById(id);
    if (goal && goal.status !== "completed") {
      goal.status = "failed";
      goal.resolvedAt = Date.now();
      return true;
    }
    return false;
  }

  /**
   * Mark a goal as completed
   */
  complete(id: string): boolean {
    const goal = this.getById(id);
    if (goal && goal.status !== "failed") {
      goal.status = "completed";
      goal.resolvedAt = Date.now();
      return true;
    }
    return false;
  }

  /**
   * Get active goals (in order from top to bottom)
   */
  getActive(): Goal[] {
    return this.goals.filter((g) => g.status === "active" || g.status === "pending");
  }

  /**
   * Get blocked goals
   */
  getBlocked(): Goal[] {
    return this.goals.filter((g) => g.status === "blocked");
  }

  /**
   * Clear all goals
   */
  clear(): void {
    this.goals = [];
  }

  /**
   * Get stack depth (number of active/pending goals)
   */
  getDepth(): number {
    return this.goals.filter((g) => g.status === "active" || g.status === "pending").length;
  }

  /**
   * Check if stack has no active or pending goals
   */
  isEmpty(): boolean {
    return this.getDepth() === 0;
  }

  /**
   * Serialize for storage
   */
  serialize(): { sessionKey: string; goals: Goal[] } {
    return {
      sessionKey: this.sessionKey,
      goals: [...this.goals],
    };
  }

  /**
   * Create from serialized data
   */
  static deserialize(data: { sessionKey: string; goals: Goal[] }): GoalStack {
    return new GoalStack(data.sessionKey, data.goals);
  }
}
