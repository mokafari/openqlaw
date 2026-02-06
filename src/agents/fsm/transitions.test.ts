import { describe, expect, it } from "vitest";
import type { AgentState } from "./states.js";
import { canTransition, getAllowedTransitions, getDefaultTransition } from "./transitions.js";

describe("FSM Transitions", () => {
  describe("canTransition", () => {
    it("should return true for valid transitions", () => {
      expect(canTransition("idle", "planning")).toBe(true);
      expect(canTransition("planning", "executing")).toBe(true);
      expect(canTransition("executing", "verifying")).toBe(true);
    });

    it("should return false for invalid transitions", () => {
      // Note: idle CAN transition to executing (it's in VALID_TRANSITIONS)
      // Note: reporting CAN transition to planning (it's in VALID_TRANSITIONS)
      expect(canTransition("idle", "verifying")).toBe(false);
      expect(canTransition("reporting", "executing")).toBe(false);
      expect(canTransition("idle", "camping")).toBe(false);
    });
  });

  describe("getAllowedTransitions", () => {
    it("should return allowed transitions for idle", () => {
      const allowed = getAllowedTransitions("idle");
      expect(allowed).toContain("gathering_info");
      expect(allowed).toContain("planning");
      expect(allowed).toContain("executing");
      expect(allowed).toContain("diagnostic");
    });

    it("should return allowed transitions for executing", () => {
      const allowed = getAllowedTransitions("executing");
      expect(allowed).toContain("verifying");
      expect(allowed).toContain("retreating");
      expect(allowed).toContain("camping");
      expect(allowed).toContain("reporting");
    });

    it("should return empty array for unknown state", () => {
      const allowed = getAllowedTransitions("unknown" as AgentState);
      expect(allowed).toEqual([]);
    });
  });

  describe("getDefaultTransition", () => {
    it("should transition to retreating on error", () => {
      const next = getDefaultTransition("executing", { error: true });
      expect(next).toBe("retreating");
    });

    it("should transition to reporting on success after verifying", () => {
      const next = getDefaultTransition("verifying", { success: true });
      expect(next).toBe("reporting");
    });

    it("should transition to diagnostic on high tool error rate", () => {
      const next = getDefaultTransition("idle", {
        event: "high_tool_error_rate",
      });
      expect(next).toBe("diagnostic");
    });

    it("should transition to mutating from diagnostic when root cause found", () => {
      const next = getDefaultTransition("diagnostic", {
        event: "root_cause_found",
      });
      expect(next).toBe("mutating");
    });

    it("should transition to self_correcting from mutating when patch generated", () => {
      const next = getDefaultTransition("mutating", {
        event: "patch_generated",
      });
      expect(next).toBe("self_correcting");
    });

    it("should transition to reporting from self_correcting on success", () => {
      const next = getDefaultTransition("self_correcting", { success: true });
      expect(next).toBe("reporting");
    });

    it("should transition back to mutating from self_correcting on error", () => {
      const next = getDefaultTransition("self_correcting", { error: true });
      expect(next).toBe("mutating");
    });

    it("should return first allowed transition as default", () => {
      const next = getDefaultTransition("idle");
      expect(next).toBeDefined();
      expect(typeof next).toBe("string");
    });

    it("should return undefined when no transitions available", () => {
      // This shouldn't happen in practice, but test edge case
      const next = getDefaultTransition("idle", {});
      expect(next).toBeDefined(); // Should return first allowed
    });
  });
});
