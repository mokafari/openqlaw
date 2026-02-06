import { describe, expect, it } from "vitest";
import type { AgentState, QuakeNode } from "./states.js";
import {
  AGENT_STATES,
  getQuakeNodeDescription,
  getStateDescription,
  isValidQuakeNode,
  isValidState,
  isValidTransition,
  QUAKE_NODE_MAPPING,
  quakeNodeToState,
  stateToQuakeNode,
  VALID_TRANSITIONS,
} from "./states.js";

describe("FSM States", () => {
  describe("isValidState", () => {
    it("should return true for valid states", () => {
      expect(isValidState("idle")).toBe(true);
      expect(isValidState("planning")).toBe(true);
      expect(isValidState("executing")).toBe(true);
      expect(isValidState("camping")).toBe(true);
    });

    it("should return false for invalid states", () => {
      expect(isValidState("invalid")).toBe(false);
      expect(isValidState("")).toBe(false);
      expect(isValidState("IDLE")).toBe(false); // Case sensitive
    });
  });

  describe("isValidQuakeNode", () => {
    it("should return true for valid Quake nodes", () => {
      expect(isValidQuakeNode("NODE_STAND")).toBe(true);
      expect(isValidQuakeNode("NODE_PLAN")).toBe(true);
      expect(isValidQuakeNode("NODE_SEEK_GOAL")).toBe(true);
      expect(isValidQuakeNode("NODE_BATTLE_ERROR")).toBe(true);
    });

    it("should return false for invalid Quake nodes", () => {
      expect(isValidQuakeNode("INVALID_NODE")).toBe(false);
      expect(isValidQuakeNode("")).toBe(false);
    });
  });

  describe("stateToQuakeNode", () => {
    it("should map idle to NODE_STAND", () => {
      expect(stateToQuakeNode("idle")).toBe("NODE_STAND");
    });

    it("should map planning to NODE_PLAN", () => {
      expect(stateToQuakeNode("planning")).toBe("NODE_PLAN");
    });

    it("should map executing to NODE_SEEK_GOAL", () => {
      expect(stateToQuakeNode("executing")).toBe("NODE_SEEK_GOAL");
    });

    it("should map retreating to NODE_BATTLE_ERROR", () => {
      expect(stateToQuakeNode("retreating")).toBe("NODE_BATTLE_ERROR");
    });

    it("should map camping to NODE_CAMP", () => {
      expect(stateToQuakeNode("camping")).toBe("NODE_CAMP");
    });

    it("should default to NODE_STAND for unmapped states", () => {
      expect(stateToQuakeNode("gathering_info")).toBe("NODE_STAND");
    });
  });

  describe("quakeNodeToState", () => {
    it("should map NODE_STAND to idle", () => {
      expect(quakeNodeToState("NODE_STAND")).toBe("idle");
    });

    it("should map NODE_PLAN to planning", () => {
      expect(quakeNodeToState("NODE_PLAN")).toBe("planning");
    });

    it("should map NODE_SEEK_GOAL to executing", () => {
      expect(quakeNodeToState("NODE_SEEK_GOAL")).toBe("executing");
    });

    it("should map NODE_BATTLE_ERROR to retreating", () => {
      expect(quakeNodeToState("NODE_BATTLE_ERROR")).toBe("retreating");
    });

    it("should map NODE_CAMP to camping", () => {
      expect(quakeNodeToState("NODE_CAMP")).toBe("camping");
    });

    it("should map NODE_DIAGNOSTIC to diagnostic", () => {
      expect(quakeNodeToState("NODE_DIAGNOSTIC")).toBe("diagnostic");
    });

    it("should map NODE_MUTATION to mutating", () => {
      expect(quakeNodeToState("NODE_MUTATION")).toBe("mutating");
    });

    it("should map NODE_VERIFICATION to self_correcting", () => {
      expect(quakeNodeToState("NODE_VERIFICATION")).toBe("self_correcting");
    });
  });

  describe("isValidTransition", () => {
    it("should allow valid transitions", () => {
      expect(isValidTransition("idle", "planning")).toBe(true);
      expect(isValidTransition("planning", "executing")).toBe(true);
      expect(isValidTransition("executing", "verifying")).toBe(true);
      expect(isValidTransition("executing", "retreating")).toBe(true);
    });

    it("should allow self-transitions", () => {
      expect(isValidTransition("idle", "idle")).toBe(true);
      expect(isValidTransition("planning", "planning")).toBe(true);
      expect(isValidTransition("executing", "executing")).toBe(true);
    });

    it("should reject invalid transitions", () => {
      // Note: idle CAN transition to executing (it's in VALID_TRANSITIONS)
      // Note: reporting CAN transition to planning (it's in VALID_TRANSITIONS)
      expect(isValidTransition("idle", "verifying")).toBe(false);
      expect(isValidTransition("reporting", "executing")).toBe(false);
      expect(isValidTransition("idle", "camping")).toBe(false);
    });

    it("should allow transitions from diagnostic to mutating", () => {
      expect(isValidTransition("diagnostic", "mutating")).toBe(true);
    });

    it("should allow transitions from mutating to self_correcting", () => {
      expect(isValidTransition("mutating", "self_correcting")).toBe(true);
    });

    it("should allow transitions from self_correcting to reporting", () => {
      expect(isValidTransition("self_correcting", "reporting")).toBe(true);
    });
  });

  describe("getStateDescription", () => {
    it("should return description for valid states", () => {
      expect(getStateDescription("idle")).toBe("Agent is idle, waiting for input");
      expect(getStateDescription("planning")).toBe("Formulating a plan of action");
      expect(getStateDescription("executing")).toBe("Performing actions to achieve goals");
      expect(getStateDescription("camping")).toBe("Waiting for an external event or condition");
    });

    it("should return 'Unknown state' for invalid states", () => {
      expect(getStateDescription("invalid" as AgentState)).toBe("Unknown state");
    });
  });

  describe("getQuakeNodeDescription", () => {
    it("should return description for valid Quake nodes", () => {
      expect(getQuakeNodeDescription("NODE_STAND")).toBe("Waiting for user input (idle state)");
      expect(getQuakeNodeDescription("NODE_PLAN")).toBe("Building the GoalStack (planning phase)");
      expect(getQuakeNodeDescription("NODE_SEEK_GOAL")).toBe(
        "Executing the top goal from stack (active execution)",
      );
      expect(getQuakeNodeDescription("NODE_BATTLE_ERROR")).toBe(
        "Handling errors and obstacles (reflexive fixing)",
      );
    });

    it("should return 'Unknown node' for invalid Quake nodes", () => {
      expect(getQuakeNodeDescription("INVALID_NODE" as QuakeNode)).toBe("Unknown node");
    });
  });

  describe("VALID_TRANSITIONS", () => {
    it("should define transitions for all states", () => {
      const allStates = Object.values(AGENT_STATES);
      for (const state of allStates) {
        expect(VALID_TRANSITIONS[state]).toBeDefined();
        expect(Array.isArray(VALID_TRANSITIONS[state])).toBe(true);
        expect(VALID_TRANSITIONS[state]!.length).toBeGreaterThan(0);
      }
    });

    it("should allow idle to transition to gathering_info, planning, executing, diagnostic", () => {
      const transitions = VALID_TRANSITIONS.idle;
      expect(transitions).toContain("gathering_info");
      expect(transitions).toContain("planning");
      expect(transitions).toContain("executing");
      expect(transitions).toContain("diagnostic");
    });

    it("should allow executing to transition to verifying, retreating, camping, reporting", () => {
      const transitions = VALID_TRANSITIONS.executing;
      expect(transitions).toContain("verifying");
      expect(transitions).toContain("retreating");
      expect(transitions).toContain("camping");
      expect(transitions).toContain("reporting");
    });

    it("should allow diagnostic to transition to mutating, idle, reporting", () => {
      const transitions = VALID_TRANSITIONS.diagnostic;
      expect(transitions).toContain("mutating");
      expect(transitions).toContain("idle");
      expect(transitions).toContain("reporting");
    });

    it("should allow mutating to transition to self_correcting, diagnostic, idle", () => {
      const transitions = VALID_TRANSITIONS.mutating;
      expect(transitions).toContain("self_correcting");
      expect(transitions).toContain("diagnostic");
      expect(transitions).toContain("idle");
    });

    it("should allow self_correcting to transition to reporting, mutating, idle", () => {
      const transitions = VALID_TRANSITIONS.self_correcting;
      expect(transitions).toContain("reporting");
      expect(transitions).toContain("mutating");
      expect(transitions).toContain("idle");
    });
  });

  describe("QUAKE_NODE_MAPPING", () => {
    it("should be exported and contain state mappings", () => {
      expect(QUAKE_NODE_MAPPING).toBeDefined();
      expect(typeof QUAKE_NODE_MAPPING).toBe("object");
    });

    it("should map idle to NODE_STAND", () => {
      expect(QUAKE_NODE_MAPPING.idle).toBe("NODE_STAND");
    });

    it("should map planning to NODE_PLAN", () => {
      expect(QUAKE_NODE_MAPPING.planning).toBe("NODE_PLAN");
    });

    it("should map executing to NODE_SEEK_GOAL", () => {
      expect(QUAKE_NODE_MAPPING.executing).toBe("NODE_SEEK_GOAL");
    });

    it("should map camping to NODE_CAMP", () => {
      expect(QUAKE_NODE_MAPPING.camping).toBe("NODE_CAMP");
    });

    it("should match stateToQuakeNode function", () => {
      expect(QUAKE_NODE_MAPPING.idle).toBe(stateToQuakeNode("idle"));
      expect(QUAKE_NODE_MAPPING.planning).toBe(stateToQuakeNode("planning"));
      expect(QUAKE_NODE_MAPPING.executing).toBe(stateToQuakeNode("executing"));
      expect(QUAKE_NODE_MAPPING.camping).toBe(stateToQuakeNode("camping"));
    });
  });
});
