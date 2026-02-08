/**
 * Algorithm Distillation Module
 *
 * Implements the Algorithm Distillation pattern (Laskin et al. 2022) for
 * in-context reinforcement learning from successful session histories.
 *
 * Key concepts:
 * - Extract high-performing session trajectories
 * - Create few-shot prompt templates from successes
 * - Retrieve and inject during similar tasks
 * - Learn from learning histories without weight updates
 *
 * Research basis:
 * - "In-context Reinforcement Learning with Algorithm Distillation"
 * - arXiv:2210.14215
 */

import fs from "node:fs/promises";
import path from "node:path";
import { log } from "../pi-embedded-runner/logger.js";
import { DEFAULT_AGENT_WORKSPACE_DIR } from "../workspace.js";

export interface SuccessfulTrajectory {
  id: string;
  timestamp: string;
  taskType: string;
  taskDescription: string;
  steps: DistillationStep[];
  totalDuration: number;
  toolsUsed: string[];
  fitness: number; // 0.0 - 1.0
  tokens?: number;
  keyPatterns: string[]; // Extracted successful patterns
}

export interface DistillationStep {
  thought?: string;
  action: string;
  tool?: string;
  observation?: string;
  success: boolean;
}

export interface TaskTemplate {
  taskType: string;
  description: string;
  examples: SuccessfulTrajectory[];
  avgDuration: number;
  avgTokens: number;
  commonTools: string[];
  successPatterns: string[];
  createdAt: string;
  updatedAt: string;
}

/**
 * Task type classifier based on keywords and patterns
 */
export function classifyTask(task: string): string {
  const lowerTask = task.toLowerCase();

  const classifiers: Array<{ type: string; keywords: string[] }> = [
    { type: "file-operation", keywords: ["read", "write", "file", "create", "edit", "modify"] },
    { type: "code-generation", keywords: ["code", "implement", "function", "class", "script"] },
    { type: "debugging", keywords: ["debug", "fix", "error", "bug", "issue", "broken"] },
    { type: "research", keywords: ["research", "find", "search", "investigate", "analyze"] },
    { type: "communication", keywords: ["message", "notify", "send", "tell", "inform"] },
    { type: "scheduling", keywords: ["schedule", "cron", "reminder", "alarm", "timer"] },
    { type: "system-admin", keywords: ["config", "setup", "install", "deploy", "restart"] },
    { type: "reasoning", keywords: ["think", "plan", "decide", "evaluate", "compare"] },
    { type: "memory-ops", keywords: ["remember", "recall", "memory", "store", "retrieve"] },
    { type: "self-improvement", keywords: ["improve", "optimize", "enhance", "upgrade", "evolve"] },
  ];

  for (const { type, keywords } of classifiers) {
    if (keywords.some((kw) => lowerTask.includes(kw))) {
      return type;
    }
  }

  return "general";
}

/**
 * Extract key patterns from a successful trajectory
 */
export function extractPatterns(trajectory: DistillationStep[]): string[] {
  const patterns: string[] = [];

  // Pattern: Sequential tool usage
  const tools = trajectory.filter((s) => s.tool).map((s) => s.tool!);
  if (tools.length >= 2) {
    for (let i = 0; i < tools.length - 1; i++) {
      patterns.push(`${tools[i]} → ${tools[i + 1]}`);
    }
  }

  // Pattern: Thought before action
  const hasThoughtPattern = trajectory.some((s, i) => {
    return s.thought && trajectory[i + 1]?.tool && trajectory[i + 1]?.success;
  });
  if (hasThoughtPattern) {
    patterns.push("think-then-act");
  }

  // Pattern: Error recovery
  const hasRecovery = trajectory.some((s, i) => {
    return !s.success && trajectory[i + 1]?.success;
  });
  if (hasRecovery) {
    patterns.push("error-recovery");
  }

  // Pattern: Efficient completion
  if (trajectory.length <= 3 && trajectory[trajectory.length - 1]?.success) {
    patterns.push("efficient-completion");
  }

  // Pattern: Tool diversity
  const uniqueTools = new Set(tools);
  if (uniqueTools.size >= 3) {
    patterns.push("multi-tool-orchestration");
  }

  return [...new Set(patterns)];
}

export class AlgorithmDistillation {
  private trajectoriesPath: string;
  private templatesPath: string;
  private templates: Map<string, TaskTemplate> = new Map();

  constructor(workspacePath?: string) {
    const resolvedPath = workspacePath || DEFAULT_AGENT_WORKSPACE_DIR;
    this.trajectoriesPath = path.join(resolvedPath, "memory", "successful-trajectories.jsonl");
    this.templatesPath = path.join(resolvedPath, "memory", "task-templates.json");
  }

  /**
   * Initialize by loading existing templates
   */
  async initialize(): Promise<void> {
    try {
      const content = await fs.readFile(this.templatesPath, "utf-8");
      const templates = JSON.parse(content) as TaskTemplate[];
      for (const t of templates) {
        this.templates.set(t.taskType, t);
      }
      log.info(`[distillation] Loaded ${this.templates.size} task templates`);
    } catch {
      log.info("[distillation] No existing templates, starting fresh");
    }
  }

  /**
   * Log a successful trajectory for distillation
   */
  async logSuccessfulTrajectory(
    taskDescription: string,
    steps: DistillationStep[],
    metadata: {
      duration: number;
      tokens?: number;
      fitness?: number;
    },
  ): Promise<void> {
    const taskType = classifyTask(taskDescription);
    const patterns = extractPatterns(steps);

    const trajectory: SuccessfulTrajectory = {
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      taskType,
      taskDescription: taskDescription.slice(0, 500),
      steps,
      totalDuration: metadata.duration,
      tokens: metadata.tokens,
      fitness: metadata.fitness ?? 1.0,
      toolsUsed: [...new Set(steps.filter((s) => s.tool).map((s) => s.tool!))],
      keyPatterns: patterns,
    };

    try {
      await fs.mkdir(path.dirname(this.trajectoriesPath), { recursive: true });
      await fs.appendFile(this.trajectoriesPath, JSON.stringify(trajectory) + "\n");

      // Update template
      await this.updateTemplate(trajectory);

      log.info(
        `[distillation] Logged trajectory for ${taskType}: ${patterns.length} patterns extracted`,
      );
    } catch (error) {
      log.error(`[distillation] Failed to log trajectory: ${error}`);
    }
  }

  /**
   * Update task template with new trajectory
   */
  private async updateTemplate(trajectory: SuccessfulTrajectory): Promise<void> {
    let template = this.templates.get(trajectory.taskType);

    if (!template) {
      template = {
        taskType: trajectory.taskType,
        description: trajectory.taskDescription,
        examples: [],
        avgDuration: 0,
        avgTokens: 0,
        commonTools: [],
        successPatterns: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
    }

    // Add example (keep top 5 by fitness)
    template.examples.push(trajectory);
    template.examples.sort((a, b) => b.fitness - a.fitness);
    template.examples = template.examples.slice(0, 5);

    // Update averages
    const durations = template.examples.map((e) => e.totalDuration);
    template.avgDuration = durations.reduce((a, b) => a + b, 0) / durations.length;

    const tokens = template.examples.filter((e) => e.tokens).map((e) => e.tokens!);
    if (tokens.length > 0) {
      template.avgTokens = tokens.reduce((a, b) => a + b, 0) / tokens.length;
    }

    // Aggregate common tools
    const toolCounts: Record<string, number> = {};
    for (const ex of template.examples) {
      for (const tool of ex.toolsUsed) {
        toolCounts[tool] = (toolCounts[tool] || 0) + 1;
      }
    }
    template.commonTools = Object.entries(toolCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([tool]) => tool);

    // Aggregate patterns
    const patternCounts: Record<string, number> = {};
    for (const ex of template.examples) {
      for (const pattern of ex.keyPatterns) {
        patternCounts[pattern] = (patternCounts[pattern] || 0) + 1;
      }
    }
    template.successPatterns = Object.entries(patternCounts)
      .filter(([_, count]) => count >= 2)
      .map(([pattern]) => pattern);

    template.updatedAt = new Date().toISOString();
    this.templates.set(trajectory.taskType, template);

    // Persist templates
    await this.saveTemplates();
  }

  /**
   * Save templates to disk
   */
  private async saveTemplates(): Promise<void> {
    try {
      await fs.mkdir(path.dirname(this.templatesPath), { recursive: true });
      const templates = Array.from(this.templates.values());
      await fs.writeFile(this.templatesPath, JSON.stringify(templates, null, 2));
    } catch (error) {
      log.error(`[distillation] Failed to save templates: ${error}`);
    }
  }

  /**
   * Get relevant examples for a task (few-shot retrieval)
   */
  async getExamplesForTask(task: string, limit: number = 3): Promise<SuccessfulTrajectory[]> {
    const taskType = classifyTask(task);
    const template = this.templates.get(taskType);

    if (!template) {
      // Fall back to general examples
      const generalTemplate = this.templates.get("general");
      return generalTemplate?.examples.slice(0, limit) ?? [];
    }

    return template.examples.slice(0, limit);
  }

  /**
   * Generate few-shot prompt section from successful trajectories
   */
  async generateFewShotPrompt(task: string): Promise<string | null> {
    const examples = await this.getExamplesForTask(task, 2);
    if (examples.length === 0) return null;

    const taskType = classifyTask(task);
    const template = this.templates.get(taskType);

    let prompt = `## Successful Patterns for ${taskType} tasks\n\n`;

    if (template?.successPatterns.length) {
      prompt += `**Patterns that work well:**\n`;
      prompt += template.successPatterns.map((p) => `- ${p}`).join("\n");
      prompt += "\n\n";
    }

    if (template?.commonTools.length) {
      prompt += `**Commonly used tools:** ${template.commonTools.slice(0, 5).join(", ")}\n\n`;
    }

    prompt += `### Example successful approaches:\n\n`;

    for (const ex of examples) {
      prompt += `**Task:** ${ex.taskDescription.slice(0, 100)}...\n`;
      prompt += `**Approach:**\n`;
      for (const step of ex.steps.slice(0, 5)) {
        if (step.thought) {
          prompt += `  💭 ${step.thought.slice(0, 80)}\n`;
        }
        if (step.tool) {
          prompt += `  🔧 ${step.tool}: ${step.action.slice(0, 60)}\n`;
        }
      }
      prompt += `**Result:** Success (${ex.keyPatterns.join(", ")})\n\n`;
    }

    return prompt;
  }

  /**
   * Get template statistics for monitoring
   */
  getStatistics(): {
    totalTemplates: number;
    totalExamples: number;
    byType: Record<string, number>;
  } {
    let totalExamples = 0;
    const byType: Record<string, number> = {};

    for (const [type, template] of this.templates) {
      byType[type] = template.examples.length;
      totalExamples += template.examples.length;
    }

    return {
      totalTemplates: this.templates.size,
      totalExamples,
      byType,
    };
  }

  /**
   * Get all successful trajectories for analysis
   */
  async getAllTrajectories(): Promise<SuccessfulTrajectory[]> {
    try {
      const content = await fs.readFile(this.trajectoriesPath, "utf-8");
      return content
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line) as SuccessfulTrajectory);
    } catch {
      return [];
    }
  }
}

// Singleton instance
let distillationInstance: AlgorithmDistillation | null = null;

export async function getDistillationSystem(
  workspacePath?: string,
): Promise<AlgorithmDistillation> {
  if (!distillationInstance || workspacePath) {
    distillationInstance = new AlgorithmDistillation(workspacePath);
    await distillationInstance.initialize();
  }
  return distillationInstance;
}
