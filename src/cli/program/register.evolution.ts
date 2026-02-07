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
    .option("--auto-mutate", "Automatically run mutation cycle to fix code issues after evolution")
    .action(async (opts) => {
      await cmdEvolution({
        action: "evolve",
        genotypeId: opts.genotypeId,
        autoMutate: opts.autoMutate ?? false,
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
    .command("mutate")
    .description("Run mutation cycle to fix code issues (self-modification)")
    .action(async () => {
      await cmdEvolution({
        action: "mutate",
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

  const monitor = evolution
    .command("monitor")
    .description("Manage telemetry monitoring for automatic error detection");

  monitor
    .command("start")
    .description("Start telemetry monitor (checks error rates automatically)")
    .option("--auto-mutate", "Enable automatic mutation cycles when hotspots detected")
    .action(async (opts) => {
      await cmdEvolution({
        action: "monitor",
        monitorAction: "start",
        autoMutate: opts.autoMutate ?? false,
      });
    });

  monitor
    .command("stop")
    .description("Stop telemetry monitor")
    .action(async () => {
      await cmdEvolution({
        action: "monitor",
        monitorAction: "stop",
      });
    });

  monitor
    .command("check")
    .description("Check current telemetry state (hotspots)")
    .action(async () => {
      await cmdEvolution({
        action: "monitor",
        monitorAction: "check",
      });
    });

  monitor
    .command("status")
    .description("Show telemetry monitor status")
    .action(async () => {
      await cmdEvolution({
        action: "monitor",
        monitorAction: "status",
      });
    });
}
