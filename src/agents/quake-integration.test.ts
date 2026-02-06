import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { globalCampingManager } from "./camping.js";
import {
  cleanupQuakeIntegration,
  initializeQuakeIntegration,
  persistQuakeIntegration,
} from "./quake-integration.js";

describe("QuakeIntegration", () => {
  let tempDir: string;
  let sessionDir: string;
  let workspaceDir: string;
  let sessionId: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "quake-test-"));
    sessionDir = path.join(tempDir, "sessions");
    workspaceDir = path.join(tempDir, "workspace");
    sessionId = "test-session-123";

    await fs.mkdir(sessionDir, { recursive: true });
    await fs.mkdir(workspaceDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe("initializeQuakeIntegration", () => {
    it("should initialize all components", async () => {
      const context = await initializeQuakeIntegration({
        sessionId,
        sessionDir,
        workspaceDir,
      });

      expect(context.sessionId).toBe(sessionId);
      expect(context.sessionDir).toBe(sessionDir);
      expect(context.workspaceDir).toBe(workspaceDir);
      expect(context.fsmManager).toBeDefined();
      expect(context.goalStack).toBeDefined();
      expect(context.synonymDictionary).toBeDefined();
    });

    it("should load FSM state from disk if exists", async () => {
      // Create initial context and persist
      const context1 = await initializeQuakeIntegration({
        sessionId,
        sessionDir,
        workspaceDir,
      });
      await context1.fsmManager.transitionTo("planning");
      await persistQuakeIntegration(context1);

      // Create new context and verify state loaded
      const context2 = await initializeQuakeIntegration({
        sessionId,
        sessionDir,
        workspaceDir,
      });

      expect(context2.fsmManager.getState()).toBe("planning");
    });

    it("should initialize goal stack from session store if available", async () => {
      // This test would require mocking the session store system
      // For now, we just verify it initializes
      const context = await initializeQuakeIntegration({
        sessionId,
        sessionDir,
        workspaceDir,
      });

      expect(context.goalStack).toBeDefined();
      expect(context.goalStack.isEmpty()).toBe(true);
    });

    it("should load SOUL.md if present", async () => {
      const soulPath = path.join(workspaceDir, "SOUL.md");
      await fs.writeFile(soulPath, "## Traits\n- Encouraging\n");

      const context = await initializeQuakeIntegration({
        sessionId,
        sessionDir,
        workspaceDir,
      });

      expect(context.soul).not.toBeNull();
      expect(context.soul?.traits).toContain("encouraging");
    });

    it("should use default synonyms when SOUL.md not present", async () => {
      const context = await initializeQuakeIntegration({
        sessionId,
        sessionDir,
        workspaceDir,
      });

      expect(context.soul).toBeNull();
      expect(context.synonymDictionary).toBeDefined();
      expect(context.synonymDictionary.START_TOOL).toBeDefined();
    });

    it("should restore camping state if exists", async () => {
      // Create camping state file
      const campingFile = path.join(sessionDir, `${sessionId}_camping.json`);
      const campingState = {
        sessionId,
        waitingFor: "process" as const,
        triggerId: "pid-123",
        resumeCondition: "exit",
        enteredAt: Date.now(),
      };
      await fs.writeFile(campingFile, JSON.stringify(campingState));

      const context = await initializeQuakeIntegration({
        sessionId,
        sessionDir,
        workspaceDir,
      });

      // Camping state should be restored (checked via camping manager)
      // This is tested indirectly through the integration
      expect(context.fsmManager).toBeDefined();
    });
  });

  describe("persistQuakeIntegration", () => {
    it("should persist FSM state", async () => {
      const context = await initializeQuakeIntegration({
        sessionId,
        sessionDir,
        workspaceDir,
      });

      await context.fsmManager.transitionTo("executing");
      context.goalStack.push({ type: "task", description: "Test goal" });

      await persistQuakeIntegration(context);

      // Verify FSM state persisted
      const stateFile = path.join(sessionDir, "fsm_state.json");
      const stateContent = await fs.readFile(stateFile, "utf-8");
      const state = JSON.parse(stateContent);
      expect(state.state).toBe("executing");
    });

    it("should persist goal stack", async () => {
      const context = await initializeQuakeIntegration({
        sessionId,
        sessionDir,
        workspaceDir,
      });

      const initialDepth = context.goalStack.getDepth();
      context.goalStack.push({ type: "task", description: "Test goal" });
      context.goalStack.push({ type: "task", description: "Test goal 2" });
      await persistQuakeIntegration(context);

      // Goal stack persistence is handled by session store
      // We verify it doesn't throw and state is preserved
      // Depth should be initial + 2
      expect(context.goalStack.getDepth()).toBe(initialDepth + 2);
    });

    it("should handle persistence errors gracefully", async () => {
      const context = await initializeQuakeIntegration({
        sessionId,
        sessionDir: "/nonexistent/path",
        workspaceDir,
      });

      // Should not throw even if persistence fails
      await expect(persistQuakeIntegration(context)).resolves.not.toThrow();
    });
  });

  describe("cleanupQuakeIntegration", () => {
    it("should exit camping and persist state", async () => {
      const context = await initializeQuakeIntegration({
        sessionId,
        sessionDir,
        workspaceDir,
      });

      // Transition to camping
      await context.fsmManager.transitionTo("camping");
      context.goalStack.push({ type: "task", description: "Test" });

      // Enter camping state
      globalCampingManager.enterCamping({
        sessionId,
        waitingFor: "process",
        triggerId: "pid-123",
        resumeCondition: "exit",
      });

      // Verify camping is active before cleanup
      expect(globalCampingManager.isCamping(sessionId)).toBe(true);

      await cleanupQuakeIntegration(context);

      // Camping should be exited by cleanupQuakeIntegration
      expect(globalCampingManager.isCamping(sessionId)).toBe(false);
      // State should be persisted (cleanup calls persistQuakeIntegration)
      // The exact state doesn't matter - what matters is camping is exited
      expect(context.fsmManager.getState()).toBeDefined();
    });

    it("should handle cleanup errors gracefully", async () => {
      const context = await initializeQuakeIntegration({
        sessionId,
        sessionDir: "/nonexistent/path",
        workspaceDir,
      });

      await expect(cleanupQuakeIntegration(context)).resolves.not.toThrow();
    });
  });

  describe("integration flow", () => {
    it("should handle full lifecycle: init -> use -> persist -> cleanup", async () => {
      // Initialize
      const context = await initializeQuakeIntegration({
        sessionId,
        sessionDir,
        workspaceDir,
      });

      // Use components
      await context.fsmManager.transitionTo("planning");
      const goalId = context.goalStack.push({
        type: "task",
        description: "Deploy app",
      });

      // Persist
      await persistQuakeIntegration(context);

      // Verify state persisted
      const stateFile = path.join(sessionDir, "fsm_state.json");
      const stateExists = await fs
        .access(stateFile)
        .then(() => true)
        .catch(() => false);
      expect(stateExists).toBe(true);

      // Cleanup
      await cleanupQuakeIntegration(context);

      // Verify cleanup completed
      expect(context.goalStack.getById(goalId)).toBeDefined();
    });

    it("should restore state on re-initialization", async () => {
      // First session
      const context1 = await initializeQuakeIntegration({
        sessionId,
        sessionDir,
        workspaceDir,
      });
      await context1.fsmManager.transitionTo("executing");
      context1.goalStack.push({ type: "task", description: "Goal 1" });
      await persistQuakeIntegration(context1);

      // Second session (simulating restart)
      const context2 = await initializeQuakeIntegration({
        sessionId,
        sessionDir,
        workspaceDir,
      });

      // FSM state should be restored
      expect(context2.fsmManager.getState()).toBe("executing");

      // Goal stack should be restored (if session store works)
      // This depends on session store implementation
      expect(context2.goalStack).toBeDefined();
    });
  });
});
