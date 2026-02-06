import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { CampingState } from "./camping.js";
import { deleteCampingState, loadCampingState, saveCampingState } from "./camping.store.js";

describe("CampingStore", () => {
  let tempDir: string;
  let sessionDir: string;
  let sessionId: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "quake-test-"));
    sessionDir = path.join(tempDir, "sessions");
    sessionId = "test-session-123";

    await fs.mkdir(sessionDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe("saveCampingState", () => {
    it("should save camping state to disk", async () => {
      const campingState: CampingState = {
        sessionId,
        waitingFor: "process",
        triggerId: "pid-456",
        resumeCondition: "exit",
        enteredAt: Date.now(),
        timeoutAt: Date.now() + 3600000,
        metadata: { buildId: "build-789" },
      };

      await saveCampingState(campingState, sessionDir, sessionId);

      const campingFile = path.join(sessionDir, `${sessionId}_camping.json`);
      const content = await fs.readFile(campingFile, "utf-8");
      const saved = JSON.parse(content);

      expect(saved.sessionId).toBe(sessionId);
      expect(saved.waitingFor).toBe("process");
      expect(saved.triggerId).toBe("pid-456");
      expect(saved.metadata?.buildId).toBe("build-789");
    });

    it("should delete file when state is null", async () => {
      // Create a file first
      const campingFile = path.join(sessionDir, `${sessionId}_camping.json`);
      await fs.writeFile(campingFile, "{}");

      await saveCampingState(null, sessionDir, sessionId);

      const exists = await fs
        .access(campingFile)
        .then(() => true)
        .catch(() => false);
      expect(exists).toBe(false);
    });

    it("should create directory if it doesn't exist", async () => {
      const newSessionDir = path.join(tempDir, "new-sessions");
      const campingState: CampingState = {
        sessionId,
        waitingFor: "process",
        triggerId: "pid-456",
        resumeCondition: "exit",
        enteredAt: Date.now(),
      };

      await saveCampingState(campingState, newSessionDir, sessionId);

      const campingFile = path.join(newSessionDir, `${sessionId}_camping.json`);
      const exists = await fs
        .access(campingFile)
        .then(() => true)
        .catch(() => false);
      expect(exists).toBe(true);
    });
  });

  describe("loadCampingState", () => {
    it("should load camping state from disk", async () => {
      const campingState: CampingState = {
        sessionId,
        waitingFor: "webhook",
        triggerId: "webhook-123",
        resumeCondition: "received",
        enteredAt: Date.now(),
      };

      await saveCampingState(campingState, sessionDir, sessionId);

      const loaded = await loadCampingState(sessionDir, sessionId);
      expect(loaded).not.toBeNull();
      expect(loaded?.sessionId).toBe(sessionId);
      expect(loaded?.waitingFor).toBe("webhook");
      expect(loaded?.triggerId).toBe("webhook-123");
    });

    it("should return null when file does not exist", async () => {
      const loaded = await loadCampingState(sessionDir, sessionId);
      expect(loaded).toBeNull();
    });

    it("should return null for invalid state file", async () => {
      const campingFile = path.join(sessionDir, `${sessionId}_camping.json`);
      await fs.writeFile(campingFile, "invalid json");

      const loaded = await loadCampingState(sessionDir, sessionId);
      expect(loaded).toBeNull();
    });

    it("should return null for incomplete state", async () => {
      const campingFile = path.join(sessionDir, `${sessionId}_camping.json`);
      await fs.writeFile(campingFile, JSON.stringify({ sessionId: "test" }));

      const loaded = await loadCampingState(sessionDir, sessionId);
      expect(loaded).toBeNull();
    });
  });

  describe("deleteCampingState", () => {
    it("should delete camping state file", async () => {
      const campingFile = path.join(sessionDir, `${sessionId}_camping.json`);
      await fs.writeFile(campingFile, "{}");

      await deleteCampingState(sessionDir, sessionId);

      const exists = await fs
        .access(campingFile)
        .then(() => true)
        .catch(() => false);
      expect(exists).toBe(false);
    });

    it("should not throw when file does not exist", async () => {
      await expect(deleteCampingState(sessionDir, sessionId)).resolves.not.toThrow();
    });
  });
});
