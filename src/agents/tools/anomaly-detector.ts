import { Type } from "@sinclair/typebox";
import crypto from "node:crypto";
import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import readline from "node:readline";
import type { AnyAgentTool } from "./common.js";
import { resolveStateDir } from "../../config/paths.js";
import { jsonResult, readStringParam, readNumberParam, readStringArrayParam } from "./common.js";

// ─────────────────────────────────────────────────────────────────────────────
// Types & Interfaces
// ─────────────────────────────────────────────────────────────────────────────

export interface AnomalyScore {
  dimension: string; // 'error_rate', 'latency', 'token_usage', etc.
  current: number;
  baseline: number;
  deviation: number; // Standard deviations from baseline
  trend: "stable" | "increasing" | "decreasing";
  severity: "normal" | "warning" | "critical";
}

export interface Anomaly {
  id: string;
  dimension: string;
  detectedAt: number;
  severity: "warning" | "critical";
  description: string;
  acknowledged: boolean;
  resolvedAt?: number;
}

export interface HealthStatus {
  overall: "healthy" | "degraded" | "critical";
  scores: AnomalyScore[];
  activeAnomalies: Anomaly[];
  predictions: { dimension: string; forecast: string; confidence: number }[];
}

export interface AnomalyConfig {
  dimensions: string[];
  sensitivity: "low" | "medium" | "high";
  lookbackMinutes: number;
  warningThreshold: number;
  criticalThreshold: number;
}

interface SessionStat {
  timestamp: number;
  success: boolean;
  durationMs: number;
  tokenUsage?: {
    input?: number;
    output?: number;
    total?: number;
  };
  toolCalls?: number;
  toolErrors?: Record<string, { count: number }>;
  fitness?: number;
  model?: string;
}

interface TimeSeriesPoint {
  timestamp: number;
  value: number;
}

interface AnomalyState {
  config: AnomalyConfig;
  anomalies: Anomaly[];
  lastCheck: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const DEFAULT_DIMENSIONS = ["error_rate", "latency", "token_usage", "tool_error_rate", "fitness"];

const DEFAULT_CONFIG: AnomalyConfig = {
  dimensions: DEFAULT_DIMENSIONS,
  sensitivity: "medium",
  lookbackMinutes: 60,
  warningThreshold: 2.0, // 2 std devs
  criticalThreshold: 3.0, // 3 std devs
};

const SENSITIVITY_THRESHOLDS: Record<
  AnomalyConfig["sensitivity"],
  { warning: number; critical: number }
> = {
  low: { warning: 3.0, critical: 4.0 },
  medium: { warning: 2.0, critical: 3.0 },
  high: { warning: 1.5, critical: 2.5 },
};

// ─────────────────────────────────────────────────────────────────────────────
// File paths
// ─────────────────────────────────────────────────────────────────────────────

function getStatsPath(): string {
  const stateDir = resolveStateDir();
  return path.join(stateDir, "evolution", "stats", "session_stats.jsonl");
}

function getAnomalyStatePath(): string {
  const stateDir = resolveStateDir();
  return path.join(stateDir, "evolution", "stats", "anomaly_state.json");
}

// ─────────────────────────────────────────────────────────────────────────────
// State management
// ─────────────────────────────────────────────────────────────────────────────

async function loadAnomalyState(): Promise<AnomalyState> {
  const statePath = getAnomalyStatePath();
  try {
    const content = await fs.readFile(statePath, "utf-8");
    return JSON.parse(content) as AnomalyState;
  } catch {
    return {
      config: { ...DEFAULT_CONFIG },
      anomalies: [],
      lastCheck: 0,
    };
  }
}

async function saveAnomalyState(state: AnomalyState): Promise<void> {
  const statePath = getAnomalyStatePath();
  await fs.mkdir(path.dirname(statePath), { recursive: true });
  await fs.writeFile(statePath, JSON.stringify(state, null, 2));
}

// ─────────────────────────────────────────────────────────────────────────────
// Telemetry loading
// ─────────────────────────────────────────────────────────────────────────────

async function loadSessionStats(lookbackMs: number): Promise<SessionStat[]> {
  const statsPath = getStatsPath();
  const stats: SessionStat[] = [];
  const cutoff = Date.now() - lookbackMs;

  try {
    await fs.access(statsPath);
  } catch {
    return stats;
  }

  const rl = readline.createInterface({
    input: createReadStream(statsPath),
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    if (!line.trim()) continue;
    try {
      const stat = JSON.parse(line) as SessionStat;
      if (stat.timestamp >= cutoff) {
        stats.push(stat);
      }
    } catch {
      // Skip malformed lines
    }
  }

  return stats.sort((a, b) => a.timestamp - b.timestamp);
}

// ─────────────────────────────────────────────────────────────────────────────
// Time series extraction
// ─────────────────────────────────────────────────────────────────────────────

function extractTimeSeries(stats: SessionStat[], dimension: string): TimeSeriesPoint[] {
  const points: TimeSeriesPoint[] = [];

  for (const stat of stats) {
    let value: number | undefined;

    switch (dimension) {
      case "error_rate":
        value = stat.success ? 0 : 1;
        break;
      case "latency":
        value = stat.durationMs;
        break;
      case "token_usage":
        value = stat.tokenUsage?.total ?? 0;
        break;
      case "tool_error_rate": {
        const totalErrors = Object.values(stat.toolErrors ?? {}).reduce(
          (sum, e) => sum + (e.count ?? 0),
          0,
        );
        const toolCalls = stat.toolCalls ?? 1;
        value = toolCalls > 0 ? totalErrors / toolCalls : 0;
        break;
      }
      case "fitness":
        value = stat.fitness;
        break;
      default:
        continue;
    }

    if (value !== undefined && Number.isFinite(value)) {
      points.push({ timestamp: stat.timestamp, value });
    }
  }

  return points;
}

// ─────────────────────────────────────────────────────────────────────────────
// Statistical analysis
// ─────────────────────────────────────────────────────────────────────────────

function calculateMean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

function calculateStdDev(values: number[], mean: number): number {
  if (values.length < 2) return 0;
  const variance = values.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / (values.length - 1);
  return Math.sqrt(variance);
}

function calculateMovingAverage(points: TimeSeriesPoint[], windowSize: number): number {
  if (points.length === 0) return 0;
  const window = points.slice(-windowSize);
  return calculateMean(window.map((p) => p.value));
}

function calculateLinearTrend(points: TimeSeriesPoint[]): {
  slope: number;
  direction: "stable" | "increasing" | "decreasing";
} {
  if (points.length < 3) {
    return { slope: 0, direction: "stable" };
  }

  // Simple linear regression
  const n = points.length;
  const xMean = (n - 1) / 2;
  const yMean = calculateMean(points.map((p) => p.value));

  let numerator = 0;
  let denominator = 0;

  for (let i = 0; i < n; i++) {
    numerator += (i - xMean) * (points[i].value - yMean);
    denominator += Math.pow(i - xMean, 2);
  }

  const slope = denominator !== 0 ? numerator / denominator : 0;

  // Normalize slope by mean to get relative change rate
  const normalizedSlope = yMean !== 0 ? slope / yMean : slope;

  const TREND_THRESHOLD = 0.01; // 1% change per data point
  let direction: "stable" | "increasing" | "decreasing" = "stable";
  if (normalizedSlope > TREND_THRESHOLD) direction = "increasing";
  if (normalizedSlope < -TREND_THRESHOLD) direction = "decreasing";

  return { slope, direction };
}

// ─────────────────────────────────────────────────────────────────────────────
// Anomaly detection
// ─────────────────────────────────────────────────────────────────────────────

function detectAnomalies(
  points: TimeSeriesPoint[],
  dimension: string,
  config: AnomalyConfig,
): {
  score: AnomalyScore;
  newAnomaly?: Omit<Anomaly, "id" | "acknowledged">;
} {
  const values = points.map((p) => p.value);

  if (values.length < 5) {
    // Not enough data for meaningful analysis
    return {
      score: {
        dimension,
        current: values[values.length - 1] ?? 0,
        baseline: 0,
        deviation: 0,
        trend: "stable",
        severity: "normal",
      },
    };
  }

  // Calculate baseline from first 80% of data
  const baselineSize = Math.floor(values.length * 0.8);
  const baselineValues = values.slice(0, baselineSize);
  const baseline = calculateMean(baselineValues);
  const stdDev = calculateStdDev(baselineValues, baseline);

  // Current = moving average of last 5 points
  const current = calculateMovingAverage(points, 5);

  // Calculate deviation in standard deviations
  // If stdDev is 0 (perfect baseline), use absolute difference scaled by baseline
  // For zero baseline, any deviation is significant
  let deviation: number;
  if (stdDev > 0) {
    deviation = Math.abs(current - baseline) / stdDev;
  } else if (baseline === 0 && current > 0) {
    // Zero baseline with non-zero current: treat as significant deviation
    // Scale by threshold to make it detectable
    deviation = config.criticalThreshold + 1;
  } else if (baseline > 0) {
    // Non-zero baseline with zero variance: use percentage change
    deviation = (Math.abs(current - baseline) / baseline) * config.criticalThreshold;
  } else {
    deviation = 0;
  }

  // Determine trend
  const { direction: trend } = calculateLinearTrend(points.slice(-10));

  // Determine severity
  const thresholds = SENSITIVITY_THRESHOLDS[config.sensitivity];
  let severity: AnomalyScore["severity"] = "normal";
  if (deviation >= thresholds.critical) {
    severity = "critical";
  } else if (deviation >= thresholds.warning) {
    severity = "warning";
  }

  // For inverted metrics (fitness), high values are good
  const invertedMetrics = ["fitness"];
  const isInverted = invertedMetrics.includes(dimension);

  // Only flag if deviation is in the bad direction
  if (isInverted) {
    // For fitness: below baseline is bad
    if (current >= baseline) {
      severity = "normal";
    }
  } else {
    // For error_rate, latency: above baseline is bad
    if (current <= baseline) {
      severity = "normal";
    }
  }

  const score: AnomalyScore = {
    dimension,
    current,
    baseline,
    deviation,
    trend,
    severity,
  };

  // Create anomaly if severity warrants it
  let newAnomaly: Omit<Anomaly, "id" | "acknowledged"> | undefined;
  if (severity !== "normal") {
    const direction = isInverted
      ? current < baseline
        ? "dropped"
        : "increased"
      : current > baseline
        ? "increased"
        : "dropped";

    const pctChange =
      baseline !== 0 ? Math.abs(((current - baseline) / baseline) * 100).toFixed(1) : "∞";

    newAnomaly = {
      dimension,
      detectedAt: Date.now(),
      severity: severity as "warning" | "critical",
      description: `${dimension} ${direction} by ${pctChange}% (${deviation.toFixed(1)}σ from baseline)`,
    };
  }

  return { score, newAnomaly };
}

// ─────────────────────────────────────────────────────────────────────────────
// Prediction
// ─────────────────────────────────────────────────────────────────────────────

function predictValue(
  points: TimeSeriesPoint[],
  horizonMinutes: number,
): { value: number; confidence: number } {
  if (points.length < 3) {
    return { value: points[points.length - 1]?.value ?? 0, confidence: 0 };
  }

  const { slope } = calculateLinearTrend(points);
  const current = points[points.length - 1].value;

  // Average time between points (in minutes)
  const avgInterval =
    points.length > 1
      ? (points[points.length - 1].timestamp - points[0].timestamp) / (points.length - 1) / 60000
      : 1;

  // Number of intervals in horizon
  const intervals = horizonMinutes / avgInterval;

  // Predicted value
  const value = current + slope * intervals;

  // Confidence decreases with horizon and variance
  const values = points.map((p) => p.value);
  const mean = calculateMean(values);
  const stdDev = calculateStdDev(values, mean);
  const cv = mean !== 0 ? stdDev / Math.abs(mean) : 1; // Coefficient of variation

  // Confidence: starts at 0.9, decreases with horizon and variance
  const confidence = Math.max(0, Math.min(1, 0.9 - (horizonMinutes / 120) * 0.3 - cv * 0.3));

  return { value: Math.max(0, value), confidence };
}

function generatePredictions(
  stats: SessionStat[],
  dimensions: string[],
): Array<{ dimension: string; forecast: string; confidence: number }> {
  const predictions: Array<{ dimension: string; forecast: string; confidence: number }> = [];
  const horizonMinutes = 30;

  for (const dimension of dimensions) {
    const points = extractTimeSeries(stats, dimension);
    if (points.length < 5) continue;

    const { value, confidence } = predictValue(points, horizonMinutes);
    const current = points[points.length - 1].value;

    const pctChange = current !== 0 ? (((value - current) / current) * 100).toFixed(1) : "0";
    const direction = value > current ? "increase" : value < current ? "decrease" : "stable";

    predictions.push({
      dimension,
      forecast: `Expected to ${direction} by ${Math.abs(Number(pctChange))}% in ${horizonMinutes}min`,
      confidence,
    });
  }

  return predictions;
}

// ─────────────────────────────────────────────────────────────────────────────
// Main functions
// ─────────────────────────────────────────────────────────────────────────────

export async function getStatus(): Promise<HealthStatus> {
  const state = await loadAnomalyState();
  const lookbackMs = state.config.lookbackMinutes * 60 * 1000;
  const stats = await loadSessionStats(lookbackMs);

  const scores: AnomalyScore[] = [];
  const newAnomalies: Anomaly[] = [];

  for (const dimension of state.config.dimensions) {
    const points = extractTimeSeries(stats, dimension);
    const { score, newAnomaly } = detectAnomalies(points, dimension, state.config);
    scores.push(score);

    if (newAnomaly) {
      // Check if similar anomaly already exists and is not resolved
      const existing = state.anomalies.find((a) => a.dimension === dimension && !a.resolvedAt);
      if (!existing) {
        newAnomalies.push({
          ...newAnomaly,
          id: crypto.randomUUID(),
          acknowledged: false,
        });
      }
    } else {
      // Auto-resolve existing anomalies if metrics returned to normal
      const existing = state.anomalies.find((a) => a.dimension === dimension && !a.resolvedAt);
      if (existing) {
        existing.resolvedAt = Date.now();
      }
    }
  }

  // Add new anomalies to state
  state.anomalies.push(...newAnomalies);
  state.lastCheck = Date.now();
  await saveAnomalyState(state);

  // Active anomalies = unresolved ones
  const activeAnomalies = state.anomalies.filter((a) => !a.resolvedAt);

  // Determine overall health
  const criticalCount = activeAnomalies.filter((a) => a.severity === "critical").length;
  const warningCount = activeAnomalies.filter((a) => a.severity === "warning").length;

  let overall: HealthStatus["overall"] = "healthy";
  if (criticalCount > 0) {
    overall = "critical";
  } else if (warningCount > 0) {
    overall = "degraded";
  }

  // Generate predictions
  const predictions = generatePredictions(stats, state.config.dimensions);

  return {
    overall,
    scores,
    activeAnomalies,
    predictions,
  };
}

export async function configure(options: {
  dimensions?: string[];
  sensitivity?: string;
  lookbackMinutes?: number;
}): Promise<void> {
  const state = await loadAnomalyState();

  if (options.dimensions && options.dimensions.length > 0) {
    state.config.dimensions = options.dimensions;
  }
  if (options.sensitivity) {
    const sensitivity = options.sensitivity as AnomalyConfig["sensitivity"];
    if (["low", "medium", "high"].includes(sensitivity)) {
      state.config.sensitivity = sensitivity;
      const thresholds = SENSITIVITY_THRESHOLDS[sensitivity];
      state.config.warningThreshold = thresholds.warning;
      state.config.criticalThreshold = thresholds.critical;
    }
  }
  if (typeof options.lookbackMinutes === "number" && options.lookbackMinutes > 0) {
    state.config.lookbackMinutes = options.lookbackMinutes;
  }

  await saveAnomalyState(state);
}

export async function acknowledgeAnomaly(anomalyId: string): Promise<void> {
  const state = await loadAnomalyState();
  const anomaly = state.anomalies.find((a) => a.id === anomalyId);
  if (!anomaly) {
    throw new Error(`Anomaly ${anomalyId} not found`);
  }
  anomaly.acknowledged = true;
  await saveAnomalyState(state);
}

export async function getHistory(days = 7): Promise<Anomaly[]> {
  const state = await loadAnomalyState();
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  return state.anomalies
    .filter((a) => a.detectedAt >= cutoff)
    .sort((a, b) => b.detectedAt - a.detectedAt);
}

export async function predict(
  dimension: string,
  horizonMinutes = 30,
): Promise<{ value: number; confidence: number }> {
  const state = await loadAnomalyState();
  const lookbackMs = state.config.lookbackMinutes * 60 * 1000;
  const stats = await loadSessionStats(lookbackMs);
  const points = extractTimeSeries(stats, dimension);

  if (points.length < 3) {
    throw new Error(`Not enough data for prediction on ${dimension}`);
  }

  return predictValue(points, horizonMinutes);
}

// ─────────────────────────────────────────────────────────────────────────────
// Tool factory
// ─────────────────────────────────────────────────────────────────────────────

const AnomalyDetectorSchema = Type.Object({
  action: Type.Union([
    Type.Literal("status"),
    Type.Literal("configure"),
    Type.Literal("acknowledge"),
    Type.Literal("history"),
    Type.Literal("predict"),
  ]),
  // For configure
  dimensions: Type.Optional(Type.Array(Type.String())),
  sensitivity: Type.Optional(
    Type.Union([Type.Literal("low"), Type.Literal("medium"), Type.Literal("high")]),
  ),
  lookbackMinutes: Type.Optional(Type.Number()),
  // For acknowledge
  anomalyId: Type.Optional(Type.String()),
  // For history
  days: Type.Optional(Type.Number()),
  // For predict
  dimension: Type.Optional(Type.String()),
  horizonMinutes: Type.Optional(Type.Number()),
});

export function createAnomalyDetectorTool(): AnyAgentTool {
  return {
    label: "Anomaly Detector",
    name: "anomaly_detector",
    description:
      "Monitor telemetry for anomalies, detect sudden spikes and gradual degradation, and predict future issues. Actions: status (health overview), configure (set dimensions/sensitivity), acknowledge (mark anomaly as seen), history (past anomalies), predict (forecast a dimension).",
    parameters: AnomalyDetectorSchema,
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const action = readStringParam(params, "action", { required: true }) as
        | "status"
        | "configure"
        | "acknowledge"
        | "history"
        | "predict";

      try {
        switch (action) {
          case "status": {
            const status = await getStatus();
            return jsonResult({
              status: "ok",
              ...status,
            });
          }

          case "configure": {
            const dimensions = readStringArrayParam(params, "dimensions");
            const sensitivity = readStringParam(params, "sensitivity");
            const lookbackMinutes = readNumberParam(params, "lookbackMinutes");
            await configure({ dimensions, sensitivity, lookbackMinutes });
            const state = await loadAnomalyState();
            return jsonResult({
              status: "ok",
              message: "Configuration updated",
              config: state.config,
            });
          }

          case "acknowledge": {
            const anomalyId = readStringParam(params, "anomalyId", { required: true });
            await acknowledgeAnomaly(anomalyId);
            return jsonResult({
              status: "ok",
              message: `Anomaly ${anomalyId} acknowledged`,
            });
          }

          case "history": {
            const days = readNumberParam(params, "days") ?? 7;
            const history = await getHistory(days);
            return jsonResult({
              status: "ok",
              anomalies: history,
              count: history.length,
              periodDays: days,
            });
          }

          case "predict": {
            const dimension = readStringParam(params, "dimension", { required: true });
            const horizonMinutes = readNumberParam(params, "horizonMinutes") ?? 30;
            const prediction = await predict(dimension, horizonMinutes);
            return jsonResult({
              status: "ok",
              dimension,
              horizonMinutes,
              ...prediction,
            });
          }

          default:
            return jsonResult({
              status: "error",
              error: `Unknown action: ${action}`,
            });
        }
      } catch (err) {
        return jsonResult({
          status: "error",
          error: err instanceof Error ? err.message : String(err),
        });
      }
    },
  };
}
