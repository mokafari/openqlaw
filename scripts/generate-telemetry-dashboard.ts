#!/usr/bin/env node
/**
 * Generate telemetry-data.json for the evolution dashboard.
 * Reads real telemetry from ~/.openclaw/evolution/stats/session_stats.jsonl
 * and recovery state from ~/.openclaw/evolution/recovery-state.json
 */

import { promises as fs } from "node:fs";
import { join } from "node:path";
import { loadGenotype } from "../src/agents/evolution/genotype.js";
import {
  readSessionStats,
  getAggregatedStats,
  getToolErrorRates,
} from "../src/agents/evolution/telemetry.js";
import { resolveStateDir } from "../src/config/paths.js";

async function main() {
  const statsDir = join(resolveStateDir(), "evolution", "stats");
  const recoveryStatePath = join(resolveStateDir(), "evolution", "recovery-state.json");
  const outputPath = join(
    process.env.HOME || "",
    ".openclaw",
    "workspace",
    "canvas",
    "telemetry-data.json",
  );

  // Read all session stats
  const allStats = await readSessionStats({ statsDir });
  const last1000 = allStats.slice(-1000);

  // Calculate aggregated stats
  const aggregated = await getAggregatedStats({ statsDir });
  const last1000Aggregated =
    last1000.length > 0
      ? {
          successRate: Math.round(
            (last1000.filter((s) => s.success).length / last1000.length) * 100,
          ),
          toolCalls: Math.round(
            last1000.reduce((sum, s) => sum + s.toolCalls, 0) / last1000.length,
          ),
          avgDuration: Math.round(
            last1000.reduce((sum, s) => sum + s.durationMs, 0) / last1000.length,
          ),
        }
      : { successRate: 0, toolCalls: 0, avgDuration: 0 };

  // Get tool error rates (hotspots)
  const hotspots = await getToolErrorRates({ statsDir, threshold: 0.15, minCalls: 5 });

  // Load current genotype
  let genotype;
  try {
    genotype = await loadGenotype();
  } catch {
    genotype = {
      generation: 1,
      verbosity: 0.5,
      planningDepth: "medium",
      toolEagerness: 0.7,
    };
  }

  // Read recovery state
  let recoveryState: {
    currentRecovery?: { attempts: number; startedAt: number };
    history?: Array<{ success: boolean; attempts: number; startedAt: number }>;
  } = {};
  try {
    const recoveryContent = await fs.readFile(recoveryStatePath, "utf-8");
    recoveryState = JSON.parse(recoveryContent);
  } catch {
    // Recovery state doesn't exist yet
  }

  const recoveryHistory = recoveryState.history || [];
  const recoveryAttempts = recoveryHistory.length;
  const recoverySuccess = recoveryHistory.filter((r) => r.success).length;
  const lastRecovery =
    recoveryHistory.length > 0
      ? new Date(recoveryHistory[recoveryHistory.length - 1].startedAt).toLocaleString()
      : "Never";

  // Build telemetry data object
  const telemetryData = {
    totalSessions: allStats.length,
    last1000: last1000Aggregated,
    fitness: aggregated.avgFitness,
    genotype: {
      generation: genotype.generation,
      verbosity: genotype.verbosity,
      planningDepth: genotype.planningDepth,
      toolEagerness: genotype.toolEagerness,
    },
    hotspots: hotspots.slice(0, 5).map((h) => ({
      toolName: h.toolName,
      errorRate: Math.round(h.errorRate * 100),
      totalCalls: h.totalCalls,
    })),
    recoveryAttempts,
    recoverySuccess,
    lastRecovery,
    // FSM state would come from active sessions - placeholder for now
    fsmState: "idle",
    quakeNode: "NODE_STAND",
    timestamp: Date.now(),
  };

  // Write to canvas directory
  await fs.mkdir(join(outputPath, ".."), { recursive: true });
  await fs.writeFile(outputPath, JSON.stringify(telemetryData, null, 2), "utf-8");

  console.log(`✓ Generated telemetry-data.json`);
  console.log(`  Total sessions: ${telemetryData.totalSessions}`);
  console.log(`  Fitness: ${telemetryData.fitness.toFixed(2)}`);
  console.log(`  Recovery attempts: ${recoveryAttempts} (${recoverySuccess} successful)`);
}

main().catch((err) => {
  console.error("Failed to generate telemetry data:", err);
  process.exit(1);
});
