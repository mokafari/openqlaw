/**
 * Meta-Learning Tool: Allows agents to log predictions and outcomes
 */

import { Type, type Static } from "@sinclair/typebox";
import { randomUUID } from "node:crypto";
import type { AnyAgentTool } from "../tools/common.js";
import { jsonResult } from "../tools/common.js";
import { MetaLearningSystem, type Prediction, type Outcome } from "./meta-learning.js";

const MetaLearningToolSchema = Type.Object({
  action: Type.Union([
    Type.Literal("log_prediction"),
    Type.Literal("log_outcome"),
    Type.Literal("get_calibration"),
    Type.Literal("get_journal"),
    Type.Literal("analyze_patterns"),
  ]),
  // For log_prediction
  taskType: Type.Optional(Type.String()),
  predictedSuccess: Type.Optional(Type.Number()),
  predictedDifficulty: Type.Optional(Type.Number()),
  predictedDurationMs: Type.Optional(Type.Number()),
  // For log_outcome
  taskId: Type.Optional(Type.String()),
  actualSuccess: Type.Optional(Type.Boolean()),
  actualDurationMs: Type.Optional(Type.Number()),
  // For get_calibration
  taskTypeFilter: Type.Optional(Type.String()),
  // For get_journal
  days: Type.Optional(Type.Number()),
});

export function createMetaLearningTool(): AnyAgentTool {
  const system = new MetaLearningSystem();

  return {
    label: "Meta-Learning",
    name: "meta_learning",
    description:
      "Log predictions and outcomes for meta-learning. Track calibration, analyze patterns, and access learning journal entries.",
    parameters: MetaLearningToolSchema,
    execute: async (_toolCallId, args) => {
      const params = args as Static<typeof MetaLearningToolSchema>;
      const action = params.action;

      try {
        if (action === "log_prediction") {
          console.log("[meta-learning-tool] log_prediction params:", JSON.stringify(params));
          const taskId = params.taskId ?? randomUUID();
          console.log("[meta-learning-tool] using taskId:", taskId);
          const prediction: Prediction = {
            taskId,
            taskType: params.taskType ?? "unknown",
            predictedSuccess: params.predictedSuccess ?? 0.5,
            predictedDifficulty: params.predictedDifficulty ?? 0.5,
            predictedDurationMs: params.predictedDurationMs ?? 60000,
            timestamp: Date.now(),
          };
          await system.logPrediction(prediction);
          return jsonResult({
            success: true,
            taskId,
            message: "Prediction logged",
          });
        }

        if (action === "log_outcome") {
          if (!params.taskId) {
            return jsonResult({
              success: false,
              error: "taskId required for log_outcome",
            });
          }
          const outcome: Outcome = {
            taskId: params.taskId,
            actualSuccess: params.actualSuccess ?? false,
            actualDurationMs: params.actualDurationMs ?? 0,
            timestamp: Date.now(),
          };
          await system.logOutcome(outcome);
          return jsonResult({
            success: true,
            message: "Outcome logged",
          });
        }

        if (action === "get_calibration") {
          const metrics = await system.getCalibrationMetrics(params.taskTypeFilter ?? "all");
          if (!metrics) {
            return jsonResult({
              success: false,
              error: "No calibration data available",
            });
          }
          return jsonResult({
            success: true,
            metrics,
          });
        }

        if (action === "get_journal") {
          const entries = await system.getRecentJournalEntries(params.days ?? 7);
          return jsonResult({
            success: true,
            entries,
          });
        }

        if (action === "analyze_patterns") {
          const analysis = await system.analyzePatterns();
          return jsonResult({
            success: true,
            analysis,
          });
        }

        return jsonResult({
          success: false,
          error: `Unknown action: ${action}`,
        });
      } catch (err) {
        return jsonResult({
          success: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    },
  };
}
