/**
 * Hypothesis Tracker Tool
 *
 * Persistent investigation state for debugging hypotheses across sessions.
 * Stores investigations in ~/.openclaw/state/evolution/investigations/
 */

import { Type } from "@sinclair/typebox";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { AnyAgentTool } from "./common.js";
import { resolveStateDir } from "../../config/paths.js";
import { jsonResult, readStringParam } from "./common.js";

// ============================================================================
// Types
// ============================================================================

export interface Hypothesis {
  id: string;
  description: string;
  probability: number; // 0.0 - 1.0
  status: "active" | "confirmed" | "refuted";
  evidence: string[];
  createdAt: number;
  updatedAt: number;
}

export interface Experiment {
  id: string;
  hypothesisId: string;
  action: string;
  result: "confirmed" | "refuted" | "inconclusive";
  notes: string;
  timestamp: number;
}

export interface Investigation {
  id: string;
  issue: string;
  status: "active" | "resolved" | "abandoned";
  hypotheses: Hypothesis[];
  experiments: Experiment[];
  createdAt: number;
  updatedAt: number;
  resolvedAt?: number;
  rootCause?: string;
}

// ============================================================================
// Storage Functions
// ============================================================================

function getInvestigationsDir(env: NodeJS.ProcessEnv = process.env): string {
  const stateDir = resolveStateDir(env);
  return path.join(stateDir, "state", "evolution", "investigations");
}

function ensureInvestigationsDir(env: NodeJS.ProcessEnv = process.env): string {
  const dir = getInvestigationsDir(env);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function getInvestigationPath(id: string, env: NodeJS.ProcessEnv = process.env): string {
  const dir = getInvestigationsDir(env);
  return path.join(dir, `${id}.json`);
}

function generateId(): string {
  return crypto.randomUUID();
}

// ============================================================================
// Core Functions (exported for direct use)
// ============================================================================

/**
 * Start a new investigation for an issue.
 */
export async function startInvestigation(
  issue: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<Investigation> {
  ensureInvestigationsDir(env);

  const now = Date.now();
  const investigation: Investigation = {
    id: generateId(),
    issue,
    status: "active",
    hypotheses: [],
    experiments: [],
    createdAt: now,
    updatedAt: now,
  };

  const filePath = getInvestigationPath(investigation.id, env);
  fs.writeFileSync(filePath, JSON.stringify(investigation, null, 2), "utf-8");

  return investigation;
}

/**
 * Get an investigation by ID.
 */
export async function getInvestigation(
  id: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<Investigation | null> {
  const filePath = getInvestigationPath(id, env);

  try {
    const content = fs.readFileSync(filePath, "utf-8");
    return JSON.parse(content) as Investigation;
  } catch {
    return null;
  }
}

/**
 * Save an investigation to disk.
 */
async function saveInvestigation(
  investigation: Investigation,
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  ensureInvestigationsDir(env);
  const filePath = getInvestigationPath(investigation.id, env);
  investigation.updatedAt = Date.now();
  fs.writeFileSync(filePath, JSON.stringify(investigation, null, 2), "utf-8");
}

/**
 * Add a hypothesis to an investigation.
 */
export async function addHypothesis(
  investigationId: string,
  description: string,
  probability: number = 0.5,
  env: NodeJS.ProcessEnv = process.env,
): Promise<Hypothesis> {
  const investigation = await getInvestigation(investigationId, env);
  if (!investigation) {
    throw new Error(`Investigation ${investigationId} not found`);
  }

  const now = Date.now();
  const hypothesis: Hypothesis = {
    id: generateId(),
    description,
    probability: Math.max(0, Math.min(1, probability)),
    status: "active",
    evidence: [],
    createdAt: now,
    updatedAt: now,
  };

  investigation.hypotheses.push(hypothesis);
  await saveInvestigation(investigation, env);

  return hypothesis;
}

/**
 * Find the investigation containing a hypothesis.
 */
async function findInvestigationByHypothesis(
  hypothesisId: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<{ investigation: Investigation; hypothesis: Hypothesis } | null> {
  const investigations = await listAllInvestigations(env);

  for (const inv of investigations) {
    const hypothesis = inv.hypotheses.find((h) => h.id === hypothesisId);
    if (hypothesis) {
      return { investigation: inv, hypothesis };
    }
  }

  return null;
}

/**
 * Update a hypothesis with new probability and evidence.
 */
export async function updateHypothesis(
  hypothesisId: string,
  probability: number,
  evidence: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  const result = await findInvestigationByHypothesis(hypothesisId, env);
  if (!result) {
    throw new Error(`Hypothesis ${hypothesisId} not found`);
  }

  const { investigation, hypothesis } = result;
  hypothesis.probability = Math.max(0, Math.min(1, probability));
  hypothesis.evidence.push(evidence);
  hypothesis.updatedAt = Date.now();

  // Auto-update status based on probability
  if (probability >= 0.9) {
    hypothesis.status = "confirmed";
  } else if (probability <= 0.1) {
    hypothesis.status = "refuted";
  }

  await saveInvestigation(investigation, env);
}

/**
 * Log an experiment for a hypothesis.
 */
export async function logExperiment(
  hypothesisId: string,
  action: string,
  result: "confirmed" | "refuted" | "inconclusive",
  notes: string = "",
  env: NodeJS.ProcessEnv = process.env,
): Promise<Experiment> {
  const found = await findInvestigationByHypothesis(hypothesisId, env);
  if (!found) {
    throw new Error(`Hypothesis ${hypothesisId} not found`);
  }

  const { investigation, hypothesis } = found;

  const experiment: Experiment = {
    id: generateId(),
    hypothesisId,
    action,
    result,
    notes,
    timestamp: Date.now(),
  };

  investigation.experiments.push(experiment);

  // Update hypothesis based on experiment result
  if (result === "confirmed") {
    hypothesis.probability = Math.min(1, hypothesis.probability + 0.2);
    hypothesis.evidence.push(`Experiment confirmed: ${action}`);
  } else if (result === "refuted") {
    hypothesis.probability = Math.max(0, hypothesis.probability - 0.3);
    hypothesis.evidence.push(`Experiment refuted: ${action}`);
  } else {
    hypothesis.evidence.push(`Experiment inconclusive: ${action}`);
  }

  // Auto-update status based on probability
  if (hypothesis.probability >= 0.9) {
    hypothesis.status = "confirmed";
  } else if (hypothesis.probability <= 0.1) {
    hypothesis.status = "refuted";
  }

  hypothesis.updatedAt = Date.now();
  await saveInvestigation(investigation, env);

  return experiment;
}

/**
 * Conclude an investigation with root cause.
 */
export async function conclude(
  investigationId: string,
  rootCause: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  const investigation = await getInvestigation(investigationId, env);
  if (!investigation) {
    throw new Error(`Investigation ${investigationId} not found`);
  }

  investigation.status = "resolved";
  investigation.rootCause = rootCause;
  investigation.resolvedAt = Date.now();

  await saveInvestigation(investigation, env);
}

/**
 * Abandon an investigation.
 */
export async function abandon(
  investigationId: string,
  reason: string = "",
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  const investigation = await getInvestigation(investigationId, env);
  if (!investigation) {
    throw new Error(`Investigation ${investigationId} not found`);
  }

  investigation.status = "abandoned";
  if (reason) {
    investigation.rootCause = `Abandoned: ${reason}`;
  }
  investigation.resolvedAt = Date.now();

  await saveInvestigation(investigation, env);
}

/**
 * List all investigations.
 */
async function listAllInvestigations(
  env: NodeJS.ProcessEnv = process.env,
): Promise<Investigation[]> {
  const dir = getInvestigationsDir(env);

  try {
    const files = fs.readdirSync(dir);
    const investigations: Investigation[] = [];

    for (const file of files) {
      if (file.endsWith(".json")) {
        try {
          const content = fs.readFileSync(path.join(dir, file), "utf-8");
          investigations.push(JSON.parse(content) as Investigation);
        } catch {
          // Skip invalid files
        }
      }
    }

    // Sort by updatedAt descending
    return investigations.sort((a, b) => b.updatedAt - a.updatedAt);
  } catch {
    return [];
  }
}

/**
 * List active investigations.
 */
export async function listActive(env: NodeJS.ProcessEnv = process.env): Promise<Investigation[]> {
  const all = await listAllInvestigations(env);
  return all.filter((inv) => inv.status === "active");
}

/**
 * List investigations by status.
 */
export async function listByStatus(
  status: "active" | "resolved" | "abandoned",
  env: NodeJS.ProcessEnv = process.env,
): Promise<Investigation[]> {
  const all = await listAllInvestigations(env);
  return all.filter((inv) => inv.status === status);
}

// ============================================================================
// Tool Definitions
// ============================================================================

const HypothesisTrackerSchema = Type.Object({
  action: Type.Union([
    Type.Literal("start"),
    Type.Literal("get"),
    Type.Literal("add_hypothesis"),
    Type.Literal("update_hypothesis"),
    Type.Literal("log_experiment"),
    Type.Literal("conclude"),
    Type.Literal("abandon"),
    Type.Literal("list_active"),
    Type.Literal("list"),
  ]),
  // For start
  issue: Type.Optional(
    Type.String({ description: "Issue description for starting investigation" }),
  ),
  // For get, add_hypothesis, conclude, abandon
  investigationId: Type.Optional(Type.String({ description: "Investigation ID" })),
  // For add_hypothesis, update_hypothesis
  hypothesis: Type.Optional(Type.String({ description: "Hypothesis description" })),
  hypothesisId: Type.Optional(Type.String({ description: "Hypothesis ID" })),
  probability: Type.Optional(
    Type.Number({ description: "Probability 0.0-1.0", minimum: 0, maximum: 1 }),
  ),
  evidence: Type.Optional(Type.String({ description: "Evidence string" })),
  // For log_experiment
  experimentAction: Type.Optional(Type.String({ description: "What action was taken" })),
  result: Type.Optional(
    Type.Union([Type.Literal("confirmed"), Type.Literal("refuted"), Type.Literal("inconclusive")]),
  ),
  notes: Type.Optional(Type.String({ description: "Experiment notes" })),
  // For conclude
  rootCause: Type.Optional(Type.String({ description: "Root cause description" })),
  // For abandon
  reason: Type.Optional(Type.String({ description: "Reason for abandoning" })),
  // For list
  status: Type.Optional(
    Type.Union([Type.Literal("active"), Type.Literal("resolved"), Type.Literal("abandoned")]),
  ),
});

export function createHypothesisTrackerTool(): AnyAgentTool {
  return {
    label: "Investigation",
    name: "hypothesis_tracker",
    description: `Track debugging hypotheses and investigations persistently.

Actions:
- start: Start new investigation (requires: issue)
- get: Get investigation details (requires: investigationId)
- add_hypothesis: Add hypothesis (requires: investigationId, hypothesis; optional: probability)
- update_hypothesis: Update hypothesis (requires: hypothesisId, probability, evidence)
- log_experiment: Log experiment (requires: hypothesisId, experimentAction, result; optional: notes)
- conclude: Resolve investigation (requires: investigationId, rootCause)
- abandon: Abandon investigation (requires: investigationId; optional: reason)
- list_active: List active investigations
- list: List investigations (optional: status filter)`,
    parameters: HypothesisTrackerSchema,
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const action = readStringParam(params, "action", { required: true });

      try {
        switch (action) {
          case "start": {
            const issue = readStringParam(params, "issue", { required: true });
            const investigation = await startInvestigation(issue);
            return jsonResult({
              status: "ok",
              message: `Started investigation ${investigation.id.slice(0, 8)}`,
              investigation: {
                id: investigation.id,
                issue: investigation.issue,
                status: investigation.status,
                createdAt: investigation.createdAt,
              },
            });
          }

          case "get": {
            const investigationId = readStringParam(params, "investigationId", { required: true });
            const investigation = await getInvestigation(investigationId);
            if (!investigation) {
              return jsonResult({
                status: "error",
                error: `Investigation ${investigationId} not found`,
              });
            }
            return jsonResult({
              status: "ok",
              investigation,
            });
          }

          case "add_hypothesis": {
            const investigationId = readStringParam(params, "investigationId", { required: true });
            const hypothesis = readStringParam(params, "hypothesis", { required: true });
            const probability = typeof params.probability === "number" ? params.probability : 0.5;

            const hyp = await addHypothesis(investigationId, hypothesis, probability);
            return jsonResult({
              status: "ok",
              message: `Added hypothesis ${hyp.id.slice(0, 8)}`,
              hypothesis: {
                id: hyp.id,
                description: hyp.description,
                probability: hyp.probability,
                status: hyp.status,
              },
            });
          }

          case "update_hypothesis": {
            const hypothesisId = readStringParam(params, "hypothesisId", { required: true });
            const probability = params.probability as number;
            const evidence = readStringParam(params, "evidence", { required: true });

            if (typeof probability !== "number") {
              return jsonResult({ status: "error", error: "probability is required" });
            }

            await updateHypothesis(hypothesisId, probability, evidence);
            return jsonResult({
              status: "ok",
              message: `Updated hypothesis ${hypothesisId.slice(0, 8)}`,
            });
          }

          case "log_experiment": {
            const hypothesisId = readStringParam(params, "hypothesisId", { required: true });
            const experimentAction = readStringParam(params, "experimentAction", {
              required: true,
            });
            const result = readStringParam(params, "result", { required: true }) as
              | "confirmed"
              | "refuted"
              | "inconclusive";
            const notes = readStringParam(params, "notes") || "";

            if (!["confirmed", "refuted", "inconclusive"].includes(result)) {
              return jsonResult({
                status: "error",
                error: "result must be confirmed, refuted, or inconclusive",
              });
            }

            const experiment = await logExperiment(hypothesisId, experimentAction, result, notes);
            return jsonResult({
              status: "ok",
              message: `Logged experiment ${experiment.id.slice(0, 8)}`,
              experiment: {
                id: experiment.id,
                action: experiment.action,
                result: experiment.result,
                timestamp: experiment.timestamp,
              },
            });
          }

          case "conclude": {
            const investigationId = readStringParam(params, "investigationId", { required: true });
            const rootCause = readStringParam(params, "rootCause", { required: true });

            await conclude(investigationId, rootCause);
            return jsonResult({
              status: "ok",
              message: `Concluded investigation ${investigationId.slice(0, 8)}`,
              rootCause,
            });
          }

          case "abandon": {
            const investigationId = readStringParam(params, "investigationId", { required: true });
            const reason = readStringParam(params, "reason") || "";

            await abandon(investigationId, reason);
            return jsonResult({
              status: "ok",
              message: `Abandoned investigation ${investigationId.slice(0, 8)}`,
            });
          }

          case "list_active": {
            const investigations = await listActive();
            return jsonResult({
              status: "ok",
              count: investigations.length,
              investigations: investigations.map((inv) => ({
                id: inv.id,
                issue: inv.issue,
                hypothesesCount: inv.hypotheses.length,
                activeHypotheses: inv.hypotheses.filter((h) => h.status === "active").length,
                experimentsCount: inv.experiments.length,
                createdAt: inv.createdAt,
                updatedAt: inv.updatedAt,
              })),
            });
          }

          case "list": {
            const status = params.status as "active" | "resolved" | "abandoned" | undefined;
            const investigations = status
              ? await listByStatus(status)
              : await listAllInvestigations();
            return jsonResult({
              status: "ok",
              count: investigations.length,
              filter: status || "all",
              investigations: investigations.map((inv) => ({
                id: inv.id,
                issue: inv.issue,
                status: inv.status,
                hypothesesCount: inv.hypotheses.length,
                experimentsCount: inv.experiments.length,
                rootCause: inv.rootCause,
                createdAt: inv.createdAt,
                updatedAt: inv.updatedAt,
                resolvedAt: inv.resolvedAt,
              })),
            });
          }

          default:
            return jsonResult({ status: "error", error: `Unknown action: ${action}` });
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
