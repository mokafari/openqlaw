import { Breeder } from "../agents/evolution/breeder.js";
import { runDojoSuite, DOJO_TASKS } from "../agents/evolution/dojo.js";
import { loadGenotype, saveGenotype } from "../agents/evolution/genotype.js";
import { getGlobalTelemetryMonitor } from "../agents/evolution/telemetry-monitor.js";
import { getAggregatedStats, readSessionStats } from "../agents/evolution/telemetry.js";
import { createDefaultDeps } from "../cli/deps.js";
import { loadConfig } from "../config/config.js";

export async function cmdEvolution(args: {
  action: "status" | "evolve" | "dojo" | "history" | "stats" | "monitor" | "mutate";
  genotypeId?: string;
  generation?: number;
  monitorAction?: "start" | "stop" | "check" | "status";
  autoMutate?: boolean;
}): Promise<void> {
  const deps = createDefaultDeps();
  const cfg = loadConfig();

  switch (args.action) {
    case "status": {
      const genotype = await loadGenotype({ genotypeId: args.genotypeId });
      const stats = await getAggregatedStats({ genotypeId: genotype.genotypeId });

      console.log("Current Genotype:");
      console.log(`  ID: ${genotype.genotypeId}`);
      console.log(`  Generation: ${genotype.generation}`);
      console.log(`  Created: ${new Date(genotype.createdAt).toISOString()}`);
      if (genotype.lastFitness !== undefined) {
        console.log(`  Last Fitness: ${genotype.lastFitness.toFixed(3)}`);
      }
      console.log("\nTraits:");
      console.log(`  Verbosity: ${genotype.traits.verbosity.toFixed(2)}`);
      console.log(`  Planning Depth: ${genotype.traits.planningDepth}`);
      console.log(`  Tool Eagerness: ${genotype.traits.toolEagerness.toFixed(2)}`);
      console.log(`  Chain-of-Thought: ${genotype.traits.chainOfThought.toFixed(2)}`);
      console.log("\nSystem Prompt:");
      console.log(`  Tone: ${genotype.systemPrompt.tone}`);
      console.log(`  Emphasize Tools: ${genotype.systemPrompt.emphasizeTools}`);
      console.log(`  Emphasize Planning: ${genotype.systemPrompt.emphasizePlanning}`);

      if (stats.count > 0) {
        console.log("\nPerformance Stats:");
        console.log(`  Sessions: ${stats.count}`);
        console.log(`  Avg Fitness: ${stats.avgFitness.toFixed(3)}`);
        console.log(`  Success Rate: ${(stats.successRate * 100).toFixed(1)}%`);
        console.log(`  Avg Tokens: ${Math.round(stats.avgTokens)}`);
        console.log(`  Avg Tool Calls: ${stats.avgToolCalls.toFixed(1)}`);
        console.log(`  Avg Duration: ${Math.round(stats.avgDuration)}ms`);
      }
      break;
    }

    case "evolve": {
      console.log("Starting evolution cycle...");
      const breeder = new Breeder();

      // Check if auto-mutation is enabled via config or flag
      const autoMutate = args.autoMutate ?? false;

      if (autoMutate) {
        console.log("Auto-mutation enabled - will fix code issues after evolution");
        const result = await breeder.evolveWithMutations({
          baseGenotypeId: args.genotypeId,
          autoMutate: true,
        });

        console.log(`\nEvolution Complete - Generation ${result.evolution.generation}`);
        console.log("\nWinner:");
        console.log(`  ID: ${result.evolution.winner.genotypeId}`);
        console.log(`  Fitness: ${result.evolution.winner.lastFitness?.toFixed(3) ?? "N/A"}`);

        console.log("\nCandidates:");
        for (const candidate of result.evolution.candidates) {
          console.log(
            `  ${candidate.genotype.genotypeId}: fitness=${candidate.fitness.toFixed(3)}, success=${(candidate.stats.successRate * 100).toFixed(1)}%`,
          );
        }

        console.log(
          `\nNext Generation: ${result.evolution.nextGeneration.length} variants created`,
        );
        for (const next of result.evolution.nextGeneration) {
          await saveGenotype(next);
          console.log(`  - ${next.genotypeId} (gen ${next.generation})`);
        }

        if (result.mutations) {
          console.log(`\nMutation Cycle Results:`);
          console.log(`  Total: ${result.mutations.summary.total}`);
          console.log(`  Successful: ${result.mutations.summary.successful}`);
          console.log(`  Failed: ${result.mutations.summary.failed}`);
          console.log(`  System Recoveries: ${result.mutations.summary.systemRecoveries}`);

          if (result.mutations.summary.successful > 0) {
            console.log(`\n✅ Code improvements applied successfully!`);
          }
        }
      } else {
        const result = await breeder.evolve({ baseGenotypeId: args.genotypeId });

        console.log(`\nEvolution Complete - Generation ${result.generation}`);
        console.log("\nWinner:");
        console.log(`  ID: ${result.winner.genotypeId}`);
        console.log(`  Fitness: ${result.winner.lastFitness?.toFixed(3) ?? "N/A"}`);

        console.log("\nCandidates:");
        for (const candidate of result.candidates) {
          console.log(
            `  ${candidate.genotype.genotypeId}: fitness=${candidate.fitness.toFixed(3)}, success=${(candidate.stats.successRate * 100).toFixed(1)}%`,
          );
        }

        console.log(`\nNext Generation: ${result.nextGeneration.length} variants created`);
        for (const next of result.nextGeneration) {
          await saveGenotype(next);
          console.log(`  - ${next.genotypeId} (gen ${next.generation})`);
        }
      }
      break;
    }

    case "dojo": {
      console.log("Running Dojo evaluation suite...");
      const genotype = await loadGenotype({ genotypeId: args.genotypeId });
      const result = await runDojoSuite(genotype);

      console.log(`\nDojo Results for ${genotype.genotypeId}:`);
      console.log(`  Avg Fitness: ${result.avgFitness.toFixed(3)}`);
      console.log(`  Success Rate: ${(result.successRate * 100).toFixed(1)}%`);

      console.log("\nTask Results:");
      for (const taskResult of result.results) {
        const task = DOJO_TASKS.find((t) => t.id === taskResult.taskId);
        const status = taskResult.success ? "✓" : "✗";
        console.log(
          `  ${status} ${task?.name ?? taskResult.taskId}: fitness=${taskResult.fitness.toFixed(3)}`,
        );
      }
      break;
    }

    case "history": {
      const breeder = new Breeder();
      const history = await breeder.getHistory();

      console.log("Evolution History:");
      for (const entry of history) {
        const fitnessStr =
          entry.fitness !== undefined ? ` (fitness: ${entry.fitness.toFixed(3)})` : "";
        console.log(`  Gen ${entry.generation}: ${entry.genotypeId}${fitnessStr}`);
      }
      break;
    }

    case "stats": {
      const stats = await readSessionStats({ limit: args.generation ? undefined : 50 });
      const filtered = args.generation
        ? stats.filter((s) => s.generation === args.generation)
        : stats.slice(-50);

      if (filtered.length === 0) {
        console.log("No stats found.");
        break;
      }

      console.log(`Session Stats (${filtered.length} entries):`);
      for (const stat of filtered.slice(-10)) {
        const success = stat.success ? "✓" : "✗";
        const fitness = stat.fitness !== undefined ? ` fitness=${stat.fitness.toFixed(2)}` : "";
        console.log(
          `  ${success} ${stat.sessionId.slice(0, 12)}... tokens=${stat.tokenUsage.total} tools=${stat.toolCalls}${fitness}`,
        );
      }

      if (args.generation) {
        const aggregated = await getAggregatedStats({ generation: args.generation });
        console.log(`\nGeneration ${args.generation} Summary:`);
        console.log(`  Sessions: ${aggregated.count}`);
        console.log(`  Avg Fitness: ${aggregated.avgFitness.toFixed(3)}`);
        console.log(`  Success Rate: ${(aggregated.successRate * 100).toFixed(1)}%`);
      }
      break;
    }

    case "monitor": {
      const monitor = getGlobalTelemetryMonitor({
        errorRateThreshold: 0.2,
        minToolCalls: 5,
        checkIntervalMs: 60_000,
        autoMutate: args.autoMutate ?? false,
      });

      const action = args.monitorAction ?? "status";

      switch (action) {
        case "start": {
          monitor.start();
          console.log("Telemetry monitor started");
          console.log("  - Checking every 60 seconds");
          console.log(`  - Error rate threshold: 20%`);
          console.log(`  - Auto-mutation: ${args.autoMutate ? "enabled" : "disabled"}`);
          break;
        }

        case "stop": {
          monitor.stop();
          console.log("Telemetry monitor stopped");
          break;
        }

        case "check": {
          const result = await monitor.check();
          if (result.hotspots.length === 0) {
            console.log("✓ No tool hotspots detected");
          } else {
            console.log(`⚠️  Detected ${result.hotspots.length} tool hotspot(s):`);
            for (const hotspot of result.hotspots) {
              console.log(
                `  - ${hotspot.toolName}: ${(hotspot.errorRate * 100).toFixed(1)}% (${hotspot.errorCount}/${hotspot.totalCalls} calls)`,
              );
            }
            if (result.shouldTriggerDiagnostic) {
              console.log("\n→ Should trigger diagnostic state");
            }
            if (result.shouldTriggerMutation) {
              console.log("→ Should trigger mutation cycle");
            }
          }
          break;
        }

        case "status": {
          const isActive = monitor.isActive();
          const lastCheck = monitor.getLastCheckTime();
          console.log(`Telemetry Monitor Status:`);
          console.log(`  Active: ${isActive ? "✓ Yes" : "✗ No"}`);
          if (lastCheck > 0) {
            const age = Date.now() - lastCheck;
            console.log(
              `  Last Check: ${age < 60000 ? `${Math.round(age / 1000)}s ago` : `${Math.round(age / 60000)}m ago`}`,
            );
          } else {
            console.log(`  Last Check: Never`);
          }

          // Show current state
          const result = await monitor.check();
          if (result.hotspots.length > 0) {
            console.log(`\n⚠️  ${result.hotspots.length} hotspot(s) detected`);
          } else {
            console.log(`\n✓ No hotspots`);
          }
          break;
        }
      }
      break;
    }

    case "mutate": {
      console.log("Starting mutation cycle (self-modification)...");
      const breeder = new Breeder();
      const result = await breeder.runMutationCycle();

      console.log(`\nMutation Cycle Complete`);
      console.log(`  Total: ${result.summary.total}`);
      console.log(`  Successful: ${result.summary.successful}`);
      console.log(`  Failed: ${result.summary.failed}`);
      console.log(`  System Recoveries: ${result.summary.systemRecoveries}`);

      if (result.results.length > 0) {
        console.log("\nResults:");
        for (const mutation of result.results) {
          const status = mutation.success ? "✅" : "❌";
          const patchInfo = mutation.patchId ? ` (patch: ${mutation.patchId})` : "";
          const buildInfo = mutation.buildVerified ? " [build verified]" : "";
          const commitInfo = mutation.committed ? " [committed]" : "";
          console.log(
            `  ${status} ${mutation.patchId ?? "system recovery"}${patchInfo}${buildInfo}${commitInfo}`,
          );
          if (mutation.error) {
            console.log(`     Error: ${mutation.error}`);
          }
        }
      }

      if (result.summary.successful > 0) {
        console.log(`\n✅ ${result.summary.successful} mutation(s) applied successfully!`);
        console.log("Gateway will restart to apply changes...");
      } else if (result.summary.total === 0) {
        console.log("\nℹ️  No hotspots detected - no mutations needed");
      } else {
        console.log("\n⚠️  No mutations were successful");
      }
      break;
    }
  }
}
