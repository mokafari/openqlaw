import { Breeder } from "../agents/evolution/breeder.js";
import { runDojoSuite, DOJO_TASKS } from "../agents/evolution/dojo.js";
import { loadGenotype, saveGenotype } from "../agents/evolution/genotype.js";
import { getAggregatedStats, readSessionStats } from "../agents/evolution/telemetry.js";
import { createDefaultDeps } from "../cli/deps.js";
import { loadConfig } from "../config/config.js";

export async function cmdEvolution(args: {
  action: "status" | "evolve" | "dojo" | "history" | "stats";
  genotypeId?: string;
  generation?: number;
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
  }
}
