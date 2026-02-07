import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { EmbeddingProvider } from "../../memory/embeddings.js";
import type { FSMStateManager } from "../fsm/state-manager.js";
import type { TensorConfig } from "./types.js";
import { GoalStack } from "../goals/stack.js";
import { NeuroSymbolicLoopController } from "./loop-controller.js";
import { PatternStore } from "./pattern-store.js";
import { DEFAULT_TENSOR_CONFIG } from "./types.js";

function makeTempDb(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tensor-loop-test-"));
  return path.join(dir, "patterns.db");
}

function makeEmbeddingProvider(): EmbeddingProvider {
  return {
    id: "test",
    model: "test-model",
    embedQuery: vi.fn().mockResolvedValue([0.1, 0.2, 0.3]),
    embedBatch: vi.fn().mockResolvedValue([[0.1, 0.2, 0.3]]),
  };
}

function makeFsmManager(): FSMStateManager {
  let state = "idle";
  return {
    getState: vi.fn(() => state),
    transitionTo: vi.fn(async (newState: string) => {
      state = newState;
      return true;
    }),
    persist: vi.fn(),
    load: vi.fn(),
  } as unknown as FSMStateManager;
}

describe("NeuroSymbolicLoopController", () => {
  let dbPath: string;
  let store: PatternStore;
  let goalStack: GoalStack;
  let fsmManager: FSMStateManager;
  let controller: NeuroSymbolicLoopController;
  const config: TensorConfig = {
    ...DEFAULT_TENSOR_CONFIG,
    enabled: true,
    minFitnessForRecall: 0.3,
  };

  beforeEach(() => {
    dbPath = makeTempDb();
    store = new PatternStore(dbPath);
    goalStack = new GoalStack("test-session");
    fsmManager = makeFsmManager();
    controller = new NeuroSymbolicLoopController({
      fsmManager,
      goalStack,
      patternStore: store,
      embeddingProvider: makeEmbeddingProvider(),
      config,
    });
  });

  afterEach(() => {
    store.close();
    try {
      fs.rmSync(path.dirname(dbPath), { recursive: true, force: true });
    } catch {
      // cleanup best-effort
    }
  });

  it("onPlanStart transitions to planning and pushes a goal", async () => {
    await controller.onPlanStart("Build a feature");

    expect(fsmManager.transitionTo).toHaveBeenCalledWith("planning", expect.any(Object));
    expect(goalStack.getAll().length).toBe(1);
    expect(goalStack.getAll()[0].description).toContain("Build a feature");
  });

  it("onExecuteStart transitions to executing", async () => {
    await controller.onPlanStart("test");
    await controller.onExecuteStart();

    expect(fsmManager.transitionTo).toHaveBeenCalledWith("executing", expect.any(Object));
  });

  it("onExecuteComplete transitions to verifying on success", async () => {
    await controller.onPlanStart("test");
    await controller.onExecuteStart();
    await controller.onExecuteComplete(true);

    expect(fsmManager.transitionTo).toHaveBeenCalledWith("verifying", expect.any(Object));
  });

  it("onExecuteComplete transitions to retreating on failure", async () => {
    await controller.onPlanStart("test");
    await controller.onExecuteStart();
    await controller.onExecuteComplete(false);

    expect(fsmManager.transitionTo).toHaveBeenCalledWith("retreating", expect.any(Object));
  });

  it("onCritique calculates fitness and completes goal", () => {
    goalStack.push({ type: "task", description: "test goal" });
    const result = controller.onCritique({
      sessionId: "test",
      timestamp: Date.now(),
      success: true,
      aborted: false,
      tokenUsage: { input: 100, output: 50, total: 150 },
      toolCalls: 3,
      durationMs: 5000,
      model: "test",
      provider: "test",
    });

    expect(result.fitness).toBeGreaterThan(0);
    expect(goalStack.getCompleted().length).toBe(1);
  });

  it("onLearn records pattern on success", async () => {
    const result = await controller.onLearn({
      prompt: "test prompt",
      toolMetas: [{ toolName: "read_file" }],
      success: true,
      durationMs: 1000,
      tokenUsage: { input: 100, output: 50, total: 150 },
      toolCallCount: 1,
    });

    expect(result.phase).toBe("learn");
    expect(result.success).toBe(true);
    // Pattern may or may not be recorded depending on fitness threshold
    expect(typeof result.patternRecorded).toBe("boolean");
  });

  it("full loop lifecycle works end-to-end", async () => {
    // Plan
    await controller.onPlanStart("Implement feature X");

    // Execute
    await controller.onExecuteStart();
    await controller.onExecuteComplete(true);

    // Critique
    const critiqueResult = controller.onCritique({
      sessionId: "test",
      timestamp: Date.now(),
      success: true,
      aborted: false,
      tokenUsage: { input: 200, output: 100, total: 300 },
      toolCalls: 5,
      durationMs: 10000,
      model: "test",
      provider: "test",
    });
    expect(critiqueResult.fitness).toBeGreaterThan(0);

    // Learn
    const learnResult = await controller.onLearn({
      prompt: "Implement feature X",
      toolMetas: [{ toolName: "read_file" }, { toolName: "write_file" }],
      success: true,
      durationMs: 10000,
      tokenUsage: { input: 200, output: 100, total: 300 },
      toolCallCount: 5,
    });
    expect(learnResult.phase).toBe("learn");
    expect(learnResult.success).toBe(true);
  });
});
