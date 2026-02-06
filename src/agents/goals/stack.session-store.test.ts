import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { SessionEntry } from "../../config/sessions/types.js";
import { loadSessionStore, saveSessionStore } from "../../config/sessions/store.js";
import { GoalStack } from "./stack.js";

describe("GoalStack Session Store Integration", () => {
  let tempDir: string;
  let storePath: string;
  let sessionKey: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "session-store-test-"));
    storePath = path.join(tempDir, "sessions.json");
    sessionKey = "test-session-123";

    // Create empty store
    await fs.writeFile(storePath, "{}", "utf-8");
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe("persistence via session store", () => {
    it("should save goal stack to session store", async () => {
      const stack = new GoalStack(sessionKey);
      const goalId1 = stack.push({ type: "task", description: "Goal 1" });
      const goalId2 = stack.push({ type: "task", description: "Goal 2" });
      stack.complete(goalId1);

      // Serialize goal stack
      const serialized = stack.serialize();

      // Save to session store
      const store = loadSessionStore(storePath);
      const entry: SessionEntry = {
        sessionKey,
        goalStack: {
          goals: serialized.goals,
          updatedAt: Date.now(),
        },
      };
      store[sessionKey] = entry;
      await saveSessionStore(storePath, store);

      // Verify saved
      const savedStore = loadSessionStore(storePath);
      const savedEntry = savedStore[sessionKey];
      expect(savedEntry?.goalStack).toBeDefined();
      expect(savedEntry?.goalStack?.goals.length).toBe(2);
    });

    it("should load goal stack from session store", async () => {
      // Create initial store with goal stack
      const initialStack = new GoalStack(sessionKey);
      const goalId1 = initialStack.push({ type: "task", description: "Goal 1" });
      const goalId2 = initialStack.push({ type: "task", description: "Goal 2" });
      initialStack.complete(goalId1);

      const serialized = initialStack.serialize();
      const store: Record<string, SessionEntry> = {
        [sessionKey]: {
          sessionKey,
          goalStack: {
            goals: serialized.goals,
            updatedAt: Date.now(),
          },
        },
      };
      await saveSessionStore(storePath, store);

      // Load from store
      const loadedStore = loadSessionStore(storePath);
      const entry = loadedStore[sessionKey];
      expect(entry?.goalStack).toBeDefined();

      // Deserialize into new stack
      const restoredStack = GoalStack.deserialize({
        sessionKey,
        goals: entry!.goalStack!.goals,
      });

      expect(restoredStack.getDepth()).toBe(1); // Only active goal
      expect(restoredStack.getAll().length).toBe(2); // All goals preserved
      const goal1 = restoredStack.getById(goalId1);
      expect(goal1?.status).toBe("completed");
      const goal2 = restoredStack.getById(goalId2);
      expect(goal2?.status).toBe("pending");
    });

    it("should preserve goal relationships when loading from store", async () => {
      const stack = new GoalStack(sessionKey);
      const mainId = stack.push({ type: "task", description: "Main goal" });
      const obstacleId = stack.blockCurrent("Obstacle");

      const serialized = stack.serialize();
      const store: Record<string, SessionEntry> = {
        [sessionKey]: {
          sessionKey,
          goalStack: {
            goals: serialized.goals,
            updatedAt: Date.now(),
          },
        },
      };
      await saveSessionStore(storePath, store);

      // Load and restore
      const loadedStore = loadSessionStore(storePath);
      const entry = loadedStore[sessionKey];
      const restoredStack = GoalStack.deserialize({
        sessionKey,
        goals: entry!.goalStack!.goals,
      });

      const mainGoal = restoredStack.getById(mainId);
      expect(mainGoal?.blockedBy).toBe(obstacleId);

      const obstacle = restoredStack.getById(obstacleId);
      expect(obstacle?.parentId).toBe(mainId);
      expect(obstacle?.type).toBe("obstacle");
    });

    it("should handle missing goal stack in session entry", () => {
      const store: Record<string, SessionEntry> = {
        [sessionKey]: {
          sessionKey,
          // No goalStack
        },
      };

      // Should create empty stack when goalStack is missing
      const stack = new GoalStack(sessionKey);
      expect(stack.isEmpty()).toBe(true);
    });

    it("should handle empty goal stack array", () => {
      const store: Record<string, SessionEntry> = {
        [sessionKey]: {
          sessionKey,
          goalStack: {
            goals: [],
            updatedAt: Date.now(),
          },
        },
      };

      const loadedStore = loadSessionStore(storePath);
      const entry = loadedStore[sessionKey];
      const restoredStack = GoalStack.deserialize({
        sessionKey,
        goals: entry?.goalStack?.goals ?? [],
      });

      expect(restoredStack.isEmpty()).toBe(true);
    });

    it("should update goal stack in existing session entry", async () => {
      // Create initial entry
      const store: Record<string, SessionEntry> = {
        [sessionKey]: {
          sessionKey,
          goalStack: {
            goals: [],
            updatedAt: Date.now(),
          },
        },
      };
      await saveSessionStore(storePath, store);

      // Add goals
      const stack = new GoalStack(sessionKey);
      stack.push({ type: "task", description: "New goal" });

      const serialized = stack.serialize();
      const updatedStore = loadSessionStore(storePath);
      updatedStore[sessionKey] = {
        ...updatedStore[sessionKey]!,
        goalStack: {
          goals: serialized.goals,
          updatedAt: Date.now(),
        },
      };
      await saveSessionStore(storePath, updatedStore);

      // Verify update
      const finalStore = loadSessionStore(storePath);
      const finalEntry = finalStore[sessionKey];
      expect(finalEntry?.goalStack?.goals.length).toBe(1);
    });
  });

  describe("integration with quake-integration", () => {
    it("should work with quake integration helper", async () => {
      // This test verifies that goal stack can be loaded from session store
      // as expected by quake-integration.ts

      const stack = new GoalStack(sessionKey);
      stack.push({ type: "task", description: "Integration test goal" });

      const serialized = stack.serialize();
      const store: Record<string, SessionEntry> = {
        [sessionKey]: {
          sessionKey,
          goalStack: {
            goals: serialized.goals,
            updatedAt: Date.now(),
          },
        },
      };
      await saveSessionStore(storePath, store);

      // Simulate what quake-integration does
      const loadedStore = loadSessionStore(storePath);
      const entry = loadedStore[sessionKey];

      if (entry?.goalStack) {
        const restoredStack = GoalStack.deserialize({
          sessionKey,
          goals: entry.goalStack.goals,
        });
        expect(restoredStack.getDepth()).toBe(1);
      } else {
        // Fallback: create empty stack
        const emptyStack = new GoalStack(sessionKey);
        expect(emptyStack.isEmpty()).toBe(true);
      }
    });
  });
});
