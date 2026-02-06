import { describe, expect, it } from "vitest";
import { GoalStack } from "./stack.js";
import { renderGoalStackSummary, summarizeGoalStack, visualizeGoalStack } from "./visualizer.js";

describe("GoalStackVisualizer", () => {
  const sessionKey = "test-session-123";

  describe("visualizeGoalStack", () => {
    it("should return message for empty stack", () => {
      const stack = new GoalStack(sessionKey);
      const visualization = visualizeGoalStack(stack);
      expect(visualization).toContain("empty");
    });

    it("should visualize active goals", () => {
      const stack = new GoalStack(sessionKey);
      stack.push({ type: "task", description: "Deploy app" });
      stack.push({ type: "task", description: "Run tests" });

      const visualization = visualizeGoalStack(stack);
      expect(visualization).toContain("Active Goals");
      expect(visualization).toContain("Deploy app");
      expect(visualization).toContain("Run tests");
    });

    it("should visualize blocked goals with obstacles", () => {
      const stack = new GoalStack(sessionKey);
      const mainId = stack.push({ type: "task", description: "Deploy app" });
      stack.blockCurrent("Docker not running");

      const visualization = visualizeGoalStack(stack);
      expect(visualization).toContain("Blocked Goals");
      expect(visualization).toContain("Deploy app");
      expect(visualization).toContain("Docker not running");
    });

    it("should visualize completed goals", () => {
      const stack = new GoalStack(sessionKey);
      const id1 = stack.push({ type: "task", description: "Goal 1" });
      const id2 = stack.push({ type: "task", description: "Goal 2" });
      stack.complete(id1);
      stack.complete(id2);

      const visualization = visualizeGoalStack(stack);
      expect(visualization).toContain("Completed Goals");
      expect(visualization).toContain("Goal 1");
    });

    it("should visualize failed goals", () => {
      const stack = new GoalStack(sessionKey);
      const id = stack.push({ type: "task", description: "Failed goal" });
      stack.fail(id);

      const visualization = visualizeGoalStack(stack);
      expect(visualization).toContain("Failed Goals");
      expect(visualization).toContain("Failed goal");
    });

    it("should limit completed goals display", () => {
      const stack = new GoalStack(sessionKey);
      // Create more than 5 completed goals
      for (let i = 0; i < 7; i++) {
        const id = stack.push({ type: "task", description: `Goal ${i}` });
        stack.complete(id);
      }

      const visualization = visualizeGoalStack(stack);
      expect(visualization).toContain("and 2 more");
    });
  });

  describe("summarizeGoalStack", () => {
    it("should return message for empty stack", () => {
      const stack = new GoalStack(sessionKey);
      const summary = summarizeGoalStack(stack);
      expect(summary).toContain("No active goals");
    });

    it("should summarize current goal", () => {
      const stack = new GoalStack(sessionKey);
      stack.push({ type: "task", description: "Deploy app" });

      const summary = summarizeGoalStack(stack);
      expect(summary).toContain("Deploy app");
    });

    it("should include pending goals count", () => {
      const stack = new GoalStack(sessionKey);
      stack.push({ type: "task", description: "Goal 1" });
      stack.push({ type: "task", description: "Goal 2" });
      stack.push({ type: "task", description: "Goal 3" });

      const summary = summarizeGoalStack(stack);
      expect(summary).toContain("2 pending goal");
    });

    it("should include blocked goals count", () => {
      const stack = new GoalStack(sessionKey);
      stack.push({ type: "task", description: "Main goal" });
      stack.blockCurrent("Obstacle 1");
      stack.activate(stack.getAll()[0]!.id);
      stack.blockCurrent("Obstacle 2");

      const summary = summarizeGoalStack(stack);
      expect(summary).toContain("blocked goal");
    });
  });

  describe("renderGoalStackSummary", () => {
    it("should be alias for summarizeGoalStack", () => {
      const stack = new GoalStack(sessionKey);
      stack.push({ type: "task", description: "Test" });

      const summary1 = summarizeGoalStack(stack);
      const summary2 = renderGoalStackSummary(stack);

      expect(summary1).toBe(summary2);
    });
  });
});
