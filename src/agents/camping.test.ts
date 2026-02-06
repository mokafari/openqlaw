import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { globalCampingManager, type CampingState } from "./camping.js";

describe("CampingManager", () => {
  beforeEach(() => {
    globalCampingManager.clear();
  });

  afterEach(() => {
    globalCampingManager.clear();
  });

  describe("enterCamping", () => {
    it("should create camping state", () => {
      const camping = globalCampingManager.enterCamping({
        sessionId: "session-123",
        waitingFor: "process",
        triggerId: "pid-456",
        resumeCondition: "process exit code 0",
        timeoutSeconds: 3600,
        metadata: { buildId: "build-789" },
      });

      expect(camping.sessionId).toBe("session-123");
      expect(camping.waitingFor).toBe("process");
      expect(camping.triggerId).toBe("pid-456");
      expect(camping.resumeCondition).toBe("process exit code 0");
      expect(camping.enteredAt).toBeGreaterThan(0);
      expect(camping.timeoutAt).toBeGreaterThan(camping.enteredAt);
      expect(camping.metadata?.buildId).toBe("build-789");
    });

    it("should create camping state without timeout", () => {
      const camping = globalCampingManager.enterCamping({
        sessionId: "session-123",
        waitingFor: "webhook",
        triggerId: "webhook-123",
        resumeCondition: "webhook received",
      });

      expect(camping.timeoutAt).toBeUndefined();
    });

    it("should calculate timeout correctly", () => {
      const before = Date.now();
      const camping = globalCampingManager.enterCamping({
        sessionId: "session-123",
        waitingFor: "process",
        triggerId: "pid-456",
        resumeCondition: "exit",
        timeoutSeconds: 60,
      });
      const after = Date.now();

      expect(camping.timeoutAt).toBeGreaterThanOrEqual(before + 60000);
      expect(camping.timeoutAt).toBeLessThanOrEqual(after + 60000);
    });
  });

  describe("isCamping", () => {
    it("should return true when session is camping", () => {
      globalCampingManager.enterCamping({
        sessionId: "session-123",
        waitingFor: "process",
        triggerId: "pid-456",
        resumeCondition: "exit",
      });

      expect(globalCampingManager.isCamping("session-123")).toBe(true);
    });

    it("should return false when session is not camping", () => {
      expect(globalCampingManager.isCamping("session-123")).toBe(false);
    });
  });

  describe("getCamping", () => {
    it("should return camping state when exists", () => {
      const camping = globalCampingManager.enterCamping({
        sessionId: "session-123",
        waitingFor: "process",
        triggerId: "pid-456",
        resumeCondition: "exit",
      });

      const retrieved = globalCampingManager.getCamping("session-123");
      expect(retrieved).toEqual(camping);
    });

    it("should return undefined when camping state does not exist", () => {
      const retrieved = globalCampingManager.getCamping("session-123");
      expect(retrieved).toBeUndefined();
    });
  });

  describe("exitCamping", () => {
    it("should remove camping state", () => {
      globalCampingManager.enterCamping({
        sessionId: "session-123",
        waitingFor: "process",
        triggerId: "pid-456",
        resumeCondition: "exit",
      });

      const exited = globalCampingManager.exitCamping("session-123");
      expect(exited).toBeDefined();
      expect(globalCampingManager.isCamping("session-123")).toBe(false);
    });

    it("should return undefined when no camping state exists", () => {
      const exited = globalCampingManager.exitCamping("session-123");
      expect(exited).toBeUndefined();
    });
  });

  describe("isTimedOut", () => {
    it("should return false when no timeout is set", () => {
      globalCampingManager.enterCamping({
        sessionId: "session-123",
        waitingFor: "process",
        triggerId: "pid-456",
        resumeCondition: "exit",
      });

      expect(globalCampingManager.isTimedOut("session-123")).toBe(false);
    });

    it("should return false when timeout has not been reached", () => {
      globalCampingManager.enterCamping({
        sessionId: "session-123",
        waitingFor: "process",
        triggerId: "pid-456",
        resumeCondition: "exit",
        timeoutSeconds: 3600, // 1 hour
      });

      expect(globalCampingManager.isTimedOut("session-123")).toBe(false);
    });

    it("should return true when timeout has been reached", async () => {
      globalCampingManager.enterCamping({
        sessionId: "session-123",
        waitingFor: "process",
        triggerId: "pid-456",
        resumeCondition: "exit",
        timeoutSeconds: 0.001, // Very short timeout (1ms)
      });

      // Wait for timeout to be reached
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(globalCampingManager.isTimedOut("session-123")).toBe(true);
    });
  });

  describe("getAllCamping", () => {
    it("should return all active camping states", () => {
      globalCampingManager.enterCamping({
        sessionId: "session-1",
        waitingFor: "process",
        triggerId: "pid-1",
        resumeCondition: "exit",
      });

      globalCampingManager.enterCamping({
        sessionId: "session-2",
        waitingFor: "webhook",
        triggerId: "webhook-1",
        resumeCondition: "received",
      });

      const all = globalCampingManager.getAllCamping();
      expect(all.length).toBe(2);
      expect(all.map((c) => c.sessionId)).toContain("session-1");
      expect(all.map((c) => c.sessionId)).toContain("session-2");
    });

    it("should return empty array when no camping states", () => {
      const all = globalCampingManager.getAllCamping();
      expect(all).toEqual([]);
    });
  });

  describe("restoreCamping", () => {
    it("should restore camping state from persisted data", () => {
      const campingState: CampingState = {
        sessionId: "session-123",
        waitingFor: "process",
        triggerId: "pid-456",
        resumeCondition: "exit",
        enteredAt: Date.now() - 1000,
        timeoutAt: Date.now() + 3600000,
        metadata: { buildId: "build-789" },
      };

      globalCampingManager.restoreCamping(campingState);

      expect(globalCampingManager.isCamping("session-123")).toBe(true);
      const retrieved = globalCampingManager.getCamping("session-123");
      expect(retrieved).toEqual(campingState);
    });
  });

  describe("clear", () => {
    it("should clear all camping states", () => {
      globalCampingManager.enterCamping({
        sessionId: "session-1",
        waitingFor: "process",
        triggerId: "pid-1",
        resumeCondition: "exit",
      });

      globalCampingManager.enterCamping({
        sessionId: "session-2",
        waitingFor: "webhook",
        triggerId: "webhook-1",
        resumeCondition: "received",
      });

      globalCampingManager.clear();

      expect(globalCampingManager.getAllCamping().length).toBe(0);
      expect(globalCampingManager.isCamping("session-1")).toBe(false);
      expect(globalCampingManager.isCamping("session-2")).toBe(false);
    });
  });
});
