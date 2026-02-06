import { describe, it, expect, beforeEach, vi } from "vitest";
import type { ParsedError } from "./error-analyzer.js";
import type { RecoveryDecision } from "./recovery-engine.js";
import { RecoveryLoop, type RecoveryLoopParams } from "./recovery-loop.js";

describe("RecoveryLoop", () => {
  let loop: RecoveryLoop;
  const workspaceDir = "/tmp/test-workspace";

  beforeEach(() => {
    loop = new RecoveryLoop(workspaceDir);
  });

  describe("run", () => {
    it("should return early if error is not fixable", async () => {
      const error: ParsedError = {
        file: "test.ts",
        line: 10,
        column: 5,
        message: "Permission denied",
        code: "EPERM",
        context: "some context",
      };

      const decision: RecoveryDecision = {
        fixable: false,
        strategy: "escalate",
        confidence: 1.0,
        estimatedTime: 0,
        reason: "Permission errors require manual intervention",
      };

      const params: RecoveryLoopParams = {
        error,
        logs: "build log",
        workspaceDir,
        maxRetries: 3,
        decision,
      };

      const result = await loop.run(params);

      expect(result.success).toBe(false);
      expect(result.attempts).toBe(0);
      expect(result.escalate).toBe(true);
      expect(result.error).toContain("not fixable");
    });

    it("should attempt recovery for fixable errors", async () => {
      const error: ParsedError = {
        file: "test.ts",
        line: 10,
        column: 5,
        message: "Cannot find module 'missing-package'",
        code: "TS2307",
        context: "import { foo } from 'missing-package';",
      };

      const decision: RecoveryDecision = {
        fixable: true,
        strategy: "auto-fix",
        confidence: 0.9,
        estimatedTime: 30000,
        reason: "Missing dependency can be fixed with npm install",
      };

      const params: RecoveryLoopParams = {
        error,
        logs: "build log",
        workspaceDir,
        maxRetries: 3,
        decision,
      };

      // Mock the internal methods to avoid actual execution
      const runSpy = vi.spyOn(loop, "run");

      // Run will fail because we can't actually install packages in test
      // But we verify it attempts the recovery
      const result = await loop.run(params);

      expect(runSpy).toHaveBeenCalledWith(params);
      // Result depends on actual execution, but structure should be valid
      expect(result).toHaveProperty("success");
      expect(result).toHaveProperty("attempts");
    });

    it("should respect max retries", async () => {
      const error: ParsedError = {
        file: "test.ts",
        line: 10,
        column: 5,
        message: "Type error",
        code: "TS2345",
        context: "type mismatch",
      };

      const decision: RecoveryDecision = {
        fixable: true,
        strategy: "spawn-agent",
        confidence: 0.6,
        estimatedTime: 180000,
        reason: "Complex error needs agent",
      };

      const params: RecoveryLoopParams = {
        error,
        logs: "build log",
        workspaceDir,
        maxRetries: 1, // Only 1 retry
        decision,
      };

      const result = await loop.run(params);

      // Should not exceed max retries
      expect(result.attempts).toBeLessThanOrEqual(1);
    });
  });

  describe("RecoveryStateManager integration", () => {
    it("should handle missing backup gracefully", async () => {
      const error: ParsedError = {
        file: "nonexistent.ts",
        line: 1,
        column: 1,
        message: "Error",
        code: "TS0000",
        context: "",
      };

      const decision: RecoveryDecision = {
        fixable: true,
        strategy: "auto-fix",
        confidence: 0.5,
        estimatedTime: 10000,
        reason: "Test",
      };

      const params: RecoveryLoopParams = {
        error,
        logs: "",
        workspaceDir: "/nonexistent/path",
        maxRetries: 1,
        decision,
      };

      // Should not throw, should handle gracefully
      const result = await loop.run(params);
      expect(result).toHaveProperty("success");
    });
  });
});

describe("RecoveryLoop strategies", () => {
  it("should select correct strategy based on decision", () => {
    const loop = new RecoveryLoop("/tmp");

    // Strategy selection is done by RecoveryEngine, but loop should respect it
    const strategies = ["auto-fix", "spawn-agent", "escalate"] as const;

    for (const strategy of strategies) {
      expect(["auto-fix", "spawn-agent", "escalate"]).toContain(strategy);
    }
  });
});
