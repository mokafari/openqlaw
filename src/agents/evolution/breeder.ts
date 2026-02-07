import type { AgentGenotype } from "./genotype.js";
import type { SessionStatsEntry } from "./telemetry.js";
import { interbreedGenotypes, mutateGenotype, loadGenotype, saveGenotype } from "./genotype.js";
import { MutationWorkflow, type MutationResult } from "./mutation-workflow.js";
import { Mutator, type MutationCycleResult } from "./mutator.js";
import { getAggregatedStats, readSessionStats } from "./telemetry.js";

export type EvolutionResult = {
  generation: number;
  winner: AgentGenotype;
  candidates: Array<{
    genotype: AgentGenotype;
    fitness: number;
    stats: {
      count: number;
      avgFitness: number;
      successRate: number;
    };
  }>;
  nextGeneration: AgentGenotype[];
};

/**
 * Breeder agent: manages evolution cycle by creating variants, testing them,
 * and selecting winners.
 */
export class Breeder {
  private readonly statsDir?: string;
  private readonly genotypeDir?: string;
  private readonly workspaceDir?: string;
  private readonly policyPath?: string;

  constructor(params?: {
    statsDir?: string;
    genotypeDir?: string;
    workspaceDir?: string;
    policyPath?: string;
  }) {
    this.statsDir = params?.statsDir;
    this.genotypeDir = params?.genotypeDir;
    this.workspaceDir = params?.workspaceDir;
    this.policyPath = params?.policyPath;
  }

  /**
   * Create 3 variants of the current best genotype for testing.
   */
  async createVariants(baseGenotypeId?: string): Promise<AgentGenotype[]> {
    const base = await loadGenotype({ genotypeId: baseGenotypeId, genotypeDir: this.genotypeDir });

    // Variant A: Higher tool eagerness
    const variantA = mutateGenotype(base, 0.15);
    variantA.traits.toolEagerness = Math.min(1.0, base.traits.toolEagerness + 0.2);
    variantA.genotypeId = `variant-a-${Date.now()}`;

    // Variant B: Different system prompt phrasing
    const variantB = mutateGenotype(base, 0.15);
    variantB.systemPrompt.tone = base.systemPrompt.tone === "concise" ? "explanatory" : "concise";
    variantB.genotypeId = `variant-b-${Date.now()}`;

    // Variant C: Control (current best, slightly mutated)
    const variantC = mutateGenotype(base, 0.05);
    variantC.genotypeId = `variant-c-${Date.now()}`;

    // Save variants
    await saveGenotype(variantA, { genotypeDir: this.genotypeDir });
    await saveGenotype(variantB, { genotypeDir: this.genotypeDir });
    await saveGenotype(variantC, { genotypeDir: this.genotypeDir });

    return [variantA, variantB, variantC];
  }

  /**
   * Evaluate genotypes by reading their performance stats.
   */
  async evaluateGenotypes(genotypeIds: string[]): Promise<
    Array<{
      genotype: AgentGenotype;
      fitness: number;
      stats: Awaited<ReturnType<typeof getAggregatedStats>>;
    }>
  > {
    const results = await Promise.all(
      genotypeIds.map(async (id) => {
        const genotype = await loadGenotype({ genotypeId: id, genotypeDir: this.genotypeDir });
        const stats = await getAggregatedStats({ genotypeId: id, statsDir: this.statsDir });

        // Use average fitness if available, otherwise calculate from stats
        // Fallback formula: success (40%) + efficiency (30%) + neutral satisfaction (30%)
        const efficiencyScore = Math.max(0, 1 - stats.avgTokens / 1_000_000);
        const fitness =
          stats.avgFitness > 0
            ? stats.avgFitness
            : stats.successRate * 0.4 + efficiencyScore * 0.3 + 0.5 * 0.3;

        return { genotype, fitness, stats };
      }),
    );

    return results.sort((a, b) => b.fitness - a.fitness); // Sort by fitness descending
  }

  /**
   * Run one evolution cycle: create variants, evaluate, select winner, create next generation.
   */
  async evolve(params?: {
    baseGenotypeId?: string;
    populationSize?: number;
    mutationRate?: number;
  }): Promise<EvolutionResult> {
    const populationSize = params?.populationSize ?? 3;
    const mutationRate = params?.mutationRate ?? 0.1;

    // Create variants
    const variants = await this.createVariants(params?.baseGenotypeId);
    const variantIds = variants.map((v) => v.genotypeId);

    // Evaluate (this would normally wait for test results, but for now we read existing stats)
    const evaluations = await this.evaluateGenotypes(variantIds);

    // Select winner (highest fitness, or first variant if no evaluations)
    const winner = evaluations.length > 0 ? evaluations[0].genotype : variants[0];
    winner.lastFitness = evaluations.length > 0 ? evaluations[0].fitness : 0;

    // Create next generation
    const nextGeneration: AgentGenotype[] = [];

    if (evaluations.length >= 2) {
      // Interbreed top 2
      const child = interbreedGenotypes(evaluations[0].genotype, evaluations[1].genotype);
      nextGeneration.push(child);

      // Add mutations of winner
      for (let i = 1; i < populationSize; i++) {
        const mutated = mutateGenotype(winner, mutationRate);
        nextGeneration.push(mutated);
      }
    } else {
      // Not enough data, just mutate winner
      for (let i = 0; i < populationSize; i++) {
        const mutated = mutateGenotype(winner, mutationRate);
        nextGeneration.push(mutated);
      }
    }

    // Save winner as "current" for next cycle (create a copy to avoid mutating original)
    const currentGenotype: AgentGenotype = {
      ...winner,
      genotypeId: "current",
    };
    await saveGenotype(currentGenotype, { genotypeDir: this.genotypeDir });

    return {
      generation: winner.generation,
      winner: currentGenotype,
      candidates: evaluations.map((e) => ({
        genotype: e.genotype,
        fitness: e.fitness,
        stats: {
          count: e.stats.count,
          avgFitness: e.stats.avgFitness,
          successRate: e.stats.successRate,
        },
      })),
      nextGeneration,
    };
  }

  /**
   * Get evolution history.
   */
  async getHistory(): Promise<Array<{ generation: number; genotypeId: string; fitness?: number }>> {
    const allStats = await readSessionStats({ statsDir: this.statsDir });
    const byGenotype = new Map<string, { generation: number; fitness: number[] }>();

    for (const stat of allStats) {
      if (stat.genotypeId && stat.generation) {
        const existing = byGenotype.get(stat.genotypeId) ?? {
          generation: stat.generation,
          fitness: [],
        };
        if (stat.fitness !== undefined) {
          existing.fitness.push(stat.fitness);
        }
        byGenotype.set(stat.genotypeId, existing);
      }
    }

    return Array.from(byGenotype.entries())
      .map(([genotypeId, data]) => ({
        generation: data.generation,
        genotypeId,
        fitness:
          data.fitness.length > 0
            ? data.fitness.reduce((a, b) => a + b, 0) / data.fitness.length
            : undefined,
      }))
      .sort((a, b) => a.generation - b.generation);
  }

  /**
   * Identify tools with high error rates (hotspots).
   */
  async identifyHotspots(params?: {
    threshold?: number;
    minCalls?: number;
  }): Promise<
    Array<{ toolName: string; errorRate: number; totalCalls: number; errorCount: number }>
  > {
    const mutator = new Mutator({
      statsDir: this.statsDir,
      policyPath: this.policyPath,
      workspaceDir: this.workspaceDir,
    });
    return mutator.identifyHotspots(params);
  }

  /**
   * Run a mutation cycle: identify hotspots, diagnose, propose fixes, validate, and apply.
   * This can be called before or after a regular evolution cycle to fix bugs in the codebase.
   * Uses MutationWorkflow for comprehensive self-modification with system recovery.
   */
  async runMutationCycle(): Promise<{
    results: MutationResult[];
    summary: {
      total: number;
      successful: number;
      failed: number;
      skipped: number;
      throttled: number;
      systemRecoveries: number;
    };
  }> {
    const mutator = new Mutator({
      statsDir: this.statsDir,
      policyPath: this.policyPath,
      workspaceDir: this.workspaceDir,
    });

    const workflow = new MutationWorkflow(mutator, this.workspaceDir);
    const results = await workflow.run();

    const summary = {
      total: results.length,
      successful: results.filter((r) => r.status === "success").length,
      failed: results.filter((r) => r.status === "failed").length,
      skipped: results.filter((r) => r.status === "skipped").length,
      throttled: results.filter((r) => r.status === "throttled").length,
      systemRecoveries: results.filter((r) => r.success && !r.patchId).length, // System recoveries don't have patchId
    };

    return { results, summary };
  }

  /**
   * Run evolution cycle with automatic mutation if error rates are high.
   * This combines genotype evolution with code mutation for comprehensive self-improvement.
   */
  async evolveWithMutations(params?: {
    baseGenotypeId?: string;
    populationSize?: number;
    mutationRate?: number;
    autoMutate?: boolean;
    mutationThreshold?: number; // Error rate threshold to trigger mutations
  }): Promise<{
    evolution: EvolutionResult;
    mutations?: {
      results: MutationResult[];
      summary: {
        total: number;
        successful: number;
        failed: number;
        skipped: number;
        throttled: number;
        systemRecoveries: number;
      };
    };
  }> {
    // First, run regular evolution
    const evolution = await this.evolve({
      baseGenotypeId: params?.baseGenotypeId,
      populationSize: params?.populationSize,
      mutationRate: params?.mutationRate,
    });

    // Check if we should run mutations
    if (params?.autoMutate) {
      const mutator = new Mutator({
        statsDir: this.statsDir,
        policyPath: this.policyPath,
        workspaceDir: this.workspaceDir,
      });

      const threshold = params.mutationThreshold ?? 0.2; // 20% default
      const hotspots = await mutator.identifyHotspots({ threshold });

      if (hotspots.length > 0) {
        // Run mutation cycle to fix code issues
        const mutations = await this.runMutationCycle();
        return { evolution, mutations };
      }
    }

    return { evolution };
  }
}
