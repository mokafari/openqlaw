/**
 * Integration tests for emergence-metrics wiring in meta-integration
 *
 * Verifies that the emergence-metrics module is properly imported and
 * the functions are available for use.
 */

import { describe, it, expect } from "vitest";

describe("meta-integration with emergence-metrics", () => {
  it("imports emergence-metrics functions correctly", async () => {
    // Verify the import statement in meta-integration.ts works
    const metaIntegration = await import("./meta-integration.js");

    // Verify the module exports exist
    expect(metaIntegration.logGoalOutcome).toBeDefined();
    expect(metaIntegration.logGoalPrediction).toBeDefined();
    expect(metaIntegration.extractGoalTaskType).toBeDefined();
    expect(typeof metaIntegration.logGoalOutcome).toBe("function");
    expect(typeof metaIntegration.logGoalPrediction).toBe("function");
  });

  it("emergence-metrics module exports are available", async () => {
    const emergenceMetrics = await import("../meta/emergence-metrics.js");

    // Verify exports
    expect(emergenceMetrics.logNovelty).toBeDefined();
    expect(emergenceMetrics.logBreakthrough).toBeDefined();
    expect(emergenceMetrics.detectBreakthrough).toBeDefined();
    expect(emergenceMetrics.getCuriosityScore).toBeDefined();
    expect(typeof emergenceMetrics.logNovelty).toBe("function");
    expect(typeof emergenceMetrics.detectBreakthrough).toBe("function");
  });

  it("extractGoalTaskType handles various inputs", async () => {
    const { extractGoalTaskType } = await import("./meta-integration.js");

    expect(extractGoalTaskType("Fix the authentication bug")).toBe("fix");
    expect(extractGoalTaskType("Implement new feature")).toBe("implement");
    expect(extractGoalTaskType("Create a new module")).toBe("create");
    expect(extractGoalTaskType("Random task")).toBe("generic");
  });
});
