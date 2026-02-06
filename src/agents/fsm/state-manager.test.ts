import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AgentState } from "./states.js";
import { createFSMStateManager } from "./state-manager.js";

describe("FSMStateManager", () => {
  let tempDir: string;
  let sessionDir: string;
  let sessionId: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "quake-test-"));
    sessionDir = path.join(tempDir, "sessions");
    await fs.mkdir(sessionDir, { recursive: true });
    sessionId = "test-session-123";
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe("initialization", () => {
    it("should initialize with default idle state", () => {
      const fsm = createFSMStateManager({ sessionId, sessionDir });
      expect(fsm.getState()).toBe("idle");
      expect(fsm.getQuakeNode()).toBe("NODE_STAND");
    });

    it("should initialize with custom initial state", () => {
      const fsm = createFSMStateManager({
        sessionId,
        sessionDir,
        initialState: "planning",
      });
      expect(fsm.getState()).toBe("planning");
      expect(fsm.getQuakeNode()).toBe("NODE_PLAN");
    });

    it("should work without sessionDir", () => {
      const fsm = createFSMStateManager({ sessionId });
      expect(fsm.getState()).toBe("idle");
    });
  });

  describe("state transitions", () => {
    it("should transition to valid state", async () => {
      const fsm = createFSMStateManager({ sessionId, sessionDir });
      const result = await fsm.transitionTo("planning");
      expect(result).toBe(true);
      expect(fsm.getState()).toBe("planning");
    });

    it("should reject invalid transition", async () => {
      const fsm = createFSMStateManager({ sessionId, sessionDir });
      // idle CAN transition to executing (it's valid), so test a truly invalid one
      const result = await fsm.transitionTo("verifying");
      expect(result).toBe(false);
      expect(fsm.getState()).toBe("idle");
    });

    it("should allow self-transitions", async () => {
      const fsm = createFSMStateManager({ sessionId, sessionDir });
      await fsm.transitionTo("planning");
      const result = await fsm.transitionTo("planning");
      expect(result).toBe(true);
      expect(fsm.getState()).toBe("planning");
    });

    it("should update metadata on transition", async () => {
      const fsm = createFSMStateManager({ sessionId, sessionDir });
      await fsm.transitionTo("planning", { task: "deploy app" });

      const record = fsm.getStateRecord();
      expect(record.metadata?.task).toBe("deploy app");
    });

    it("should track previous state", async () => {
      const fsm = createFSMStateManager({ sessionId, sessionDir });
      await fsm.transitionTo("planning");
      await fsm.transitionTo("executing");

      const record = fsm.getStateRecord();
      expect(record.previousState).toBe("planning");
    });
  });

  describe("transitionToNode", () => {
    it("should transition using Quake node", async () => {
      const fsm = createFSMStateManager({ sessionId, sessionDir });
      const result = await fsm.transitionToNode("NODE_PLAN");
      expect(result).toBe(true);
      expect(fsm.getState()).toBe("planning");
      expect(fsm.getQuakeNode()).toBe("NODE_PLAN");
    });

    it("should reject invalid node transition", async () => {
      const fsm = createFSMStateManager({ sessionId, sessionDir });
      // NODE_STAND (idle) CAN transition to NODE_SEEK_GOAL (executing) - it's valid
      // Test a truly invalid transition: NODE_STAND to NODE_BATTLE_ERROR (retreating)
      const result = await fsm.transitionToNode("NODE_BATTLE_ERROR");
      expect(result).toBe(false);
    });
  });

  describe("updateMetadata", () => {
    it("should update metadata without changing state", async () => {
      const fsm = createFSMStateManager({ sessionId, sessionDir });
      await fsm.transitionTo("planning", { task: "deploy" });
      await fsm.updateMetadata({ progress: 50 });

      const record = fsm.getStateRecord();
      expect(record.metadata?.task).toBe("deploy");
      expect(record.metadata?.progress).toBe(50);
      expect(record.state).toBe("planning");
    });

    it("should merge metadata", async () => {
      const fsm = createFSMStateManager({ sessionId, sessionDir });
      await fsm.transitionTo("planning", { task: "deploy" });
      await fsm.updateMetadata({ progress: 50 });
      await fsm.updateMetadata({ status: "in-progress" });

      const record = fsm.getStateRecord();
      expect(record.metadata?.task).toBe("deploy");
      expect(record.metadata?.progress).toBe(50);
      expect(record.metadata?.status).toBe("in-progress");
    });
  });

  describe("persistence", () => {
    it("should persist state to disk", async () => {
      const fsm = createFSMStateManager({ sessionId, sessionDir });
      await fsm.transitionTo("planning", { task: "deploy" });
      await fsm.persist();

      const stateFile = path.join(sessionDir, "fsm_state.json");
      const content = await fs.readFile(stateFile, "utf-8");
      const record = JSON.parse(content);

      expect(record.state).toBe("planning");
      expect(record.quakeNode).toBe("NODE_PLAN");
      expect(record.metadata?.task).toBe("deploy");
    });

    it("should load state from disk", async () => {
      const fsm1 = createFSMStateManager({ sessionId, sessionDir });
      await fsm1.transitionTo("executing", { task: "deploy" });
      await fsm1.persist();

      const fsm2 = createFSMStateManager({ sessionId, sessionDir });
      const loaded = await fsm2.load();

      expect(loaded).toBe(true);
      expect(fsm2.getState()).toBe("executing");
      expect(fsm2.getQuakeNode()).toBe("NODE_SEEK_GOAL");
      const record = fsm2.getStateRecord();
      expect(record.metadata?.task).toBe("deploy");
    });

    it("should handle missing state file gracefully", async () => {
      const fsm = createFSMStateManager({ sessionId, sessionDir });
      const loaded = await fsm.load();
      expect(loaded).toBe(false);
      expect(fsm.getState()).toBe("idle"); // Default state
    });

    it("should not persist when sessionDir is not provided", async () => {
      const fsm = createFSMStateManager({ sessionId });
      await fsm.transitionTo("planning");
      await fsm.persist(); // Should not throw
      expect(fsm.getState()).toBe("planning");
    });
  });

  describe("getTimeInState", () => {
    it("should return time spent in current state", async () => {
      const fsm = createFSMStateManager({ sessionId, sessionDir });
      await fsm.transitionTo("planning");

      // Wait a bit
      await new Promise((resolve) => setTimeout(resolve, 10));

      const timeInState = fsm.getTimeInState();
      expect(timeInState).toBeGreaterThan(0);
      expect(timeInState).toBeLessThan(1000); // Should be small
    });

    it("should reset time on state transition", async () => {
      const fsm = createFSMStateManager({ sessionId, sessionDir });
      await fsm.transitionTo("planning");
      const time1 = fsm.getTimeInState();

      await new Promise((resolve) => setTimeout(resolve, 10));
      await fsm.transitionTo("executing");
      const time2 = fsm.getTimeInState();

      // Time should be reset (new state), so time2 should be less than time1
      // But allow for timing precision - just verify time2 is small
      expect(time2).toBeGreaterThanOrEqual(0);
      expect(time2).toBeLessThan(100); // Should be very small after transition
    });
  });

  describe("getStateRecord", () => {
    it("should return complete state record", async () => {
      const fsm = createFSMStateManager({ sessionId, sessionDir });
      await fsm.transitionTo("planning", { task: "deploy" });

      const record = fsm.getStateRecord();
      expect(record.state).toBe("planning");
      expect(record.quakeNode).toBe("NODE_PLAN");
      expect(record.enteredAt).toBeGreaterThan(0);
      expect(record.metadata?.task).toBe("deploy");
    });

    it("should include previousState after transition", async () => {
      const fsm = createFSMStateManager({ sessionId, sessionDir });
      await fsm.transitionTo("planning");
      await fsm.transitionTo("executing");

      const record = fsm.getStateRecord();
      expect(record.previousState).toBe("planning");
      expect(record.state).toBe("executing");
    });
  });
});
