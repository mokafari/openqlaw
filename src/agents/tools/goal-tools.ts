/**
 * Goal Stack Tools
 *
 * Agent tools for managing goal stacks (push, pop, status)
 * Integrated with meta-learning for prediction/outcome tracking.
 */

import { Type } from "@sinclair/typebox";
import type { GoalType } from "../goals/types.js";
import type { AnyAgentTool } from "./common.js";
import { loadConfig } from "../../config/config.js";
import { loadSessionStore, resolveStorePath, updateSessionStore } from "../../config/sessions.js";
import { resolveAgentIdFromSessionKey } from "../../routing/session-key.js";
import { logGoalPrediction, logGoalOutcome } from "../goals/meta-integration.js";
import { GoalStack } from "../goals/stack.js";
import { visualizeGoalStack, summarizeGoalStack } from "../goals/visualizer.js";
import { log } from "../pi-embedded-runner/logger.js";
import { jsonResult, readStringParam } from "./common.js";
import { resolveInternalSessionKey, resolveMainSessionAlias } from "./sessions-helpers.js";

const GoalPushSchema = Type.Object({
  description: Type.String(),
  type: Type.Optional(
    Type.Union([Type.Literal("task"), Type.Literal("obstacle"), Type.Literal("subgoal")]),
  ),
  parentId: Type.Optional(Type.String()),
  metadata: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
  // Optional prediction overrides for meta-learning
  predictedSuccess: Type.Optional(Type.Number()),
  predictedDurationMs: Type.Optional(Type.Number()),
  predictedDifficulty: Type.Optional(Type.Number()),
});

const GoalPopSchema = Type.Object({
  goalId: Type.Optional(Type.String()),
});

const GoalStatusSchema = Type.Object({
  format: Type.Optional(Type.Union([Type.Literal("summary"), Type.Literal("full")])),
});

const GoalBlockSchema = Type.Object({
  obstacle: Type.String(),
});

const GoalUnblockSchema = Type.Object({
  obstacleId: Type.String(),
});

function loadGoalStack(internalKey: string): GoalStack {
  const storePath = resolveStorePath(undefined, {
    agentId: resolveAgentIdFromSessionKey(internalKey),
  });
  const sessionStore = loadSessionStore(storePath);
  const entry = sessionStore[internalKey];
  const goalStackEntry = entry?.goalStack;

  if (goalStackEntry?.goals) {
    return GoalStack.deserialize({
      sessionKey: internalKey,
      goals: goalStackEntry.goals,
    });
  }

  return new GoalStack(internalKey);
}

function saveGoalStack(internalKey: string, stack: GoalStack): void {
  const storePath = resolveStorePath(undefined, {
    agentId: resolveAgentIdFromSessionKey(internalKey),
  });

  updateSessionStore(storePath, (store) => {
    const entry = store[internalKey];
    if (entry) {
      entry.goalStack = {
        goals: [...stack.getAll()],
        updatedAt: Date.now(),
      };
    }
  });
}

export function createGoalPushTool(opts?: { agentSessionKey?: string }): AnyAgentTool {
  return {
    label: "Goals",
    name: "goal_push",
    description:
      "Push a new goal onto the goal stack. Use this for multi-step tasks where you need to track progress through obstacles.",
    parameters: GoalPushSchema,
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const description = readStringParam(params, "description", { required: true });
      const type = (params.type as GoalType | undefined) ?? "task";
      const parentId = readStringParam(params, "parentId");
      const metadata = params.metadata as Record<string, unknown> | undefined;

      // Extract prediction overrides
      const predictedSuccess = params.predictedSuccess as number | undefined;
      const predictedDurationMs = params.predictedDurationMs as number | undefined;
      const predictedDifficulty = params.predictedDifficulty as number | undefined;

      const sessionKey = opts?.agentSessionKey;
      if (!sessionKey) {
        return jsonResult({ error: "No session key available" });
      }

      const cfg = loadConfig();
      const { alias, mainKey } = resolveMainSessionAlias(cfg);
      const internalKey = resolveInternalSessionKey({ key: sessionKey, alias, mainKey });
      const stack = loadGoalStack(internalKey);

      const goalId = stack.push({
        type,
        description,
        parentId,
        metadata,
      });

      // Activate the new goal
      stack.activate(goalId);

      saveGoalStack(internalKey, stack);

      // Log prediction to meta-learning system (async, non-blocking)
      const goal = stack.getById(goalId);
      if (goal) {
        logGoalPrediction(goal, {
          predictedSuccess,
          predictedDurationMs,
          predictedDifficulty,
        }).catch((err) => {
          log.warn(`[goal_push] Failed to log prediction: ${err}`);
        });
      }

      return jsonResult({
        success: true,
        goalId,
        description,
        type,
        stackDepth: stack.getDepth(),
      });
    },
  };
}

export function createGoalPopTool(opts?: { agentSessionKey?: string }): AnyAgentTool {
  return {
    label: "Goals",
    name: "goal_pop",
    description: "Pop the topmost active goal from the goal stack, marking it as completed.",
    parameters: GoalPopSchema,
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const goalId = readStringParam(params, "goalId");

      const sessionKey = opts?.agentSessionKey;
      if (!sessionKey) {
        return jsonResult({ error: "No session key available" });
      }

      const cfg = loadConfig();
      const { alias, mainKey } = resolveMainSessionAlias(cfg);
      const internalKey = resolveInternalSessionKey({ key: sessionKey, alias, mainKey });
      const stack = loadGoalStack(internalKey);

      if (goalId) {
        // Pop specific goal
        const goal = stack.getById(goalId);
        if (!goal) {
          return jsonResult({ error: `Goal ${goalId} not found` });
        }
        stack.complete(goalId);
        saveGoalStack(internalKey, stack);

        // Log outcome to meta-learning system
        const completedGoal = stack.getById(goalId);
        if (completedGoal) {
          logGoalOutcome(completedGoal).catch((err) => {
            log.warn(`[goal_pop] Failed to log outcome: ${err}`);
          });
        }

        return jsonResult({
          success: true,
          goalId,
          description: goal.description,
          stackDepth: stack.getDepth(),
        });
      }

      // Pop topmost active goal
      const popped = stack.pop();
      if (!popped) {
        return jsonResult({ error: "No active goal to pop" });
      }

      saveGoalStack(internalKey, stack);

      // Log outcome to meta-learning system
      logGoalOutcome(popped).catch((err) => {
        log.warn(`[goal_pop] Failed to log outcome: ${err}`);
      });

      return jsonResult({
        success: true,
        goalId: popped.id,
        description: popped.description,
        stackDepth: stack.getDepth(),
      });
    },
  };
}

export function createGoalStatusTool(opts?: { agentSessionKey?: string }): AnyAgentTool {
  return {
    label: "Goals",
    name: "goal_status",
    description:
      "Get the current status of the goal stack, showing active, blocked, and completed goals.",
    parameters: GoalStatusSchema,
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const format = (params.format as "summary" | "full" | undefined) ?? "summary";

      const sessionKey = opts?.agentSessionKey;
      if (!sessionKey) {
        return jsonResult({ error: "No session key available" });
      }

      const cfg = loadConfig();
      const { alias, mainKey } = resolveMainSessionAlias(cfg);
      const internalKey = resolveInternalSessionKey({ key: sessionKey, alias, mainKey });
      const stack = loadGoalStack(internalKey);

      if (format === "full") {
        const visualization = visualizeGoalStack(stack);
        return jsonResult({
          success: true,
          visualization,
          stackDepth: stack.getDepth(),
          activeCount: stack.getActive().length,
          blockedCount: stack.getBlocked().length,
        });
      }

      const summary = summarizeGoalStack(stack);
      const current = stack.peek();

      return jsonResult({
        success: true,
        summary,
        currentGoal: current
          ? {
              id: current.id,
              description: current.description,
              type: current.type,
              status: current.status,
            }
          : null,
        stackDepth: stack.getDepth(),
        activeCount: stack.getActive().length,
        blockedCount: stack.getBlocked().length,
      });
    },
  };
}

export function createGoalBlockTool(opts?: { agentSessionKey?: string }): AnyAgentTool {
  return {
    label: "Goals",
    name: "goal_block",
    description:
      "Block the current active goal with an obstacle. This creates a new obstacle goal and marks the current goal as blocked.",
    parameters: GoalBlockSchema,
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const obstacle = readStringParam(params, "obstacle", { required: true });

      const sessionKey = opts?.agentSessionKey;
      if (!sessionKey) {
        return jsonResult({ error: "No session key available" });
      }

      const cfg = loadConfig();
      const { alias, mainKey } = resolveMainSessionAlias(cfg);
      const internalKey = resolveInternalSessionKey({ key: sessionKey, alias, mainKey });
      const stack = loadGoalStack(internalKey);

      try {
        const obstacleId = stack.blockCurrent(obstacle);
        saveGoalStack(internalKey, stack);

        return jsonResult({
          success: true,
          obstacleId,
          obstacle,
          stackDepth: stack.getDepth(),
        });
      } catch (error) {
        return jsonResult({
          error: error instanceof Error ? error.message : String(error),
        });
      }
    },
  };
}

export function createGoalUnblockTool(opts?: { agentSessionKey?: string }): AnyAgentTool {
  return {
    label: "Goals",
    name: "goal_unblock",
    description:
      "Unblock a goal by resolving its obstacle. This marks the obstacle as completed and reactivates the blocked goal.",
    parameters: GoalUnblockSchema,
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const obstacleId = readStringParam(params, "obstacleId", { required: true });

      const sessionKey = opts?.agentSessionKey;
      if (!sessionKey) {
        return jsonResult({ error: "No session key available" });
      }

      const cfg = loadConfig();
      const { alias, mainKey } = resolveMainSessionAlias(cfg);
      const internalKey = resolveInternalSessionKey({ key: sessionKey, alias, mainKey });
      const stack = loadGoalStack(internalKey);

      const success = stack.unblock(obstacleId);
      if (!success) {
        return jsonResult({ error: `Failed to unblock obstacle ${obstacleId}` });
      }

      saveGoalStack(internalKey, stack);

      return jsonResult({
        success: true,
        obstacleId,
        stackDepth: stack.getDepth(),
      });
    },
  };
}
