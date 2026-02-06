import { describe, expect, it } from "vitest";
import type { Goal } from "./types.js";
import { GoalStack } from "./stack.js";

describe("GoalStack", () => {
  const sessionKey = "test-session-123";

  describe("initialization", () => {
    it("should create empty stack", () => {
      const stack = new GoalStack(sessionKey);
      expect(stack.isEmpty()).toBe(true);
      expect(stack.getDepth()).toBe(0);
      expect(stack.peek()).toBeUndefined();
    });

    it("should create stack with initial goals", () => {
      const goals: Goal[] = [
        {
          id: "goal-1",
          type: "task",
          description: "Task 1",
          status: "pending",
          createdAt: Date.now(),
        },
      ];
      const stack = new GoalStack(sessionKey, goals);
      expect(stack.isEmpty()).toBe(false);
      expect(stack.getDepth()).toBe(1);
    });
  });

  describe("push", () => {
    it("should push a goal and return its ID", () => {
      const stack = new GoalStack(sessionKey);
      const goalId = stack.push({
        type: "task",
        description: "Deploy application",
      });

      expect(goalId).toBeTruthy();
      expect(stack.getDepth()).toBe(1);
      expect(stack.isEmpty()).toBe(false);
    });

    it("should generate unique IDs for each goal", () => {
      const stack = new GoalStack(sessionKey);
      const id1 = stack.push({ type: "task", description: "Goal 1" });
      const id2 = stack.push({ type: "task", description: "Goal 2" });

      expect(id1).not.toBe(id2);
    });

    it("should set goal status to pending", () => {
      const stack = new GoalStack(sessionKey);
      const goalId = stack.push({ type: "task", description: "Test" });
      const goal = stack.getById(goalId);

      expect(goal?.status).toBe("pending");
      expect(goal?.createdAt).toBeGreaterThan(0);
    });
  });

  describe("peek", () => {
    it("should return topmost active goal", () => {
      const stack = new GoalStack(sessionKey);
      const id1 = stack.push({ type: "task", description: "Goal 1" });
      const id2 = stack.push({ type: "task", description: "Goal 2" });

      const top = stack.peek();
      expect(top?.id).toBe(id2);
      expect(top?.description).toBe("Goal 2");
    });

    it("should return undefined for empty stack", () => {
      const stack = new GoalStack(sessionKey);
      expect(stack.peek()).toBeUndefined();
    });

    it("should skip completed goals", () => {
      const stack = new GoalStack(sessionKey);
      const id1 = stack.push({ type: "task", description: "Goal 1" });
      const id2 = stack.push({ type: "task", description: "Goal 2" });

      stack.complete(id2);
      const top = stack.peek();
      expect(top?.id).toBe(id1);
    });
  });

  describe("pop", () => {
    it("should pop and mark topmost active goal as completed", () => {
      const stack = new GoalStack(sessionKey);
      const id1 = stack.push({ type: "task", description: "Goal 1" });
      const id2 = stack.push({ type: "task", description: "Goal 2" });

      const popped = stack.pop();
      expect(popped?.id).toBe(id2);
      expect(popped?.status).toBe("completed");
      expect(popped?.resolvedAt).toBeGreaterThan(0);

      const goal = stack.getById(id2);
      expect(goal?.status).toBe("completed");
    });

    it("should return undefined for empty stack", () => {
      const stack = new GoalStack(sessionKey);
      expect(stack.pop()).toBeUndefined();
    });

    it("should skip completed goals when popping", () => {
      const stack = new GoalStack(sessionKey);
      const id1 = stack.push({ type: "task", description: "Goal 1" });
      const id2 = stack.push({ type: "task", description: "Goal 2" });

      stack.complete(id2);
      const popped = stack.pop();
      expect(popped?.id).toBe(id1);
    });
  });

  describe("activate", () => {
    it("should activate a pending goal", () => {
      const stack = new GoalStack(sessionKey);
      const goalId = stack.push({ type: "task", description: "Test" });

      const result = stack.activate(goalId);
      expect(result).toBe(true);

      const goal = stack.getById(goalId);
      expect(goal?.status).toBe("active");
    });

    it("should activate a blocked goal", () => {
      const stack = new GoalStack(sessionKey);
      const goalId = stack.push({ type: "task", description: "Test" });
      stack.blockCurrent("Blocked");

      const result = stack.activate(goalId);
      expect(result).toBe(true);
    });

    it("should return false for already active goal", () => {
      const stack = new GoalStack(sessionKey);
      const goalId = stack.push({ type: "task", description: "Test" });
      stack.activate(goalId);

      const result = stack.activate(goalId);
      expect(result).toBe(false);
    });

    it("should return false for completed goal", () => {
      const stack = new GoalStack(sessionKey);
      const goalId = stack.push({ type: "task", description: "Test" });
      stack.complete(goalId);

      const result = stack.activate(goalId);
      expect(result).toBe(false);
    });
  });

  describe("blockCurrent", () => {
    it("should block current goal and create obstacle", () => {
      const stack = new GoalStack(sessionKey);
      const mainId = stack.push({ type: "task", description: "Deploy" });

      const obstacleId = stack.blockCurrent("Docker not running");

      const mainGoal = stack.getById(mainId);
      expect(mainGoal?.status).toBe("blocked");
      expect(mainGoal?.blockedBy).toBe(obstacleId);

      const obstacle = stack.getById(obstacleId);
      expect(obstacle?.type).toBe("obstacle");
      expect(obstacle?.description).toBe("Docker not running");
      expect(obstacle?.status).toBe("active");
      expect(obstacle?.parentId).toBe(mainId);
    });

    it("should throw error when no active goal to block", () => {
      const stack = new GoalStack(sessionKey);
      expect(() => stack.blockCurrent("Error")).toThrow("No active goal to block");
    });
  });

  describe("unblock", () => {
    it("should unblock parent goal when obstacle is resolved", () => {
      const stack = new GoalStack(sessionKey);
      const mainId = stack.push({ type: "task", description: "Deploy" });
      const obstacleId = stack.blockCurrent("Docker not running");

      stack.complete(obstacleId);
      const result = stack.unblock(obstacleId);

      expect(result).toBe(true);

      const mainGoal = stack.getById(mainId);
      expect(mainGoal?.status).toBe("active");
      expect(mainGoal?.blockedBy).toBeUndefined();

      const obstacle = stack.getById(obstacleId);
      expect(obstacle?.status).toBe("completed");
    });

    it("should return false for non-obstacle goal", () => {
      const stack = new GoalStack(sessionKey);
      const goalId = stack.push({ type: "task", description: "Test" });

      const result = stack.unblock(goalId);
      expect(result).toBe(false);
    });

    it("should return false for non-existent goal", () => {
      const stack = new GoalStack(sessionKey);
      const result = stack.unblock("nonexistent-id");
      expect(result).toBe(false);
    });
  });

  describe("complete", () => {
    it("should mark goal as completed", () => {
      const stack = new GoalStack(sessionKey);
      const goalId = stack.push({ type: "task", description: "Test" });

      const result = stack.complete(goalId);
      expect(result).toBe(true);

      const goal = stack.getById(goalId);
      expect(goal?.status).toBe("completed");
      expect(goal?.resolvedAt).toBeGreaterThan(0);
    });

    it("should not complete already failed goal", () => {
      const stack = new GoalStack(sessionKey);
      const goalId = stack.push({ type: "task", description: "Test" });
      stack.fail(goalId);

      const result = stack.complete(goalId);
      expect(result).toBe(false);
    });
  });

  describe("fail", () => {
    it("should mark goal as failed", () => {
      const stack = new GoalStack(sessionKey);
      const goalId = stack.push({ type: "task", description: "Test" });

      const result = stack.fail(goalId);
      expect(result).toBe(true);

      const goal = stack.getById(goalId);
      expect(goal?.status).toBe("failed");
      expect(goal?.resolvedAt).toBeGreaterThan(0);
    });

    it("should not fail already completed goal", () => {
      const stack = new GoalStack(sessionKey);
      const goalId = stack.push({ type: "task", description: "Test" });
      stack.complete(goalId);

      const result = stack.fail(goalId);
      expect(result).toBe(false);
    });
  });

  describe("getActive", () => {
    it("should return all active and pending goals", () => {
      const stack = new GoalStack(sessionKey);
      const id1 = stack.push({ type: "task", description: "Goal 1" });
      const id2 = stack.push({ type: "task", description: "Goal 2" });
      stack.activate(id1);

      const active = stack.getActive();
      expect(active.length).toBe(2);
      expect(active.map((g) => g.id)).toContain(id1);
      expect(active.map((g) => g.id)).toContain(id2);
    });

    it("should exclude completed and failed goals", () => {
      const stack = new GoalStack(sessionKey);
      const id1 = stack.push({ type: "task", description: "Goal 1" });
      const id2 = stack.push({ type: "task", description: "Goal 2" });
      stack.complete(id1);
      stack.fail(id2);

      const active = stack.getActive();
      expect(active.length).toBe(0);
    });
  });

  describe("getBlocked", () => {
    it("should return all blocked goals", () => {
      const stack = new GoalStack(sessionKey);
      const id1 = stack.push({ type: "task", description: "Goal 1" });

      stack.blockCurrent("Blocked 1");
      // After blockCurrent, the main goal is blocked and obstacle is active
      // getBlocked() only returns goals with status "blocked"
      const blocked = stack.getBlocked();
      expect(blocked.length).toBe(1);
      expect(blocked.map((g) => g.id)).toContain(id1);
      // The obstacle itself is not "blocked", it's "active"
    });
  });

  describe("serialize and deserialize", () => {
    it("should serialize stack state", () => {
      const stack = new GoalStack(sessionKey);
      stack.push({ type: "task", description: "Goal 1" });
      stack.push({ type: "task", description: "Goal 2" });

      const serialized = stack.serialize();
      expect(serialized.sessionKey).toBe(sessionKey);
      expect(serialized.goals.length).toBe(2);
    });

    it("should deserialize stack state", () => {
      const stack1 = new GoalStack(sessionKey);
      const id1 = stack1.push({ type: "task", description: "Goal 1" });
      const id2 = stack1.push({ type: "task", description: "Goal 2" });
      stack1.complete(id2);

      const serialized = stack1.serialize();
      const stack2 = GoalStack.deserialize(serialized);

      expect(stack2.getDepth()).toBe(1); // Only active/pending goals
      expect(stack2.getAll().length).toBe(2); // All goals preserved
      const goal2 = stack2.getById(id2);
      expect(goal2?.status).toBe("completed");
    });

    it("should preserve goal relationships on deserialize", () => {
      const stack1 = new GoalStack(sessionKey);
      const mainId = stack1.push({ type: "task", description: "Main" });
      const obstacleId = stack1.blockCurrent("Obstacle");

      const serialized = stack1.serialize();
      const stack2 = GoalStack.deserialize(serialized);

      const mainGoal = stack2.getById(mainId);
      expect(mainGoal?.blockedBy).toBe(obstacleId);

      const obstacle = stack2.getById(obstacleId);
      expect(obstacle?.parentId).toBe(mainId);
    });
  });

  describe("clear", () => {
    it("should clear all goals", () => {
      const stack = new GoalStack(sessionKey);
      stack.push({ type: "task", description: "Goal 1" });
      stack.push({ type: "task", description: "Goal 2" });

      stack.clear();
      expect(stack.isEmpty()).toBe(true);
      expect(stack.getDepth()).toBe(0);
      expect(stack.getAll().length).toBe(0);
    });
  });
});
