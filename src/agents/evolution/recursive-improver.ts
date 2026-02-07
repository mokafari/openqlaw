import type { EvolutionResult } from "./breeder.js";
import type { MutationResult } from "./mutation-workflow.js";
import { loadConfig } from "../../config/config.js";
import { callGateway } from "../../gateway/call.js";
import { log } from "../pi-embedded-runner/logger.js";
import { Breeder } from "./breeder.js";
import { getGlobalCapabilityTracker } from "./capability-tracker.js";

export type RecursiveImprovementTask = {
  taskId: string;
  type: "self-modification" | "capability-enhancement" | "bug-fix" | "optimization";
  description: string;
  priority: "low" | "medium" | "high" | "critical";
  context: {
    currentFitness?: number;
    errorRate?: number;
    targetCapabilities?: string[];
    constraints?: string[];
  };
};

export type RecursiveImprovementResult = {
  taskId: string;
  success: boolean;
  subAgentSessionId?: string;
  improvements: {
    fitnessChange?: number;
    errorRateChange?: number;
    newCapabilities?: string[];
    mutationsApplied?: number;
  };
  error?: string;
};

/**
 * RecursiveImprover: Enables agents to spawn sub-agents for self-improvement.
 *
 * This implements Phase 5 of the AGI roadmap: Recursive Self-Improvement.
 *
 * The agent can:
 * 1. Identify areas for improvement
 * 2. Spawn sub-agents with specific improvement tasks
 * 3. Collect feedback from sub-agents
 * 4. Integrate improvements into the main system
 * 5. Track capability growth
 */
export class RecursiveImprover {
  private readonly workspaceDir: string;
  private readonly breeder: Breeder;
  private readonly capabilityTracker: ReturnType<typeof getGlobalCapabilityTracker>;

  constructor(params?: { workspaceDir?: string; statsDir?: string }) {
    this.workspaceDir = params?.workspaceDir ?? process.cwd();
    this.breeder = new Breeder({
      workspaceDir: this.workspaceDir,
      statsDir: params?.statsDir,
    });
    this.capabilityTracker = getGlobalCapabilityTracker({ statsDir: params?.statsDir });
  }

  /**
   * Spawn a sub-agent to improve a specific aspect of the system.
   */
  async spawnImprovementAgent(task: RecursiveImprovementTask): Promise<RecursiveImprovementResult> {
    try {
      log.info(`[recursive-improver] Spawning sub-agent for task: ${task.taskId} (${task.type})`);

      const cfg = loadConfig();
      const agentId = "main"; // Default agent
      const sessionId = `recursive-improvement-${task.taskId}-${Date.now()}`;

      // Build improvement prompt
      const prompt = this.buildImprovementPrompt(task);

      // Spawn sub-agent via gateway
      const spawnResult = await callGateway<{ sessionId: string; success: boolean }>({
        method: "agent",
        params: {
          sessionId,
          message: prompt,
          workspaceDir: this.workspaceDir,
          agentId,
        },
        timeoutMs: 300_000, // 5 minutes for improvement tasks
        config: cfg,
      });

      if (!spawnResult || !spawnResult.success) {
        return {
          taskId: task.taskId,
          success: false,
          error: "Failed to spawn sub-agent",
        };
      }

      // Wait for sub-agent to complete (in a real implementation, we'd poll or use events)
      // For now, we'll assume the sub-agent completes and reports back
      log.info(`[recursive-improver] Sub-agent spawned: ${sessionId}`);

      // Record capability metrics before improvement
      const baselineMetrics = await this.capabilityTracker.recordMetrics().catch(() => null);

      // The sub-agent will work on the improvement task
      // In a full implementation, we'd:
      // 1. Monitor the sub-agent's progress
      // 2. Collect its results
      // 3. Apply improvements
      // 4. Measure impact

      // For now, return a placeholder result
      // In practice, this would be populated from sub-agent feedback
      return {
        taskId: task.taskId,
        success: true,
        subAgentSessionId: sessionId,
        improvements: {
          // These would be measured from sub-agent results
          fitnessChange: 0,
          errorRateChange: 0,
          newCapabilities: [],
          mutationsApplied: 0,
        },
      };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      log.error(`[recursive-improver] Failed to spawn improvement agent: ${error}`);
      return {
        taskId: task.taskId,
        success: false,
        error,
      };
    }
  }

  /**
   * Run a recursive improvement cycle: identify improvements, spawn agents, integrate results.
   */
  async runImprovementCycle(params?: {
    maxConcurrentTasks?: number;
    focusAreas?: string[];
  }): Promise<RecursiveImprovementResult[]> {
    log.info("[recursive-improver] Starting recursive improvement cycle...");

    // 1. Identify improvement opportunities
    const tasks = await this.identifyImprovementOpportunities(params?.focusAreas);

    if (tasks.length === 0) {
      log.info("[recursive-improver] No improvement opportunities identified");
      return [];
    }

    log.info(`[recursive-improver] Identified ${tasks.length} improvement opportunity(ies)`);

    // 2. Spawn sub-agents for each task (with concurrency limit)
    const maxConcurrent = params?.maxConcurrentTasks ?? 2;
    const results: RecursiveImprovementResult[] = [];

    for (let i = 0; i < tasks.length; i += maxConcurrent) {
      const batch = tasks.slice(i, i + maxConcurrent);
      const batchResults = await Promise.all(batch.map((task) => this.spawnImprovementAgent(task)));
      results.push(...batchResults);
    }

    // 3. Integrate successful improvements
    const successfulResults = results.filter((r) => r.success);
    if (successfulResults.length > 0) {
      log.info(
        `[recursive-improver] ${successfulResults.length} improvement(s) completed successfully`,
      );
      await this.integrateImprovements(successfulResults);
    }

    // 4. Record capability metrics after improvements
    await this.capabilityTracker.recordMetrics().catch((err) => {
      log.warn(`[recursive-improver] Failed to record metrics: ${err}`);
    });

    return results;
  }

  /**
   * Identify improvement opportunities based on current system state.
   */
  private async identifyImprovementOpportunities(
    focusAreas?: string[],
  ): Promise<RecursiveImprovementTask[]> {
    const tasks: RecursiveImprovementTask[] = [];

    try {
      // Get current capability metrics
      const latestMetrics = await this.capabilityTracker.getLatestMetrics();

      // Get current genotype stats
      const { getAggregatedStats } = await import("./telemetry.js");
      const { loadGenotype } = await import("./genotype.js");
      const genotype = await loadGenotype().catch(() => null);
      if (!genotype) {
        return tasks;
      }

      const stats = await getAggregatedStats({
        genotypeId: genotype.genotypeId,
      });

      // Identify opportunities based on metrics
      if (stats.avgFitness < 0.7) {
        tasks.push({
          taskId: `fitness-improvement-${Date.now()}`,
          type: "capability-enhancement",
          description: `Improve overall fitness from ${stats.avgFitness.toFixed(3)} to >0.8`,
          priority: "high",
          context: {
            currentFitness: stats.avgFitness,
            targetCapabilities: ["higher-success-rate", "better-tool-usage"],
          },
        });
      }

      if (stats.successRate < 0.8) {
        tasks.push({
          taskId: `success-rate-improvement-${Date.now()}`,
          type: "bug-fix",
          description: `Improve success rate from ${(stats.successRate * 100).toFixed(1)}% to >85%`,
          priority: "high",
          context: {
            errorRate: 1 - stats.successRate,
            targetCapabilities: ["error-reduction", "better-error-handling"],
          },
        });
      }

      // Check for high error rates in specific tools
      const { getToolErrorRates } = await import("./telemetry.js");
      const hotspots = await getToolErrorRates({
        threshold: 0.2,
        minCalls: 5,
      });

      for (const hotspot of hotspots) {
        tasks.push({
          taskId: `tool-fix-${hotspot.toolName}-${Date.now()}`,
          type: "bug-fix",
          description: `Fix high error rate in ${hotspot.toolName} (${(hotspot.errorRate * 100).toFixed(1)}%)`,
          priority: hotspot.errorRate > 0.3 ? "critical" : "medium",
          context: {
            errorRate: hotspot.errorRate,
            targetCapabilities: [`${hotspot.toolName}-fix`],
          },
        });
      }

      // Filter by focus areas if specified
      if (focusAreas && focusAreas.length > 0) {
        return tasks.filter((task) =>
          focusAreas.some((area) => task.description.toLowerCase().includes(area.toLowerCase())),
        );
      }

      return tasks;
    } catch (err) {
      log.error(`[recursive-improver] Failed to identify opportunities: ${err}`);
      return [];
    }
  }

  /**
   * Build prompt for improvement sub-agent.
   */
  private buildImprovementPrompt(task: RecursiveImprovementTask): string {
    return `
# Recursive Self-Improvement Task

## Task ID: ${task.taskId}
## Type: ${task.type}
## Priority: ${task.priority}

## Description
${task.description}

## Current Context
${task.context.currentFitness !== undefined ? `- Current Fitness: ${task.context.currentFitness.toFixed(3)}` : ""}
${task.context.errorRate !== undefined ? `- Error Rate: ${(task.context.errorRate * 100).toFixed(1)}%` : ""}
${task.context.targetCapabilities ? `- Target Capabilities: ${task.context.targetCapabilities.join(", ")}` : ""}
${task.context.constraints ? `- Constraints: ${task.context.constraints.join(", ")}` : ""}

## Your Mission
As a sub-agent focused on self-improvement, your task is to:

1. **Analyze** the current system state and identify root causes
2. **Propose** specific improvements (code changes, configuration, etc.)
3. **Implement** the improvements using available tools
4. **Verify** that improvements work (run tests, check metrics)
5. **Report** back with:
   - What was changed
   - How it improves the system
   - Metrics before/after

## Available Tools
- You can use all standard OpenClaw tools
- You can modify code in allowed directories (see self-modification policy)
- You can run tests and validation
- You can spawn further sub-agents if needed

## Success Criteria
- ${task.type === "bug-fix" ? "Error rate reduced" : ""}
- ${task.type === "capability-enhancement" ? "Fitness improved" : ""}
- ${task.type === "optimization" ? "Performance improved" : ""}
- No regressions introduced

## Reporting
When complete, report your results using:
\`\`\`
openclaw system event --text "Improvement task ${task.taskId} completed: [summary]"
\`\`\`

Good luck! 🚀
    `.trim();
  }

  /**
   * Integrate successful improvements into the system.
   */
  private async integrateImprovements(results: RecursiveImprovementResult[]): Promise<void> {
    log.info(`[recursive-improver] Integrating ${results.length} improvement(s)...`);

    // Record improvements in capability tracker
    for (const result of results) {
      if (result.improvements.mutationsApplied && result.improvements.mutationsApplied > 0) {
        log.info(
          `[recursive-improver] Task ${result.taskId}: ${result.improvements.mutationsApplied} mutation(s) applied`,
        );
      }

      if (result.improvements.fitnessChange && result.improvements.fitnessChange > 0) {
        log.info(
          `[recursive-improver] Task ${result.taskId}: Fitness improved by ${result.improvements.fitnessChange.toFixed(3)}`,
        );
      }

      if (result.improvements.newCapabilities && result.improvements.newCapabilities.length > 0) {
        log.info(
          `[recursive-improver] Task ${result.taskId}: New capabilities: ${result.improvements.newCapabilities.join(", ")}`,
        );
      }
    }

    // Trigger evolution cycle if significant improvements
    const totalFitnessGain = results.reduce(
      (sum, r) => sum + (r.improvements.fitnessChange ?? 0),
      0,
    );

    if (totalFitnessGain > 0.1) {
      log.info(
        `[recursive-improver] Significant improvements detected (fitness gain: ${totalFitnessGain.toFixed(3)}). Triggering evolution cycle...`,
      );
      await this.breeder.evolveWithMutations({ autoMutate: true }).catch((err) => {
        log.warn(`[recursive-improver] Evolution cycle failed: ${err}`);
      });
    }
  }
}

/**
 * Global recursive improver instance.
 */
let globalImprover: RecursiveImprover | undefined;

export function getGlobalRecursiveImprover(params?: {
  workspaceDir?: string;
  statsDir?: string;
}): RecursiveImprover {
  if (!globalImprover) {
    globalImprover = new RecursiveImprover(params);
  }
  return globalImprover;
}
