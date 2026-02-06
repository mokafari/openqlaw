import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSubsystemLogger } from "../logging/subsystem.js";
import { validateReachability } from "./aas/reachability.js";
import { getToolMetadata } from "./aas/tool-surface.js";
import { wrapToolWithBeforeToolCallHook } from "./pi-tools.before-tool-call.js";

vi.mock("./aas/reachability.js", () => ({
  checkReachability: vi.fn(),
  validateReachability: vi.fn(),
}));

vi.mock("./aas/tool-surface.js", () => ({
  getToolMetadata: vi.fn(),
}));

vi.mock("../logging/subsystem.js", () => ({
  createSubsystemLogger: vi.fn(() => ({
    warn: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
  })),
}));

const mockValidateReachability = vi.mocked(validateReachability);
const mockGetToolMetadata = vi.mocked(getToolMetadata);

describe("checkToolReachability with reachabilityEdges", () => {
  let workspaceDir: string;

  beforeEach(() => {
    workspaceDir = path.join(os.tmpdir(), "test-workspace");
    vi.clearAllMocks();
  });

  it("should validate reachability edges for tools with reachabilityEdges", async () => {
    // Mock browser tool with reachabilityEdges
    mockGetToolMetadata.mockReturnValue({
      toolName: "browser",
      contextAreas: ["browser"],
      preconditions: [],
      sideEffects: ["browser.open", "browser.navigation"],
      reachabilityEdges: ["filesystem->browser"],
    });

    mockValidateReachability.mockResolvedValue({
      valid: true,
      missing: [],
    });

    const execute = vi.fn().mockResolvedValue({ content: [], details: { ok: true } });
    const tool = wrapToolWithBeforeToolCallHook({ name: "browser", execute } as never, {
      workspaceDir,
    });

    await tool.execute("call-1", { url: "https://example.com" }, undefined, undefined);

    // Should validate the reachability edge
    expect(mockValidateReachability).toHaveBeenCalledWith(
      "filesystem",
      "browser",
      expect.objectContaining({
        workspaceDir,
        toolName: "browser",
      }),
    );
    expect(execute).toHaveBeenCalled();
  });

  it("should validate multiple reachability edges", async () => {
    mockGetToolMetadata.mockReturnValue({
      toolName: "sessions_spawn",
      contextAreas: ["messaging", "system"],
      preconditions: [],
      sideEffects: [],
      reachabilityEdges: ["messaging->system", "system->messaging"],
    });

    mockValidateReachability.mockResolvedValue({
      valid: true,
      missing: [],
    });

    const execute = vi.fn().mockResolvedValue({ content: [], details: { ok: true } });
    const tool = wrapToolWithBeforeToolCallHook({ name: "sessions_spawn", execute } as never, {
      workspaceDir,
    });

    await tool.execute("call-2", { agentId: "test" }, undefined, undefined);

    // Should validate both edges
    expect(mockValidateReachability).toHaveBeenCalledTimes(2);
    expect(mockValidateReachability).toHaveBeenCalledWith(
      "messaging",
      "system",
      expect.any(Object),
    );
    expect(mockValidateReachability).toHaveBeenCalledWith(
      "system",
      "messaging",
      expect.any(Object),
    );
  });

  it("should warn but not block when reachability validation fails", async () => {
    const log = createSubsystemLogger("test");
    const warnSpy = vi.spyOn(log, "warn");

    mockGetToolMetadata.mockReturnValue({
      toolName: "browser",
      contextAreas: ["browser"],
      preconditions: [],
      sideEffects: [],
      reachabilityEdges: ["filesystem->browser"],
    });

    mockValidateReachability.mockResolvedValue({
      valid: false,
      missing: ["NETWORK"],
      reason: "Missing required capabilities: NETWORK",
    });

    const execute = vi.fn().mockResolvedValue({ content: [], details: { ok: true } });
    const tool = wrapToolWithBeforeToolCallHook({ name: "browser", execute } as never, {
      workspaceDir,
    });

    await tool.execute("call-3", { url: "https://example.com" }, undefined, undefined);

    // Should still execute the tool (advisory enforcement)
    expect(execute).toHaveBeenCalled();
    // Warning should be logged (though we can't easily test this without exposing the logger)
  });

  it("should handle invalid edge format gracefully", async () => {
    mockGetToolMetadata.mockReturnValue({
      toolName: "test_tool",
      contextAreas: ["filesystem"],
      preconditions: [],
      sideEffects: [],
      reachabilityEdges: ["invalid-format"], // Missing "->"
    });

    mockValidateReachability.mockResolvedValue({
      valid: true,
      missing: [],
    });

    const execute = vi.fn().mockResolvedValue({ content: [], details: { ok: true } });
    const tool = wrapToolWithBeforeToolCallHook({ name: "test_tool", execute } as never, {
      workspaceDir,
    });

    await tool.execute("call-4", {}, undefined, undefined);

    // Should not call validateReachability for invalid format
    expect(mockValidateReachability).not.toHaveBeenCalled();
    expect(execute).toHaveBeenCalled();
  });

  it("should not validate edges for tools without reachabilityEdges", async () => {
    mockGetToolMetadata.mockReturnValue({
      toolName: "read",
      contextAreas: ["filesystem"],
      preconditions: [],
      sideEffects: [],
      // No reachabilityEdges
    });

    const execute = vi.fn().mockResolvedValue({ content: [], details: { ok: true } });
    const tool = wrapToolWithBeforeToolCallHook({ name: "read", execute } as never, {
      workspaceDir,
    });

    await tool.execute("call-5", { path: "/tmp/file" }, undefined, undefined);

    // Should not call validateReachability
    expect(mockValidateReachability).not.toHaveBeenCalled();
    expect(execute).toHaveBeenCalled();
  });

  it("should handle validation errors gracefully", async () => {
    mockGetToolMetadata.mockReturnValue({
      toolName: "browser",
      contextAreas: ["browser"],
      preconditions: [],
      sideEffects: [],
      reachabilityEdges: ["filesystem->browser"],
    });

    mockValidateReachability.mockRejectedValue(new Error("Validation failed"));

    const execute = vi.fn().mockResolvedValue({ content: [], details: { ok: true } });
    const tool = wrapToolWithBeforeToolCallHook({ name: "browser", execute } as never, {
      workspaceDir,
    });

    // Should not throw, should continue execution
    await expect(
      tool.execute("call-6", { url: "https://example.com" }, undefined, undefined),
    ).resolves.toBeDefined();
    expect(execute).toHaveBeenCalled();
  });

  it("should build correct reachability context with targetPath", async () => {
    mockGetToolMetadata.mockReturnValue({
      toolName: "read",
      contextAreas: ["filesystem"],
      preconditions: [],
      sideEffects: [],
      reachabilityEdges: ["filesystem->browser"],
    });

    mockValidateReachability.mockResolvedValue({
      valid: true,
      missing: [],
    });

    const execute = vi.fn().mockResolvedValue({ content: [], details: { ok: true } });
    const tool = wrapToolWithBeforeToolCallHook({ name: "read", execute } as never, {
      workspaceDir,
    });

    const targetPath = path.join(workspaceDir, "test.txt");
    await tool.execute("call-7", { path: targetPath }, undefined, undefined);

    expect(mockValidateReachability).toHaveBeenCalledWith(
      "filesystem",
      "browser",
      expect.objectContaining({
        workspaceDir,
        toolName: "read",
        targetPath,
      }),
    );
  });
});
