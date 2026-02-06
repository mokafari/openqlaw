/**
 * Goal Stack Types
 *
 * Defines types for the goal stack system used for multi-step task management.
 */

export type GoalType = "task" | "obstacle" | "subgoal";

export type GoalStatus = "pending" | "active" | "blocked" | "completed" | "failed";

export type Goal = {
  id: string;
  type: GoalType;
  description: string;
  status: GoalStatus;
  parentId?: string;
  blockedBy?: string; // ID of blocking obstacle
  createdAt: number;
  resolvedAt?: number;
  metadata?: Record<string, unknown>; // Additional context
};
