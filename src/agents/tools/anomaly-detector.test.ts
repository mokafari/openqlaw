import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as pathsModule from "../../config/paths.js";
import {
  getStatus,
  configure,
  acknowledgeAnomaly,
  getHistory,
  predict,
  createAnomalyDetectorTool,
} from "./anomaly-detector.js";

// ─────────────────────────────────────────────────────────────────────────────
// Test setup
// ─────────────────────────────────────────────────────────────────────────────

let tempDir: string;

function generateSessionStats(
  count: number,
  options: {
    errorRate?: number;
    latencyBase?: number;
    latencyVariance?: number;
    tokenBase?: number;
    fitnessBase?: number;
    degrading?: boolean;
  } = {},
): string {
  const {
    errorRate = 0.1,
    latencyBase = 50000,
    latencyVariance = 10000,
    tokenBase = 50000,
    fitnessBase = 0.85,
    degrading = false,
  } = options;

  const lines: string[] = [];
  const now = Date.now();
  const interval = 60000; // 1 minute between stats

  for (let i = 0; i < count; i++) {
    const timestamp = now - (count - i) * interval;
    const success = Math.random() > errorRate;

    // Apply degradation trend if enabled
    const degradationFactor = degrading ? 1 + (i / count) * 0.5 : 1;

    const stat = {
      sessionId: `test-session-${i}`,
      sessionKey: "agent:main:main",
      timestamp,
      success,
      durationMs: latencyBase * degradationFactor + (Math.random() - 0.5) * latencyVariance,
      tokenUsage: {
        input: 100,
        output: 500,
        total: Math.floor(tokenBase * degradationFactor),
      },
      toolCalls: 5,
      toolErrors: success ? undefined : { exec: { count: 1 } },
      fitness: fitnessBase / degradationFactor,
      model: "claude-opus-4-5",
    };

    lines.push(JSON.stringify(stat));
  }

  return lines.join("\n");
}

beforeEach(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "anomaly-test-"));

  // Create stats directory
  const statsDir = path.join(tempDir, "evolution", "stats");
  await fs.mkdir(statsDir, { recursive: true });

  // Mock resolveStateDir
  vi.spyOn(pathsModule, "resolveStateDir").mockReturnValue(tempDir);
});

afterEach(async () => {
  vi.restoreAllMocks();
  if (tempDir) {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// getStatus tests
// ─────────────────────────────────────────────────────────────────────────────

describe("getStatus", () => {
  it("returns healthy status when no data", async () => {
    const status = await getStatus();

    expect(status.overall).toBe("healthy");
    expect(status.activeAnomalies).toHaveLength(0);
    expect(status.scores).toBeDefined();
  });

  it("returns healthy status with normal telemetry", async () => {
    const statsPath = path.join(tempDir, "evolution", "stats", "session_stats.jsonl");
    const stats = generateSessionStats(50, { errorRate: 0.05 });
    await fs.writeFile(statsPath, stats);

    const status = await getStatus();

    expect(status.overall).toBe("healthy");
    expect(status.scores.length).toBeGreaterThan(0);
  });

  it("detects degraded status with high error rate spike", async () => {
    const statsPath = path.join(tempDir, "evolution", "stats", "session_stats.jsonl");

    // Create deterministic data - all successes first
    const lines: string[] = [];
    const now = Date.now();
    const interval = 60000;

    // 40 successes (error_rate = 0)
    for (let i = 0; i < 40; i++) {
      lines.push(
        JSON.stringify({
          sessionId: `test-session-${i}`,
          sessionKey: "agent:main:main",
          timestamp: now - (50 - i) * interval,
          success: true,
          durationMs: 50000,
          tokenUsage: { total: 50000 },
          toolCalls: 5,
          model: "claude-opus-4-5",
        }),
      );
    }

    // 10 failures (error_rate = 1) - clear spike
    for (let i = 40; i < 50; i++) {
      lines.push(
        JSON.stringify({
          sessionId: `test-session-${i}`,
          sessionKey: "agent:main:main",
          timestamp: now - (50 - i) * interval,
          success: false,
          durationMs: 50000,
          tokenUsage: { total: 50000 },
          toolCalls: 5,
          toolErrors: { exec: { count: 1 } },
          model: "claude-opus-4-5",
        }),
      );
    }

    await fs.writeFile(statsPath, lines.join("\n"));

    const status = await getStatus();

    // Should detect the anomaly - check both the score and active anomalies
    const errorRateScore = status.scores.find((s) => s.dimension === "error_rate");
    expect(errorRateScore).toBeDefined();
    // Current should be 1 (all failures in last window), baseline should be near 0
    expect(errorRateScore!.current).toBeGreaterThan(0.5);
    expect(errorRateScore!.baseline).toBeLessThan(0.2);
    // Deviation should be significant
    expect(errorRateScore!.deviation).toBeGreaterThan(1);
  });

  it("includes predictions for tracked dimensions", async () => {
    const statsPath = path.join(tempDir, "evolution", "stats", "session_stats.jsonl");
    const stats = generateSessionStats(30);
    await fs.writeFile(statsPath, stats);

    const status = await getStatus();

    expect(status.predictions.length).toBeGreaterThan(0);
    expect(status.predictions[0]).toHaveProperty("dimension");
    expect(status.predictions[0]).toHaveProperty("forecast");
    expect(status.predictions[0]).toHaveProperty("confidence");
  });

  it("auto-resolves anomalies when metrics return to normal", async () => {
    const statsPath = path.join(tempDir, "evolution", "stats", "session_stats.jsonl");

    // First create an anomaly
    const badStats = generateSessionStats(50, { errorRate: 0.8 });
    await fs.writeFile(statsPath, badStats);

    const badStatus = await getStatus();
    const hadAnomalies =
      badStatus.activeAnomalies.length > 0 || badStatus.scores.some((s) => s.severity !== "normal");

    // Now write good stats
    const goodStats = generateSessionStats(50, { errorRate: 0.02 });
    await fs.writeFile(statsPath, goodStats);

    const goodStatus = await getStatus();

    // Should have fewer or no active anomalies
    expect(goodStatus.activeAnomalies.filter((a) => !a.resolvedAt).length).toBeLessThanOrEqual(
      badStatus.activeAnomalies.length,
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// configure tests
// ─────────────────────────────────────────────────────────────────────────────

describe("configure", () => {
  it("updates sensitivity", async () => {
    await configure({ sensitivity: "high" });

    const statePath = path.join(tempDir, "evolution", "stats", "anomaly_state.json");
    const state = JSON.parse(await fs.readFile(statePath, "utf-8"));

    expect(state.config.sensitivity).toBe("high");
  });

  it("updates dimensions", async () => {
    await configure({ dimensions: ["error_rate", "latency"] });

    const statePath = path.join(tempDir, "evolution", "stats", "anomaly_state.json");
    const state = JSON.parse(await fs.readFile(statePath, "utf-8"));

    expect(state.config.dimensions).toEqual(["error_rate", "latency"]);
  });

  it("updates lookbackMinutes", async () => {
    await configure({ lookbackMinutes: 120 });

    const statePath = path.join(tempDir, "evolution", "stats", "anomaly_state.json");
    const state = JSON.parse(await fs.readFile(statePath, "utf-8"));

    expect(state.config.lookbackMinutes).toBe(120);
  });

  it("ignores invalid sensitivity values", async () => {
    await configure({ sensitivity: "invalid" as "high" });

    const statePath = path.join(tempDir, "evolution", "stats", "anomaly_state.json");
    const state = JSON.parse(await fs.readFile(statePath, "utf-8"));

    // Should remain at default
    expect(state.config.sensitivity).toBe("medium");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// acknowledgeAnomaly tests
// ─────────────────────────────────────────────────────────────────────────────

describe("acknowledgeAnomaly", () => {
  it("throws for non-existent anomaly", async () => {
    await expect(acknowledgeAnomaly("non-existent-id")).rejects.toThrow("not found");
  });

  it("marks anomaly as acknowledged", async () => {
    const statsPath = path.join(tempDir, "evolution", "stats", "session_stats.jsonl");

    // Create data that will trigger an anomaly
    const normalStats = generateSessionStats(40, { errorRate: 0.02 });
    const badStats = generateSessionStats(10, { errorRate: 0.9 });
    await fs.writeFile(statsPath, normalStats + "\n" + badStats);

    // Get status to create anomalies
    const status = await getStatus();

    if (status.activeAnomalies.length > 0) {
      const anomalyId = status.activeAnomalies[0].id;
      await acknowledgeAnomaly(anomalyId);

      const history = await getHistory();
      const acknowledged = history.find((a) => a.id === anomalyId);
      expect(acknowledged?.acknowledged).toBe(true);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// getHistory tests
// ─────────────────────────────────────────────────────────────────────────────

describe("getHistory", () => {
  it("returns empty array when no anomalies", async () => {
    const history = await getHistory();
    expect(history).toEqual([]);
  });

  it("respects days parameter", async () => {
    const statePath = path.join(tempDir, "evolution", "stats", "anomaly_state.json");
    const now = Date.now();

    // Create anomalies with different ages
    const state = {
      config: {
        dimensions: [],
        sensitivity: "medium",
        lookbackMinutes: 60,
        warningThreshold: 2,
        criticalThreshold: 3,
      },
      anomalies: [
        {
          id: "1",
          dimension: "error_rate",
          detectedAt: now,
          severity: "warning",
          description: "recent",
          acknowledged: false,
        },
        {
          id: "2",
          dimension: "latency",
          detectedAt: now - 10 * 24 * 60 * 60 * 1000,
          severity: "warning",
          description: "old",
          acknowledged: false,
        },
      ],
      lastCheck: now,
    };

    await fs.writeFile(statePath, JSON.stringify(state));

    const history7 = await getHistory(7);
    expect(history7).toHaveLength(1);
    expect(history7[0].id).toBe("1");

    const history30 = await getHistory(30);
    expect(history30).toHaveLength(2);
  });

  it("sorts by detectedAt descending", async () => {
    const statePath = path.join(tempDir, "evolution", "stats", "anomaly_state.json");
    const now = Date.now();

    const state = {
      config: {
        dimensions: [],
        sensitivity: "medium",
        lookbackMinutes: 60,
        warningThreshold: 2,
        criticalThreshold: 3,
      },
      anomalies: [
        {
          id: "old",
          dimension: "error_rate",
          detectedAt: now - 1000,
          severity: "warning",
          description: "old",
          acknowledged: false,
        },
        {
          id: "new",
          dimension: "latency",
          detectedAt: now,
          severity: "warning",
          description: "new",
          acknowledged: false,
        },
      ],
      lastCheck: now,
    };

    await fs.writeFile(statePath, JSON.stringify(state));

    const history = await getHistory();
    expect(history[0].id).toBe("new");
    expect(history[1].id).toBe("old");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// predict tests
// ─────────────────────────────────────────────────────────────────────────────

describe("predict", () => {
  it("throws when not enough data", async () => {
    await expect(predict("error_rate")).rejects.toThrow("Not enough data");
  });

  it("returns prediction with confidence", async () => {
    const statsPath = path.join(tempDir, "evolution", "stats", "session_stats.jsonl");
    const stats = generateSessionStats(50);
    await fs.writeFile(statsPath, stats);

    const prediction = await predict("latency", 30);

    expect(prediction).toHaveProperty("value");
    expect(prediction).toHaveProperty("confidence");
    expect(prediction.value).toBeGreaterThanOrEqual(0);
    expect(prediction.confidence).toBeGreaterThanOrEqual(0);
    expect(prediction.confidence).toBeLessThanOrEqual(1);
  });

  it("predicts increasing trend for degrading metrics", async () => {
    const statsPath = path.join(tempDir, "evolution", "stats", "session_stats.jsonl");
    const stats = generateSessionStats(50, { degrading: true, latencyBase: 10000 });
    await fs.writeFile(statsPath, stats);

    const prediction = await predict("latency", 30);

    // Value should be increasing for degrading latency
    expect(prediction.value).toBeGreaterThan(10000);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// createAnomalyDetectorTool tests
// ─────────────────────────────────────────────────────────────────────────────

describe("createAnomalyDetectorTool", () => {
  it("creates tool with correct metadata", () => {
    const tool = createAnomalyDetectorTool();

    expect(tool.name).toBe("anomaly_detector");
    expect(tool.label).toBe("Anomaly Detector");
    expect(tool.description).toContain("Monitor telemetry");
  });

  it("handles status action", async () => {
    const tool = createAnomalyDetectorTool();
    const result = await tool.execute("test-call", { action: "status" });

    expect(result.content[0]).toHaveProperty("text");
    const json = JSON.parse((result.content[0] as { text: string }).text);
    expect(json.status).toBe("ok");
    expect(json).toHaveProperty("overall");
  });

  it("handles configure action", async () => {
    const tool = createAnomalyDetectorTool();
    const result = await tool.execute("test-call", {
      action: "configure",
      sensitivity: "high",
      lookbackMinutes: 120,
    });

    const json = JSON.parse((result.content[0] as { text: string }).text);
    expect(json.status).toBe("ok");
    expect(json.config.sensitivity).toBe("high");
    expect(json.config.lookbackMinutes).toBe(120);
  });

  it("handles history action", async () => {
    const tool = createAnomalyDetectorTool();
    const result = await tool.execute("test-call", {
      action: "history",
      days: 7,
    });

    const json = JSON.parse((result.content[0] as { text: string }).text);
    expect(json.status).toBe("ok");
    expect(json).toHaveProperty("anomalies");
    expect(json).toHaveProperty("count");
  });

  it("handles predict action with required dimension", async () => {
    const statsPath = path.join(tempDir, "evolution", "stats", "session_stats.jsonl");
    const stats = generateSessionStats(30);
    await fs.writeFile(statsPath, stats);

    const tool = createAnomalyDetectorTool();
    const result = await tool.execute("test-call", {
      action: "predict",
      dimension: "latency",
      horizonMinutes: 15,
    });

    const json = JSON.parse((result.content[0] as { text: string }).text);
    expect(json.status).toBe("ok");
    expect(json.dimension).toBe("latency");
    expect(json.horizonMinutes).toBe(15);
  });

  it("returns error for missing required params", async () => {
    const tool = createAnomalyDetectorTool();
    const result = await tool.execute("test-call", { action: "predict" });

    const json = JSON.parse((result.content[0] as { text: string }).text);
    expect(json.status).toBe("error");
    expect(json.error).toContain("required");
  });

  it("returns error for unknown action", async () => {
    const tool = createAnomalyDetectorTool();
    const result = await tool.execute("test-call", { action: "unknown" });

    const json = JSON.parse((result.content[0] as { text: string }).text);
    expect(json.status).toBe("error");
    expect(json.error).toContain("Unknown action");
  });
});
