import type { Command } from "commander";
import { cmdEvolution } from "../../commands/evolution.js";
import { getFlagValue } from "../argv.js";

export function registerEvolutionCommand(program: Command) {
  const evolution = program
    .command("evolution")
    .description("Manage agent self-evolution system")
    .alias("evolve");

  evolution
    .command("status")
    .description("Show current genotype status and performance")
    .option("--genotype-id <id>", "Specific genotype ID to check")
    .action(async (opts) => {
      await cmdEvolution({
        action: "status",
        genotypeId: opts.genotypeId,
      });
    });

  evolution
    .command("evolve")
    .description("Run one evolution cycle (create variants, test, select winner)")
    .option("--genotype-id <id>", "Base genotype ID to evolve from")
    .action(async (opts) => {
      await cmdEvolution({
        action: "evolve",
        genotypeId: opts.genotypeId,
      });
    });

  evolution
    .command("dojo")
    .description("Run Dojo evaluation suite on current genotype")
    .option("--genotype-id <id>", "Genotype ID to test")
    .action(async (opts) => {
      await cmdEvolution({
        action: "dojo",
        genotypeId: opts.genotypeId,
      });
    });

  evolution
    .command("history")
    .description("Show evolution history")
    .action(async () => {
      await cmdEvolution({
        action: "history",
      });
    });

  evolution
    .command("stats")
    .description("Show session statistics")
    .option("--generation <n>", "Filter by generation number")
    .action(async (opts) => {
      const generation = opts.generation ? parseInt(opts.generation, 10) : undefined;
      await cmdEvolution({
        action: "stats",
        generation,
      });
    });
}
