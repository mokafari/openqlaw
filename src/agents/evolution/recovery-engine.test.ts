import { describe, it, expect } from "vitest";
import type { ParsedError } from "./error-analyzer.js";
import { RecoveryEngine } from "./recovery-engine.js";

describe("RecoveryEngine", () => {
  const engine = new RecoveryEngine();

  it("should classify type errors as fixable", () => {
    const error: ParsedError = {
      file: "src/test.ts",
      line: 10,
      column: 5,
      message: "Argument of type 'string' is not assignable to parameter of type 'number'",
      code: "TS2345",
      context: "test context",
    };

    const decision = engine.shouldAttemptRecovery(error);

    expect(decision.fixable).toBe(true);
    expect(decision.strategy).toBe("spawn-agent");
    expect(decision.confidence).toBeGreaterThan(0);
  });

  it("should classify missing dependencies as auto-fixable", () => {
    const error: ParsedError = {
      file: "src/test.ts",
      line: 10,
      column: 5,
      message: "Cannot find module 'missing-package'",
      code: "TS2307",
      context: "test context",
    };

    const decision = engine.shouldAttemptRecovery(error);

    expect(decision.fixable).toBe(true);
    expect(decision.strategy).toBe("auto-fix");
  });

  it("should classify permission errors as not fixable", () => {
    const error: ParsedError = {
      file: "src/test.ts",
      line: 10,
      column: 5,
      message: "EACCES: permission denied, open 'file.ts'",
      code: "EACCES",
      context: "test context",
    };

    const decision = engine.shouldAttemptRecovery(error);

    expect(decision.fixable).toBe(false);
    expect(decision.strategy).toBe("escalate");
  });

  it("should classify syntax errors as fixable", () => {
    const error: ParsedError = {
      file: "src/test.ts",
      line: 10,
      column: 5,
      message: "Syntax error: unexpected token",
      code: "TS1005",
      context: "test context",
    };

    const decision = engine.shouldAttemptRecovery(error);

    expect(decision.fixable).toBe(true);
    expect(decision.strategy).toBe("spawn-agent");
  });
});
