import fs from "node:fs/promises";
import path from "node:path";
import { log } from "../pi-embedded-runner/logger.js";
import { runEvolutionDojoTask } from "./dojo-runner.ts";
import { Mutator } from "./mutator.js";
import { validatePatch } from "./policy-guard.js";

/**
 * MutationWorkflow: Implements the full "Identify -> Diagnose -> Patch -> Verify" cycle.
 */
export class MutationWorkflow {
  private readonly mutator: Mutator;

  constructor(mutator: Mutator) {
    this.mutator = mutator;
  }

  async run() {
    log.info("[mutation] Starting self-modification cycle...");

    // 1. Identify hotspots (reflexive)
    const hotspots = await this.mutator.identifyHotspots({ threshold: 0.15 }); // Be eager
    if (hotspots.length === 0) {
      log.info("[mutation] No tool hotspots identified.");
      return;
    }

    for (const hotspot of hotspots) {
      log.info(
        `[mutation] Diagnosing hotspot: ${hotspot.toolName} (error rate: ${(hotspot.errorRate * 100).toFixed(1)}%)`,
      );

      // 2. Spawn Diagnostic Agent (Root Cause Analysis)
      const diagnostic = await this.mutator.spawnDiagnosticAgent(hotspot);
      if (!diagnostic.proposedFix) {
        log.warn(`[mutation] No fix proposed for ${hotspot.toolName}.`);
        continue;
      }

      // 3. Policy Guard (Validation)
      const validation = await validatePatch({
        patch: diagnostic.proposedFix,
        targetFiles: [this.mutator["mapToolToSourceFile"](hotspot.toolName) ?? ""],
      });

      if (!validation.allowed) {
        log.error(
          `[mutation] Patch for ${hotspot.toolName} blocked by policy: ${validation.reason}`,
        );
        continue;
      }

      // 4. Dojo Gate (Dojo Runner)
      log.info(`[mutation] Running Dojo verification for ${hotspot.toolName}...`);
      const stats = await runEvolutionDojoTask({
        task: {
          id: `verify-${hotspot.toolName}`,
          name: `Verification for ${hotspot.toolName}`,
          description: `Verify autonomous fix for ${hotspot.toolName}`,
          prompt: "Verify the code works.",
        },
        genotypeId: "current",
        patchPath: diagnostic.proposedFix, // Simulating path for now
        workspaceRoot: process.cwd(),
      });

      if (stats.success) {
        log.info(`[mutation] SUCCESS: Dojo verified fix for ${hotspot.toolName}. Committing...`);
        // In real implementation, this would trigger a git commit via Breeder/Mutator
      } else {
        log.error(
          `[mutation] FAILURE: Dojo failed to verify fix for ${hotspot.toolName}: ${stats.error}`,
        );
      }
    }
  }
}
