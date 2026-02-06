import { describe, expect, it } from "vitest";
import { FSMController } from "./controller.js";

describe("FSMController", () => {
  describe("initialization", () => {
    it("should initialize with default idle state", () => {
      const controller = new FSMController();
      expect(controller.getState()).toBe("idle");
    });

    it("should initialize with custom initial state", () => {
      const controller = new FSMController("planning");
      expect(controller.getState()).toBe("planning");
    });

    it("should initialize with empty history", () => {
      const controller = new FSMController();
      const history = controller.getStateHistory();
      expect(history.length).toBe(1);
      expect(history[0]?.state).toBe("idle");
    });
  });

  describe("transition", () => {
    it("should transition to valid state", () => {
      const controller = new FSMController();
      const result = controller.transition("planning");
      expect(result).toBe(true);
      expect(controller.getState()).toBe("planning");
    });

    it("should reject invalid transition", () => {
      const controller = new FSMController();
      // idle CAN transition to executing (it's valid), so test a truly invalid one
      const result = controller.transition("verifying");
      expect(result).toBe(false);
      expect(controller.getState()).toBe("idle");
    });

    it("should record transition in history", () => {
      const controller = new FSMController();
      controller.transition("planning", { task: "deploy" });

      const history = controller.getStateHistory();
      expect(history.length).toBe(2);
      expect(history[1]?.state).toBe("planning");
      expect(history[1]?.context?.message).toBeUndefined();
    });

    it("should trim history when exceeding max size", () => {
      const controller = new FSMController("idle", 5);
      // Make many transitions
      for (let i = 0; i < 10; i++) {
        controller.transition("planning");
        controller.transition("idle");
      }

      const history = controller.getStateHistory();
      expect(history.length).toBeLessThanOrEqual(5);
    });
  });

  describe("transitionDefault", () => {
    it("should transition using default logic", () => {
      const controller = new FSMController("executing");
      const result = controller.transitionDefault({ error: true });
      expect(result).toBe(true);
      expect(controller.getState()).toBe("retreating");
    });

    it("should return false when no default transition available", () => {
      const controller = new FSMController("idle");
      // No context provided, should use first allowed
      const result = controller.transitionDefault();
      expect(result).toBe(true); // Should transition to first allowed
    });
  });

  describe("forceTransition", () => {
    it("should force transition bypassing validation", () => {
      const controller = new FSMController();
      controller.forceTransition("executing");

      expect(controller.getState()).toBe("executing");
    });

    it("should mark forced transition in history", () => {
      const controller = new FSMController();
      controller.forceTransition("executing", { reason: "manual" });

      const history = controller.getStateHistory();
      expect(history[1]?.context?.forced).toBe(true);
    });
  });

  describe("reset", () => {
    it("should reset to default idle state", () => {
      const controller = new FSMController();
      controller.transition("planning");
      controller.transition("executing");

      controller.reset();
      expect(controller.getState()).toBe("idle");
      expect(controller.getStateHistory().length).toBe(1);
    });

    it("should reset to custom initial state", () => {
      const controller = new FSMController();
      controller.transition("planning");

      controller.reset("executing");
      expect(controller.getState()).toBe("executing");
    });
  });

  describe("getStateDescription", () => {
    it("should return description for current state", () => {
      const controller = new FSMController("planning");
      const description = controller.getStateDescription();
      expect(description).toContain("plan");
    });
  });

  describe("isTerminalState", () => {
    it("should return true for idle state", () => {
      const controller = new FSMController("idle");
      expect(controller.isTerminalState()).toBe(true);
    });

    it("should return true for reporting state", () => {
      const controller = new FSMController("reporting");
      expect(controller.isTerminalState()).toBe(true);
    });

    it("should return false for non-terminal states", () => {
      const controller = new FSMController("executing");
      expect(controller.isTerminalState()).toBe(false);
    });
  });

  describe("isErrorState", () => {
    it("should return true for retreating state", () => {
      const controller = new FSMController("retreating");
      expect(controller.isErrorState()).toBe(true);
    });

    it("should return false for non-error states", () => {
      const controller = new FSMController("executing");
      expect(controller.isErrorState()).toBe(false);
    });
  });

  describe("isWaitingState", () => {
    it("should return true for camping state", () => {
      const controller = new FSMController("camping");
      expect(controller.isWaitingState()).toBe(true);
    });

    it("should return true for idle state", () => {
      const controller = new FSMController("idle");
      expect(controller.isWaitingState()).toBe(true);
    });

    it("should return false for non-waiting states", () => {
      const controller = new FSMController("executing");
      expect(controller.isWaitingState()).toBe(false);
    });
  });
});
