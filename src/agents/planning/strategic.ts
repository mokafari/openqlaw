/**
 * Strategic Planning - Multi-step goal decomposition and tracking
 * Part of AGI 2026 TIER 3: Strategic Planning
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";

const DATA_DIR =
  process.env.OPENCLAW_WORKSPACE || path.join(process.env.HOME || "", ".openclaw", "workspace");
const PLANS_FILE = path.join(DATA_DIR, "data", "strategic-plans.jsonl");

// Types
export interface StrategicGoal {
  id: string;
  parentId?: string;
  description: string;
  priority: "low" | "medium" | "high" | "critical";
  status: "pending" | "active" | "blocked" | "completed" | "abandoned";
  createdAt: number;
  updatedAt: number;
  deadline?: number;
  subtasks: string[]; // IDs of subtasks
  blockers: string[];
  progress: number; // 0-100
  notes?: string;
}

export interface PlanUpdate {
  goalId: string;
  timestamp: number;
  action: "create" | "activate" | "block" | "unblock" | "progress" | "complete" | "abandon";
  details?: string;
}

// In-memory cache
let goals: Map<string, StrategicGoal> = new Map();
let initialized = false;

// Generate ID
function generateId(): string {
  return `goal_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

// Load goals
async function loadGoals(): Promise<void> {
  if (initialized) return;

  try {
    await fs.mkdir(path.dirname(PLANS_FILE), { recursive: true });
    const content = await fs.readFile(PLANS_FILE, "utf-8");
    const lines = content.trim().split("\n").filter(Boolean);

    for (const line of lines) {
      try {
        const entry = JSON.parse(line);
        if (entry.type === "goal") {
          goals.set(entry.id, entry);
        }
      } catch {}
    }
  } catch {}

  initialized = true;
}

// Save goal
async function saveGoal(goal: StrategicGoal): Promise<void> {
  await fs.mkdir(path.dirname(PLANS_FILE), { recursive: true });
  await fs.appendFile(PLANS_FILE, JSON.stringify({ type: "goal", ...goal }) + "\n");
}

// Log update
async function logUpdate(update: PlanUpdate): Promise<void> {
  await fs.appendFile(PLANS_FILE, JSON.stringify({ type: "update", ...update }) + "\n");
}

// Decompose a goal into subtasks
export async function decomposeGoal(
  description: string,
  subtaskDescriptions: string[],
  options: {
    parentId?: string;
    priority?: StrategicGoal["priority"];
    deadline?: number;
  } = {},
): Promise<{ goalId: string; subtaskIds: string[] }> {
  await loadGoals();

  const goalId = generateId();
  const subtaskIds: string[] = [];

  // Create subtasks first
  for (const subtaskDesc of subtaskDescriptions) {
    const subtaskId = generateId();
    const subtask: StrategicGoal = {
      id: subtaskId,
      parentId: goalId,
      description: subtaskDesc,
      priority: options.priority || "medium",
      status: "pending",
      createdAt: Date.now(),
      updatedAt: Date.now(),
      subtasks: [],
      blockers: [],
      progress: 0,
    };

    goals.set(subtaskId, subtask);
    await saveGoal(subtask);
    subtaskIds.push(subtaskId);
  }

  // Create main goal
  const goal: StrategicGoal = {
    id: goalId,
    parentId: options.parentId,
    description,
    priority: options.priority || "medium",
    status: "pending",
    createdAt: Date.now(),
    updatedAt: Date.now(),
    deadline: options.deadline,
    subtasks: subtaskIds,
    blockers: [],
    progress: 0,
  };

  goals.set(goalId, goal);
  await saveGoal(goal);
  await logUpdate({ goalId, timestamp: Date.now(), action: "create" });

  return { goalId, subtaskIds };
}

// Track progress
export async function trackProgress(
  goalId: string,
  newProgress?: number,
): Promise<{ goal: StrategicGoal | null; subtaskProgress: number }> {
  await loadGoals();

  const goal = goals.get(goalId);
  if (!goal) return { goal: null, subtaskProgress: 0 };

  // Calculate progress from subtasks
  let subtaskProgress = 0;
  if (goal.subtasks.length > 0) {
    let totalProgress = 0;
    for (const subtaskId of goal.subtasks) {
      const subtask = goals.get(subtaskId);
      if (subtask) {
        totalProgress += subtask.progress;
      }
    }
    subtaskProgress = totalProgress / goal.subtasks.length;
  }

  // Update progress if provided
  if (newProgress !== undefined) {
    goal.progress = Math.max(0, Math.min(100, newProgress));
    goal.updatedAt = Date.now();
    goals.set(goalId, goal);
    await saveGoal(goal);
    await logUpdate({
      goalId,
      timestamp: Date.now(),
      action: "progress",
      details: `${newProgress}%`,
    });
  }

  return { goal, subtaskProgress };
}

// Get blockers
export async function getBlockers(goalId: string): Promise<{
  directBlockers: string[];
  subtaskBlockers: Array<{ subtaskId: string; blockers: string[] }>;
}> {
  await loadGoals();

  const goal = goals.get(goalId);
  if (!goal) return { directBlockers: [], subtaskBlockers: [] };

  const subtaskBlockers: Array<{ subtaskId: string; blockers: string[] }> = [];

  for (const subtaskId of goal.subtasks) {
    const subtask = goals.get(subtaskId);
    if (subtask && subtask.blockers.length > 0) {
      subtaskBlockers.push({ subtaskId, blockers: subtask.blockers });
    }
  }

  return {
    directBlockers: goal.blockers,
    subtaskBlockers,
  };
}

// Add blocker
export async function addBlocker(goalId: string, blocker: string): Promise<boolean> {
  await loadGoals();

  const goal = goals.get(goalId);
  if (!goal) return false;

  goal.blockers.push(blocker);
  goal.status = "blocked";
  goal.updatedAt = Date.now();
  goals.set(goalId, goal);
  await saveGoal(goal);
  await logUpdate({ goalId, timestamp: Date.now(), action: "block", details: blocker });

  return true;
}

// Remove blocker
export async function removeBlocker(goalId: string, blocker: string): Promise<boolean> {
  await loadGoals();

  const goal = goals.get(goalId);
  if (!goal) return false;

  goal.blockers = goal.blockers.filter((b) => b !== blocker);
  if (goal.blockers.length === 0 && goal.status === "blocked") {
    goal.status = "active";
  }
  goal.updatedAt = Date.now();
  goals.set(goalId, goal);
  await saveGoal(goal);
  await logUpdate({ goalId, timestamp: Date.now(), action: "unblock", details: blocker });

  return true;
}

// Complete goal
export async function completeGoal(goalId: string): Promise<boolean> {
  await loadGoals();

  const goal = goals.get(goalId);
  if (!goal) return false;

  goal.status = "completed";
  goal.progress = 100;
  goal.updatedAt = Date.now();
  goals.set(goalId, goal);
  await saveGoal(goal);
  await logUpdate({ goalId, timestamp: Date.now(), action: "complete" });

  return true;
}

// Get goal tree
export async function getGoalTree(rootId?: string): Promise<StrategicGoal[]> {
  await loadGoals();

  if (rootId) {
    const root = goals.get(rootId);
    if (!root) return [];

    const tree: StrategicGoal[] = [root];
    for (const subtaskId of root.subtasks) {
      const subtree = await getGoalTree(subtaskId);
      tree.push(...subtree);
    }
    return tree;
  }

  // Return top-level goals (no parent)
  return Array.from(goals.values()).filter((g) => !g.parentId);
}

// Get active goals
export async function getActiveGoals(): Promise<StrategicGoal[]> {
  await loadGoals();
  return Array.from(goals.values()).filter((g) => g.status === "active" || g.status === "pending");
}

// Reset (for testing)
export function reset(): void {
  goals = new Map();
  initialized = false;
}
