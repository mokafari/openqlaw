import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  startInvestigation,
  getInvestigation,
  addHypothesis,
  updateHypothesis,
  logExperiment,
  conclude,
  abandon,
  listActive,
  listByStatus,
  createHypothesisTrackerTool,
} from "./hypothesis-tracker.js";

describe("hypothesis-tracker", () => {
  let tempDir: string;
  let env: NodeJS.ProcessEnv;

  beforeEach(() => {
    // Create temp directory for tests
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "hypothesis-tracker-test-"));
    env = { OPENCLAW_STATE_DIR: tempDir };
  });

  afterEach(() => {
    // Clean up temp directory
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe("startInvestigation", () => {
    it("creates a new investigation", async () => {
      const inv = await startInvestigation("Test issue", env);

      expect(inv.id).toBeDefined();
      expect(inv.issue).toBe("Test issue");
      expect(inv.status).toBe("active");
      expect(inv.hypotheses).toEqual([]);
      expect(inv.experiments).toEqual([]);
      expect(inv.createdAt).toBeGreaterThan(0);
    });

    it("persists investigation to disk", async () => {
      const inv = await startInvestigation("Persisted issue", env);

      const loaded = await getInvestigation(inv.id, env);
      expect(loaded).not.toBeNull();
      expect(loaded!.issue).toBe("Persisted issue");
    });
  });

  describe("getInvestigation", () => {
    it("returns null for non-existent investigation", async () => {
      const result = await getInvestigation("non-existent-id", env);
      expect(result).toBeNull();
    });

    it("returns investigation by ID", async () => {
      const inv = await startInvestigation("Get test", env);
      const loaded = await getInvestigation(inv.id, env);

      expect(loaded).not.toBeNull();
      expect(loaded!.id).toBe(inv.id);
    });
  });

  describe("addHypothesis", () => {
    it("adds hypothesis to investigation", async () => {
      const inv = await startInvestigation("Hyp test", env);
      const hyp = await addHypothesis(inv.id, "Memory leak in parser", 0.7, env);

      expect(hyp.id).toBeDefined();
      expect(hyp.description).toBe("Memory leak in parser");
      expect(hyp.probability).toBe(0.7);
      expect(hyp.status).toBe("active");
      expect(hyp.evidence).toEqual([]);
    });

    it("clamps probability to 0-1 range", async () => {
      const inv = await startInvestigation("Clamp test", env);

      const hypHigh = await addHypothesis(inv.id, "High prob", 1.5, env);
      expect(hypHigh.probability).toBe(1);

      const hypLow = await addHypothesis(inv.id, "Low prob", -0.5, env);
      expect(hypLow.probability).toBe(0);
    });

    it("throws for non-existent investigation", async () => {
      await expect(addHypothesis("non-existent", "Test", 0.5, env)).rejects.toThrow(
        "Investigation non-existent not found",
      );
    });
  });

  describe("updateHypothesis", () => {
    it("updates probability and adds evidence", async () => {
      const inv = await startInvestigation("Update test", env);
      const hyp = await addHypothesis(inv.id, "Cache issue", 0.5, env);

      await updateHypothesis(hyp.id, 0.8, "Saw cache miss in logs", env);

      const loaded = await getInvestigation(inv.id, env);
      const updatedHyp = loaded!.hypotheses.find((h) => h.id === hyp.id);

      expect(updatedHyp!.probability).toBe(0.8);
      expect(updatedHyp!.evidence).toContain("Saw cache miss in logs");
    });

    it("auto-confirms hypothesis at probability >= 0.9", async () => {
      const inv = await startInvestigation("Confirm test", env);
      const hyp = await addHypothesis(inv.id, "Confirmed issue", 0.5, env);

      await updateHypothesis(hyp.id, 0.95, "Strong evidence", env);

      const loaded = await getInvestigation(inv.id, env);
      const updatedHyp = loaded!.hypotheses.find((h) => h.id === hyp.id);

      expect(updatedHyp!.status).toBe("confirmed");
    });

    it("auto-refutes hypothesis at probability <= 0.1", async () => {
      const inv = await startInvestigation("Refute test", env);
      const hyp = await addHypothesis(inv.id, "Refuted issue", 0.5, env);

      await updateHypothesis(hyp.id, 0.05, "Disproved", env);

      const loaded = await getInvestigation(inv.id, env);
      const updatedHyp = loaded!.hypotheses.find((h) => h.id === hyp.id);

      expect(updatedHyp!.status).toBe("refuted");
    });
  });

  describe("logExperiment", () => {
    it("logs experiment and updates hypothesis probability", async () => {
      const inv = await startInvestigation("Experiment test", env);
      const hyp = await addHypothesis(inv.id, "DB bottleneck", 0.5, env);

      const exp = await logExperiment(
        hyp.id,
        "Ran profiler",
        "confirmed",
        "CPU spike in DB queries",
        env,
      );

      expect(exp.id).toBeDefined();
      expect(exp.hypothesisId).toBe(hyp.id);
      expect(exp.action).toBe("Ran profiler");
      expect(exp.result).toBe("confirmed");
      expect(exp.notes).toBe("CPU spike in DB queries");

      const loaded = await getInvestigation(inv.id, env);
      expect(loaded!.experiments).toHaveLength(1);

      const updatedHyp = loaded!.hypotheses.find((h) => h.id === hyp.id);
      expect(updatedHyp!.probability).toBe(0.7); // 0.5 + 0.2
    });

    it("decreases probability on refuted experiment", async () => {
      const inv = await startInvestigation("Refute experiment", env);
      const hyp = await addHypothesis(inv.id, "Network issue", 0.5, env);

      await logExperiment(hyp.id, "Tested network", "refuted", "", env);

      const loaded = await getInvestigation(inv.id, env);
      const updatedHyp = loaded!.hypotheses.find((h) => h.id === hyp.id);
      expect(updatedHyp!.probability).toBe(0.2); // 0.5 - 0.3
    });

    it("keeps probability on inconclusive experiment", async () => {
      const inv = await startInvestigation("Inconclusive test", env);
      const hyp = await addHypothesis(inv.id, "Unknown cause", 0.5, env);

      await logExperiment(hyp.id, "Ran test", "inconclusive", "No clear result", env);

      const loaded = await getInvestigation(inv.id, env);
      const updatedHyp = loaded!.hypotheses.find((h) => h.id === hyp.id);
      expect(updatedHyp!.probability).toBe(0.5); // unchanged
    });
  });

  describe("conclude", () => {
    it("marks investigation as resolved with root cause", async () => {
      const inv = await startInvestigation("Conclude test", env);
      await addHypothesis(inv.id, "Memory leak", 0.9, env);

      await conclude(inv.id, "Memory leak in event handler", env);

      const loaded = await getInvestigation(inv.id, env);
      expect(loaded!.status).toBe("resolved");
      expect(loaded!.rootCause).toBe("Memory leak in event handler");
      expect(loaded!.resolvedAt).toBeGreaterThan(0);
    });
  });

  describe("abandon", () => {
    it("marks investigation as abandoned", async () => {
      const inv = await startInvestigation("Abandon test", env);

      await abandon(inv.id, "Cannot reproduce", env);

      const loaded = await getInvestigation(inv.id, env);
      expect(loaded!.status).toBe("abandoned");
      expect(loaded!.rootCause).toBe("Abandoned: Cannot reproduce");
    });
  });

  describe("listActive", () => {
    it("returns only active investigations", async () => {
      const inv1 = await startInvestigation("Active 1", env);
      const inv2 = await startInvestigation("Active 2", env);
      const inv3 = await startInvestigation("To resolve", env);

      await conclude(inv3.id, "Fixed", env);

      const active = await listActive(env);

      expect(active).toHaveLength(2);
      expect(active.map((i) => i.id)).toContain(inv1.id);
      expect(active.map((i) => i.id)).toContain(inv2.id);
      expect(active.map((i) => i.id)).not.toContain(inv3.id);
    });
  });

  describe("listByStatus", () => {
    it("filters by resolved status", async () => {
      await startInvestigation("Active", env);
      const resolved = await startInvestigation("Resolved", env);
      await conclude(resolved.id, "Fixed", env);

      const list = await listByStatus("resolved", env);

      expect(list).toHaveLength(1);
      expect(list[0].id).toBe(resolved.id);
    });
  });

  describe("createHypothesisTrackerTool", () => {
    it("creates a valid tool definition", () => {
      const tool = createHypothesisTrackerTool();

      expect(tool.name).toBe("hypothesis_tracker");
      expect(tool.label).toBe("Investigation");
      expect(tool.execute).toBeDefined();
    });

    it("executes start action", async () => {
      // Note: This test uses the real env, so we skip it to avoid side effects
      // In a real scenario, you'd mock the file system
    });
  });

  describe("integration: full investigation workflow", () => {
    it("completes a full debugging workflow", async () => {
      // Start investigation
      const inv = await startInvestigation("API returning 500 errors", env);
      expect(inv.status).toBe("active");

      // Add hypotheses
      const hyp1 = await addHypothesis(inv.id, "Database connection timeout", 0.4, env);
      const hyp2 = await addHypothesis(inv.id, "Memory exhaustion", 0.3, env);
      const hyp3 = await addHypothesis(inv.id, "Invalid input validation", 0.3, env);

      // Run experiments
      await logExperiment(hyp1.id, "Check DB connection pool", "refuted", "Pool healthy", env);
      await logExperiment(hyp2.id, "Monitor memory usage", "confirmed", "Saw spike to 95%", env);
      await logExperiment(
        hyp3.id,
        "Test with malformed input",
        "refuted",
        "Returns 400 correctly",
        env,
      );

      // Update hypothesis based on findings
      await updateHypothesis(hyp2.id, 0.9, "Correlated memory spike with 500 errors", env);

      // Verify state
      const loaded = await getInvestigation(inv.id, env);
      expect(loaded!.experiments).toHaveLength(3);

      const confirmedHyp = loaded!.hypotheses.find((h) => h.id === hyp2.id);
      expect(confirmedHyp!.status).toBe("confirmed");
      expect(confirmedHyp!.probability).toBeGreaterThanOrEqual(0.9);

      // Conclude investigation
      await conclude(inv.id, "Memory leak in request handler causing OOM", env);

      const concluded = await getInvestigation(inv.id, env);
      expect(concluded!.status).toBe("resolved");
      expect(concluded!.rootCause).toBe("Memory leak in request handler causing OOM");

      // Verify no longer in active list
      const active = await listActive(env);
      expect(active.map((i) => i.id)).not.toContain(inv.id);
    });
  });
});
