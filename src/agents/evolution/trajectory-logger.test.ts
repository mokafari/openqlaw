/**
 * Trajectory Logger Tests
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  startTrajectory,
  logThought,
  logAction,
  logObservation,
  logReflection,
  reconstructTrajectory,
  inferThought,
  getActiveSessions,
  getSessionEvents,
  clearAllSessions,
} from "./trajectory-logger.js";

describe("trajectory-logger", () => {
  beforeEach(() => {
    clearAllSessions();
  });

  describe("startTrajectory", () => {
    it("starts tracking a new session", () => {
      startTrajectory("session-1", "run-1");
      const sessions = getActiveSessions();
      expect(sessions).toHaveLength(1);
      expect(sessions[0].sessionId).toBe("session-1");
      expect(sessions[0].runId).toBe("run-1");
    });
  });

  describe("logThought", () => {
    it("logs a thought before tool call", () => {
      startTrajectory("session-1", "run-1");
      logThought("session-1", "run-1", "Read", "Reading file to understand context", "tc-1");

      const events = getSessionEvents("session-1", "run-1");
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe("thought");
      expect(events[0].tool).toBe("Read");
      expect(events[0].content).toBe("Reading file to understand context");
    });

    it("auto-starts session if not tracking", () => {
      logThought("session-2", "run-2", "exec", "Running tests", "tc-2");
      const sessions = getActiveSessions();
      expect(sessions).toHaveLength(1);
    });
  });

  describe("logAction", () => {
    it("logs a tool action", () => {
      startTrajectory("session-1", "run-1");
      logAction("session-1", "run-1", "Read", "tc-1", { path: "/test/file.ts" }, "5 lines");

      const events = getSessionEvents("session-1", "run-1");
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe("action");
      expect(events[0].tool).toBe("Read");
      expect(events[0].content).toContain("Read");
      expect(events[0].content).toContain("5 lines");
    });
  });

  describe("logObservation", () => {
    it("logs a successful observation", () => {
      startTrajectory("session-1", "run-1");
      logObservation("session-1", "run-1", "Read", "tc-1", "File contents here", true, 50);

      const events = getSessionEvents("session-1", "run-1");
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe("observation");
      expect(events[0].success).toBe(true);
      expect(events[0].durationMs).toBe(50);
    });

    it("logs a failed observation", () => {
      startTrajectory("session-1", "run-1");
      logObservation("session-1", "run-1", "exec", "tc-1", "Command failed", false);

      const events = getSessionEvents("session-1", "run-1");
      expect(events[0].success).toBe(false);
    });
  });

  describe("logReflection", () => {
    it("logs a reflection", () => {
      startTrajectory("session-1", "run-1");
      logReflection("session-1", "run-1", "Should have checked file exists first");

      const events = getSessionEvents("session-1", "run-1");
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe("reflection");
    });
  });

  describe("reconstructTrajectory", () => {
    it("reconstructs a full ReAct chain", () => {
      startTrajectory("session-1", "run-1");

      // Step 1
      logThought("session-1", "run-1", "Read", "Need to read the config file", "tc-1");
      logAction("session-1", "run-1", "Read", "tc-1", { path: "/config.json" });
      logObservation("session-1", "run-1", "Read", "tc-1", '{"key": "value"}', true, 20);

      // Step 2
      logThought("session-1", "run-1", "Edit", "Now update the config", "tc-2");
      logAction("session-1", "run-1", "Edit", "tc-2", { path: "/config.json" });
      logObservation("session-1", "run-1", "Edit", "tc-2", "File updated", true, 30);

      const trajectory = reconstructTrajectory("session-1", "run-1");

      expect(trajectory).not.toBeNull();
      expect(trajectory!.steps).toHaveLength(2);
      expect(trajectory!.toolsUsed).toContain("Read");
      expect(trajectory!.toolsUsed).toContain("Edit");
      expect(trajectory!.successRate).toBe(1);

      // Check chain text format
      expect(trajectory!.chainText).toContain("[Step 1] Thought:");
      expect(trajectory!.chainText).toContain("[Step 1] Action:");
      expect(trajectory!.chainText).toContain("[Step 1] Observation:");
      expect(trajectory!.chainText).toContain("✓");
    });

    it("calculates success rate correctly", () => {
      startTrajectory("session-1", "run-1");

      logThought("session-1", "run-1", "exec", "Try command", "tc-1");
      logAction("session-1", "run-1", "exec", "tc-1", { command: "test" });
      logObservation("session-1", "run-1", "exec", "tc-1", "Failed", false);

      logThought("session-1", "run-1", "exec", "Retry with fix", "tc-2");
      logAction("session-1", "run-1", "exec", "tc-2", { command: "test --fix" });
      logObservation("session-1", "run-1", "exec", "tc-2", "Success", true);

      const trajectory = reconstructTrajectory("session-1", "run-1");

      expect(trajectory!.steps).toHaveLength(2);
      expect(trajectory!.successRate).toBe(0.5);
    });

    it("returns null for unknown session", () => {
      const trajectory = reconstructTrajectory("unknown", "unknown");
      expect(trajectory).toBeNull();
    });
  });

  describe("inferThought", () => {
    it("infers thought for Read tool", () => {
      const thought = inferThought("Read", { path: "/test/utils.ts" });
      expect(thought).toContain("Reading");
      expect(thought).toContain("utils.ts");
    });

    it("infers thought for exec tool", () => {
      const thought = inferThought("exec", { command: "npm test" });
      expect(thought).toContain("npm");
      expect(thought).toContain("run tests");
    });

    it("infers thought for web_search", () => {
      const thought = inferThought("web_search", { query: "how to use vitest" });
      expect(thought).toContain("Searching");
      expect(thought).toContain("how to use vitest");
    });

    it("returns generic thought for unknown tools", () => {
      const thought = inferThought("unknown_tool", {});
      expect(thought).toContain("unknown_tool");
      expect(thought).toContain("tool");
    });
  });
});
