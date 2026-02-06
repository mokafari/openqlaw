/**
 * Goal Stack Visualizer
 *
 * Renders goal stack in human-readable format for Canvas/memory.md
 */

import type { GoalStack } from "./stack.js";
import type { Goal } from "./types.js";

export function visualizeGoalStack(stack: GoalStack): string {
  const goals = stack.getAll();
  if (goals.length === 0) {
    return "Goal stack is empty.";
  }

  const lines: string[] = [];
  lines.push("## Goal Stack");
  lines.push("");

  // Group by status
  const active = goals.filter((g) => g.status === "active" || g.status === "pending");
  const blocked = goals.filter((g) => g.status === "blocked");
  const completed = goals.filter((g) => g.status === "completed");
  const failed = goals.filter((g) => g.status === "failed");

  if (active.length > 0) {
    lines.push("### Active Goals");
    for (const goal of active.reverse()) {
      lines.push(formatGoal(goal, true));
    }
    lines.push("");
  }

  if (blocked.length > 0) {
    lines.push("### Blocked Goals");
    for (const goal of blocked) {
      lines.push(formatGoal(goal, true));
      if (goal.blockedBy) {
        const obstacle = stack.getById(goal.blockedBy);
        if (obstacle) {
          lines.push(`  └─ Blocked by: ${formatGoal(obstacle, false)}`);
        }
      }
    }
    lines.push("");
  }

  if (completed.length > 0) {
    lines.push("### Completed Goals");
    for (const goal of completed.slice(-5).reverse()) {
      lines.push(formatGoal(goal, false));
    }
    if (completed.length > 5) {
      lines.push(`  ... and ${completed.length - 5} more`);
    }
    lines.push("");
  }

  if (failed.length > 0) {
    lines.push("### Failed Goals");
    for (const goal of failed) {
      lines.push(formatGoal(goal, false));
    }
    lines.push("");
  }

  return lines.join("\n");
}

function formatGoal(goal: Goal, showDetails: boolean): string {
  const statusIcon = getStatusIcon(goal.status);
  const typeIcon = getTypeIcon(goal.type);
  let line = `${statusIcon} ${typeIcon} ${goal.description}`;

  if (showDetails) {
    const age = Math.floor((Date.now() - goal.createdAt) / 1000);
    const ageStr = age < 60 ? `${age}s` : `${Math.floor(age / 60)}m`;
    line += ` (${ageStr} ago)`;
  }

  if (goal.parentId) {
    line += ` [parent: ${goal.parentId.slice(0, 8)}...]`;
  }

  return line;
}

function getStatusIcon(status: Goal["status"]): string {
  switch (status) {
    case "active":
      return "▶";
    case "pending":
      return "⏸";
    case "blocked":
      return "⛔";
    case "completed":
      return "✅";
    case "failed":
      return "❌";
    default:
      return "•";
  }
}

function getTypeIcon(type: Goal["type"]): string {
  switch (type) {
    case "task":
      return "📋";
    case "obstacle":
      return "🚧";
    case "subgoal":
      return "🎯";
    default:
      return "•";
  }
}

/**
 * Generate a compact summary for system prompt injection
 */
export function summarizeGoalStack(stack: GoalStack): string {
  const active = stack.getActive();
  const blocked = stack.getBlocked();
  const current = stack.peek();

  if (stack.isEmpty()) {
    return "No active goals.";
  }

  const parts: string[] = [];

  if (current) {
    parts.push(`Current goal: ${current.description}`);
  }

  if (active.length > 1) {
    parts.push(`${active.length - 1} pending goal(s)`);
  }

  if (blocked.length > 0) {
    parts.push(`${blocked.length} blocked goal(s)`);
  }

  return parts.join(". ");
}

/**
 * Render goal stack summary for system prompt (alias for summarizeGoalStack)
 */
export function renderGoalStackSummary(stack: GoalStack): string {
  return summarizeGoalStack(stack);
}
