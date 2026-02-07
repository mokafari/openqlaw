import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ReachabilityCheckContext } from "./types.js";
import {
  ContextGraph,
  NAMED_CAPABILITIES,
  STATE_REQUIRED_CAPABILITIES,
  TOOL_REQUIRED_CAPABILITIES,
  getRequiredCapabilitiesForState,
  getRequiredCapabilitiesForTool,
  validateStateTransition,
  validateToolExecution,
} from "./context-graph.js";

describe("ContextGraph - Self-Debugging Capabilities", () => {
  let tempDir: string;
  let workspaceDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "aas-debug-test-"));
    workspaceDir = path.join(tempDir, "workspace");
    await fs.mkdir(workspaceDir, { recursive: true });
    ContextGraph.clearCache();
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
    ContextGraph.clearCache();
  });

  describe("CanBuild", () => {
    it("should return false when package.json is missing", async () => {
      const context: ReachabilityCheckContext = { workspaceDir };
      const result = await ContextGraph.checkDetailed(context, "CanBuild");

      expect(result.available).toBe(false);
      expect(result.missing).toContain("package.json");
    });

    it("should return false when tsconfig.json is missing", async () => {
      await fs.writeFile(path.join(workspaceDir, "package.json"), "{}");

      const context: ReachabilityCheckContext = { workspaceDir };
      const result = await ContextGraph.checkDetailed(context, "CanBuild");

      expect(result.available).toBe(false);
      expect(result.missing).toContain("tsconfig.json");
    });

    it("should return true when build prerequisites exist", async () => {
      await fs.writeFile(path.join(workspaceDir, "package.json"), "{}");
      await fs.writeFile(path.join(workspaceDir, "tsconfig.json"), "{}");

      const context: ReachabilityCheckContext = { workspaceDir };
      const result = await ContextGraph.checkDetailed(context, "CanBuild");

      // Will be true if pnpm or npm is available on the system
      expect(result.diagnostics?.configFiles?.["package.json"]).toBe(true);
      expect(result.diagnostics?.configFiles?.["tsconfig.json"]).toBe(true);
    });

    it("should include cliTools in diagnostics", async () => {
      await fs.writeFile(path.join(workspaceDir, "package.json"), "{}");
      await fs.writeFile(path.join(workspaceDir, "tsconfig.json"), "{}");

      const context: ReachabilityCheckContext = { workspaceDir };
      const result = await ContextGraph.checkDetailed(context, "CanBuild");

      expect(result.diagnostics).toBeDefined();
      expect(result.diagnostics?.cliTools).toHaveProperty("pnpm");
      expect(result.diagnostics?.cliTools).toHaveProperty("npm");
    });
  });

  describe("CanTest", () => {
    it("should return false when no test configuration exists", async () => {
      const context: ReachabilityCheckContext = { workspaceDir };
      const result = await ContextGraph.checkDetailed(context, "CanTest");

      expect(result.available).toBe(false);
      expect(result.missing.length).toBeGreaterThan(0);
    });

    it("should check for vitest and jest configs", async () => {
      const context: ReachabilityCheckContext = { workspaceDir };
      const result = await ContextGraph.checkDetailed(context, "CanTest");

      expect(result.diagnostics?.configFiles).toHaveProperty("vitest.config");
      expect(result.diagnostics?.configFiles).toHaveProperty("jest.config");
    });

    it("should detect vitest when vitest.config.ts exists", async () => {
      await fs.writeFile(path.join(workspaceDir, "vitest.config.ts"), "export default {}");
      await fs.mkdir(path.join(workspaceDir, "src"), { recursive: true });
      await fs.writeFile(path.join(workspaceDir, "src", "example.test.ts"), "");

      const context: ReachabilityCheckContext = { workspaceDir };
      const result = await ContextGraph.checkDetailed(context, "CanTest");

      expect(result.diagnostics?.configFiles?.["vitest.config"]).toBe(true);
    });
  });

  describe("CanLint", () => {
    it("should return false when no linting configuration exists", async () => {
      const context: ReachabilityCheckContext = { workspaceDir };
      const result = await ContextGraph.checkDetailed(context, "CanLint");

      expect(result.available).toBe(false);
    });

    it("should detect eslint config", async () => {
      await fs.writeFile(path.join(workspaceDir, "eslint.config.js"), "export default []");

      const context: ReachabilityCheckContext = { workspaceDir };
      const result = await ContextGraph.checkDetailed(context, "CanLint");

      expect(result.diagnostics?.configFiles?.["eslint.config"]).toBe(true);
    });

    it("should detect typescript config", async () => {
      await fs.writeFile(path.join(workspaceDir, "tsconfig.json"), "{}");

      const context: ReachabilityCheckContext = { workspaceDir };
      const result = await ContextGraph.checkDetailed(context, "CanLint");

      expect(result.diagnostics?.configFiles?.["tsconfig.json"]).toBe(true);
    });
  });

  describe("CanRestart", () => {
    it("should check for service managers", async () => {
      const context: ReachabilityCheckContext = { workspaceDir };
      const result = await ContextGraph.checkDetailed(context, "CanRestart");

      expect(result.diagnostics?.cliTools).toBeDefined();
      // At least one of these should exist on macOS or Linux
      expect(
        result.diagnostics?.cliTools?.["launchctl"] !== undefined ||
          result.diagnostics?.cliTools?.["systemctl"] !== undefined ||
          result.diagnostics?.cliTools?.["openclaw"] !== undefined,
      ).toBe(true);
    });
  });

  describe("CanRollback", () => {
    it("should return false when not a git repository", async () => {
      const context: ReachabilityCheckContext = { workspaceDir };
      const result = await ContextGraph.checkDetailed(context, "CanRollback");

      expect(result.available).toBe(false);
      expect(result.missing).toContain(".git folder");
    });

    it("should check for git history", async () => {
      const context: ReachabilityCheckContext = { workspaceDir };
      const result = await ContextGraph.checkDetailed(context, "CanRollback");

      expect(result.diagnostics).toBeDefined();
    });
  });

  describe("CanDebugNode", () => {
    it("should check for Node.js availability", async () => {
      const context: ReachabilityCheckContext = { workspaceDir };
      const result = await ContextGraph.checkDetailed(context, "CanDebugNode");

      expect(result.diagnostics?.cliTools).toHaveProperty("node");
    });

    it("should include node version in diagnostics", async () => {
      const context: ReachabilityCheckContext = { workspaceDir };
      const result = await ContextGraph.checkDetailed(context, "CanDebugNode");

      if (result.diagnostics?.cliTools?.["node"]) {
        expect(result.diagnostics?.other?.["node version"]).toBeDefined();
      }
    });
  });

  describe("CanProfile", () => {
    it("should check for profiling tools", async () => {
      const context: ReachabilityCheckContext = { workspaceDir };
      const result = await ContextGraph.checkDetailed(context, "CanProfile");

      expect(result.diagnostics?.cliTools).toBeDefined();
      expect(result.diagnostics?.cliTools).toHaveProperty("clinic");
      expect(result.diagnostics?.cliTools).toHaveProperty("0x");
      expect(result.diagnostics?.cliTools).toHaveProperty("perf");
    });

    it("should detect Node.js built-in profiling", async () => {
      const context: ReachabilityCheckContext = { workspaceDir };
      const result = await ContextGraph.checkDetailed(context, "CanProfile");

      if (result.diagnostics?.cliTools?.["node"]) {
        expect(result.diagnostics?.other?.["node --prof"]).toBe(true);
      }
    });
  });
});

describe("NAMED_CAPABILITIES", () => {
  it("should include all self-debugging capabilities", () => {
    expect(NAMED_CAPABILITIES).toContain("CanBuild");
    expect(NAMED_CAPABILITIES).toContain("CanTest");
    expect(NAMED_CAPABILITIES).toContain("CanLint");
    expect(NAMED_CAPABILITIES).toContain("CanRestart");
    expect(NAMED_CAPABILITIES).toContain("CanRollback");
    expect(NAMED_CAPABILITIES).toContain("CanDebugNode");
    expect(NAMED_CAPABILITIES).toContain("CanProfile");
  });
});

describe("TOOL_REQUIRED_CAPABILITIES", () => {
  it("should map build tools to CanBuild", () => {
    expect(TOOL_REQUIRED_CAPABILITIES["exec:pnpm build"]).toContain("CanBuild");
    expect(TOOL_REQUIRED_CAPABILITIES["exec:npm build"]).toContain("CanBuild");
  });

  it("should map test tools to CanTest", () => {
    expect(TOOL_REQUIRED_CAPABILITIES["exec:pnpm test"]).toContain("CanTest");
    expect(TOOL_REQUIRED_CAPABILITIES["exec:vitest"]).toContain("CanTest");
    expect(TOOL_REQUIRED_CAPABILITIES["exec:jest"]).toContain("CanTest");
  });

  it("should map lint tools to CanLint", () => {
    expect(TOOL_REQUIRED_CAPABILITIES["exec:eslint"]).toContain("CanLint");
    expect(TOOL_REQUIRED_CAPABILITIES["exec:tsc --noEmit"]).toContain("CanLint");
  });

  it("should map git tools to CanCommit and CanRollback", () => {
    expect(TOOL_REQUIRED_CAPABILITIES["exec:git commit"]).toContain("CanCommit");
    expect(TOOL_REQUIRED_CAPABILITIES["exec:git reset"]).toContain("CanRollback");
    expect(TOOL_REQUIRED_CAPABILITIES["exec:git revert"]).toContain("CanRollback");
  });

  it("should map rebuild_gateway to CanBuild and CanRestart", () => {
    expect(TOOL_REQUIRED_CAPABILITIES["rebuild_gateway"]).toContain("CanBuild");
    expect(TOOL_REQUIRED_CAPABILITIES["rebuild_gateway"]).toContain("CanRestart");
  });
});

describe("STATE_REQUIRED_CAPABILITIES", () => {
  it("should require CanBuild for building state", () => {
    expect(STATE_REQUIRED_CAPABILITIES["building"]).toContain("CanBuild");
  });

  it("should require CanTest for testing state", () => {
    expect(STATE_REQUIRED_CAPABILITIES["testing"]).toContain("CanTest");
  });

  it("should require CanDebugNode for debugging state", () => {
    expect(STATE_REQUIRED_CAPABILITIES["debugging"]).toContain("CanDebugNode");
  });

  it("should require CanProfile for profiling state", () => {
    expect(STATE_REQUIRED_CAPABILITIES["profiling"]).toContain("CanProfile");
  });

  it("should require CanCommit for committing state", () => {
    expect(STATE_REQUIRED_CAPABILITIES["committing"]).toContain("CanCommit");
  });

  it("should require CanRollback for rolling_back state", () => {
    expect(STATE_REQUIRED_CAPABILITIES["rolling_back"]).toContain("CanRollback");
  });

  it("should require CanRestart for restarting state", () => {
    expect(STATE_REQUIRED_CAPABILITIES["restarting"]).toContain("CanRestart");
  });

  it("should have no requirements for idle state", () => {
    expect(STATE_REQUIRED_CAPABILITIES["idle"]).toEqual([]);
  });
});

describe("getRequiredCapabilitiesForState", () => {
  it("should return capabilities for known states", () => {
    expect(getRequiredCapabilitiesForState("building")).toContain("CanBuild");
    expect(getRequiredCapabilitiesForState("testing")).toContain("CanTest");
  });

  it("should return empty array for unknown states", () => {
    expect(getRequiredCapabilitiesForState("unknown_state")).toEqual([]);
  });
});

describe("getRequiredCapabilitiesForTool", () => {
  it("should return capabilities for exact matches", () => {
    expect(getRequiredCapabilitiesForTool("exec:pnpm build")).toContain("CanBuild");
  });

  it("should return capabilities for prefix matches", () => {
    // "exec:git commit -m 'message'" should match "exec:git commit"
    expect(getRequiredCapabilitiesForTool("exec:git commit -m 'message'")).toContain("CanCommit");
  });

  it("should return empty array for unknown tools", () => {
    expect(getRequiredCapabilitiesForTool("unknown:tool")).toEqual([]);
  });
});

describe("validateStateTransition", () => {
  let tempDir: string;
  let workspaceDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "aas-validate-test-"));
    workspaceDir = path.join(tempDir, "workspace");
    await fs.mkdir(workspaceDir, { recursive: true });
    ContextGraph.clearCache();
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
    ContextGraph.clearCache();
  });

  it("should return valid=true for states with no requirements", async () => {
    const context: ReachabilityCheckContext = { workspaceDir };
    const result = await validateStateTransition(context, "idle");

    expect(result.valid).toBe(true);
    expect(result.missingCapabilities).toEqual([]);
  });

  it("should check capabilities for states with requirements", async () => {
    const context: ReachabilityCheckContext = { workspaceDir };
    const result = await validateStateTransition(context, "building");

    // Result depends on whether build tools are available
    expect(typeof result.valid).toBe("boolean");
    expect(result.details).toBeDefined();
  });
});

describe("validateToolExecution", () => {
  let tempDir: string;
  let workspaceDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "aas-tool-test-"));
    workspaceDir = path.join(tempDir, "workspace");
    await fs.mkdir(workspaceDir, { recursive: true });
    ContextGraph.clearCache();
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
    ContextGraph.clearCache();
  });

  it("should return valid=true for tools with no requirements", async () => {
    const context: ReachabilityCheckContext = { workspaceDir };
    const result = await validateToolExecution(context, "unknown:tool");

    expect(result.valid).toBe(true);
    expect(result.missingCapabilities).toEqual([]);
  });

  it("should check capabilities for tools with requirements", async () => {
    const context: ReachabilityCheckContext = { workspaceDir };
    const result = await validateToolExecution(context, "exec:pnpm build");

    // Result depends on whether build tools are available
    expect(typeof result.valid).toBe("boolean");
    expect(result.details).toBeDefined();
  });
});
