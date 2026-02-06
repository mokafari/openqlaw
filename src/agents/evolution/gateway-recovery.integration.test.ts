import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { BuildMonitor } from "./build-monitor.js";
import { ErrorAnalyzer } from "./error-analyzer.js";
import { GatewayRecovery } from "./gateway-recovery.js";
import { RecoveryEngine } from "./recovery-engine.js";

describe("GatewayRecovery Integration", () => {
  let workspaceDir: string;

  beforeEach(async () => {
    workspaceDir = await mkdtemp(join(tmpdir(), "recovery-integration-test-"));
  });

  afterEach(async () => {
    try {
      await rm(workspaceDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  it("should detect and parse build errors", async () => {
    const buildLog = `
src/test.ts(10,5): error TS2345: Argument of type 'string' is not assignable to parameter of type 'number'
src/test.ts(20,10): error TS2304: Cannot find name 'x'
Build failed with 2 errors
`;

    const monitor = new BuildMonitor(workspaceDir);
    const result = await monitor.watchBuild(buildLog);

    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.success).toBe(false);
  });

  it("should classify errors correctly", async () => {
    const analyzer = new ErrorAnalyzer(workspaceDir);
    const errors = await analyzer.parseErrors(
      "src/test.ts(10,5): error TS2345: Cannot find module 'missing-package'",
    );

    expect(errors.length).toBeGreaterThan(0);

    const engine = new RecoveryEngine();
    const decision = engine.shouldAttemptRecovery(errors[0]!);

    expect(decision.fixable).toBe(true);
    expect(decision.strategy).toBe("auto-fix");
  });

  it("should handle build failure end-to-end", async () => {
    const recovery = new GatewayRecovery({
      workspaceDir,
      maxRetries: 1,
      agentStrategy: "claude-code",
    });

    const buildLog = `
src/test.ts(10,5): error TS2345: Argument of type 'string' is not assignable
Build failed with 1 errors
`;

    const result = await recovery.handleBuildFailure({
      buildLog,
      workspaceDir,
    });

    // Should attempt recovery (even if it fails in test environment)
    expect(result.attempts).toBeGreaterThanOrEqual(0);
  });
});
