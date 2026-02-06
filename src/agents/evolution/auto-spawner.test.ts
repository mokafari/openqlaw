import { describe, it, expect } from "vitest";
import type { ParsedError } from "./error-analyzer.js";
import { AutoSpawner, type SpawnCodingAgentParams } from "./auto-spawner.js";

describe("AutoSpawner", () => {
  const spawner = new AutoSpawner();

  const mockError: ParsedError = {
    file: "src/test.ts",
    line: 42,
    column: 10,
    message: "Type 'string' is not assignable to type 'number'",
    code: "TS2322",
    context: "const x: number = 'hello';",
  };

  const mockLogs = "Building...\nError: Type mismatch\nBuild failed";

  describe("spawnCodingAgent", () => {
    it("should return sessions-spawn method for sessions-spawn strategy", async () => {
      const params: SpawnCodingAgentParams = {
        error: mockError,
        logs: mockLogs,
        workspaceDir: "/test/workspace",
        strategy: "sessions-spawn",
      };

      const result = await spawner.spawnCodingAgent(params);

      expect(result.method).toBe("sessions-spawn");
      expect(result.task).toBeDefined();
      expect(result.task).toContain("TS2322");
      expect(result.task).toContain("src/test.ts");
    });

    it("should return shell method for gemini strategy", async () => {
      const params: SpawnCodingAgentParams = {
        error: mockError,
        logs: mockLogs,
        workspaceDir: "/test/workspace",
        strategy: "gemini",
      };

      const result = await spawner.spawnCodingAgent(params);

      expect(result.method).toBe("shell");
      expect(result.command).toContain("gemini");
      expect(result.command).toContain("/test/workspace");
    });

    it("should return shell method for claude-code strategy", async () => {
      const params: SpawnCodingAgentParams = {
        error: mockError,
        logs: mockLogs,
        workspaceDir: "/test/workspace",
        strategy: "claude-code",
      };

      const result = await spawner.spawnCodingAgent(params);

      expect(result.method).toBe("shell");
      expect(result.command).toContain("claude");
    });

    it("should generate unique session IDs", async () => {
      const params: SpawnCodingAgentParams = {
        error: mockError,
        logs: mockLogs,
        workspaceDir: "/test/workspace",
        strategy: "sessions-spawn",
      };

      const result1 = await spawner.spawnCodingAgent(params);
      const result2 = await spawner.spawnCodingAgent(params);

      expect(result1.sessionId).not.toBe(result2.sessionId);
    });
  });

  describe("buildRecoveryTask", () => {
    it("should include error details in task", () => {
      const task = spawner.buildRecoveryTask(mockError, mockLogs, "/test/workspace");

      expect(task).toContain("TS2322");
      expect(task).toContain("src/test.ts:42:10");
      expect(task).toContain("Type 'string' is not assignable to type 'number'");
      expect(task).toContain("const x: number = 'hello';");
    });

    it("should include build log in task", () => {
      const task = spawner.buildRecoveryTask(mockError, mockLogs, "/test/workspace");

      expect(task).toContain("Build failed");
    });

    it("should include workspace directory in verify command", () => {
      const task = spawner.buildRecoveryTask(mockError, mockLogs, "/custom/path");

      expect(task).toContain("/custom/path");
      expect(task).toContain("pnpm build");
    });
  });

  describe("getSessionsSpawnParams", () => {
    it("should return correct default parameters", () => {
      const params = spawner.getSessionsSpawnParams("Test task");

      expect(params.task).toBe("Test task");
      expect(params.runTimeoutSeconds).toBe(300);
      expect(params.cleanup).toBe("keep");
    });

    it("should allow custom timeout", () => {
      const params = spawner.getSessionsSpawnParams("Test task", {
        timeoutSeconds: 600,
      });

      expect(params.runTimeoutSeconds).toBe(600);
    });

    it("should allow custom label", () => {
      const params = spawner.getSessionsSpawnParams("Test task", {
        label: "custom-recovery",
      });

      expect(params.label).toBe("custom-recovery");
    });
  });

  describe("generateSessionId", () => {
    it("should generate unique IDs", () => {
      const id1 = spawner.generateSessionId();
      const id2 = spawner.generateSessionId();

      expect(id1).not.toBe(id2);
      expect(id1).toMatch(/^recovery-\d+-[a-f0-9]+$/);
    });
  });
});
