import { promises as fs } from "fs";
import path from "path";
import type { AgentGenotype } from "./genotype.js";
import type { SessionStats } from "./telemetry.js";
import { resolveStateDir } from "../../config/paths.js";
import { loadGenotype } from "./genotype.js";
import { logSessionStats, calculateFitness } from "./telemetry.js";

/**
 * A Dojo task represents a standard evaluation task that agents must solve.
 */
export type DojoTask = {
  id: string;
  name: string;
  description: string;
  /** Task prompt to send to agent */
  prompt: string;
  /** Expected success criteria (optional, for automated validation) */
  successCriteria?: {
    /** Files that should exist after task completion */
    filesCreated?: string[];
    /** Commands that should succeed */
    commandsSucceed?: string[];
    /** Text patterns that should appear in output */
    outputContains?: string[];
  };
  /** Weight for fitness calculation (default: 1.0) */
  weight?: number;
};

/**
 * Standard evaluation suite (Dojo) tasks.
 */
export const DOJO_TASKS: DojoTask[] = [
  {
    id: "task-001",
    name: "Fix Syntax Error",
    description: "Fix a syntax error in a provided file",
    prompt: `I have a file with a syntax error. Please find and fix it.

Create a file called \`test-syntax.js\` with this content:
\`\`\`javascript
function hello() {
  console.log("Hello, world"
}
\`\`\`

Fix the syntax error and verify the file is valid JavaScript.`,
    successCriteria: {
      filesCreated: ["test-syntax.js"],
      commandsSucceed: ["node test-syntax.js"],
    },
    weight: 1.0,
  },
  {
    id: "task-002",
    name: "Dockerize Script",
    description: "Create a Dockerfile for a simple script",
    prompt: `I have a Python script that needs to be dockerized.

Create a file called \`app.py\`:
\`\`\`python
#!/usr/bin/env python3
print("Hello from Docker!")
\`\`\`

Create a Dockerfile that:
1. Uses Python 3.11 as base image
2. Copies app.py into the container
3. Runs the script when the container starts

Then verify the Dockerfile is valid.`,
    successCriteria: {
      filesCreated: ["app.py", "Dockerfile"],
      commandsSucceed: ["docker build -t test-app ."],
    },
    weight: 1.2,
  },
  {
    id: "task-003",
    name: "Refactor Function",
    description: "Refactor a function to be more maintainable",
    prompt: `I have a function that needs refactoring. Please improve it.

Create a file called \`refactor-me.ts\`:
\`\`\`typescript
function process(data: any): any {
  if (data.type === "user") {
    if (data.age > 18) {
      if (data.active) {
        return { status: "ok", message: "User is active" };
      } else {
        return { status: "error", message: "User is inactive" };
      }
    } else {
      return { status: "error", message: "User is underage" };
    }
  } else {
    return { status: "error", message: "Invalid type" };
  }
}
\`\`\`

Refactor this function to:
1. Reduce nesting
2. Add proper type definitions
3. Make it more readable

Keep the same behavior.`,
    successCriteria: {
      filesCreated: ["refactor-me.ts"],
      outputContains: ["interface", "type"],
    },
    weight: 1.5,
  },
  {
    id: "task-004",
    name: "Write Test",
    description: "Write a test for an existing function",
    prompt: `I have a function that needs tests. Please write comprehensive tests.

Create a file called \`math.ts\`:
\`\`\`typescript
export function add(a: number, b: number): number {
  return a + b;
}

export function multiply(a: number, b: number): number {
  return a * b;
}
\`\`\`

Create a test file \`math.test.ts\` that tests both functions with:
1. Normal cases
2. Edge cases (zero, negative numbers)
3. At least 3 test cases per function`,
    successCriteria: {
      filesCreated: ["math.ts", "math.test.ts"],
      outputContains: ["test", "expect", "add", "multiply"],
    },
    weight: 1.3,
  },
  {
    id: "task-005",
    name: "Document Code",
    description: "Add documentation to existing code",
    prompt: `I have code that needs documentation. Please add comprehensive documentation.

Create a file called \`calculator.ts\`:
\`\`\`typescript
class Calculator {
  private value: number;

  constructor(initial: number = 0) {
    this.value = initial;
  }

  add(n: number) {
    this.value += n;
    return this;
  }

  subtract(n: number) {
    this.value -= n;
    return this;
  }

  getResult() {
    return this.value;
  }
}
\`\`\`

Add:
1. JSDoc comments for the class and all methods
2. Parameter descriptions
3. Return type descriptions
4. Usage examples`,
    successCriteria: {
      filesCreated: ["calculator.ts"],
      outputContains: ["@param", "@returns", "@example"],
    },
    weight: 1.0,
  },
];

/**
 * Run a single Dojo task with a specific genotype.
 * This would normally invoke the agent runner, but for now returns a mock result.
 */
export async function runDojoTask(
  task: DojoTask,
  genotype: AgentGenotype,
  params?: {
    workspaceDir?: string;
    agentRunner?: (
      prompt: string,
      genotype: AgentGenotype,
    ) => Promise<{
      success: boolean;
      tokenUsage: SessionStats["tokenUsage"];
      toolCalls: number;
      durationMs: number;
      error?: string;
    }>;
  },
): Promise<{
  taskId: string;
  success: boolean;
  fitness: number;
  stats: SessionStats;
}> {
  const workspaceDir =
    params?.workspaceDir ?? path.join(resolveStateDir(), "evolution", "dojo", task.id);
  await fs.mkdir(workspaceDir, { recursive: true });

  // Apply genotype to prompt
  const enhancedPrompt = task.prompt; // In real implementation, apply genotype modifications

  // Run agent (mock for now - would call actual agent runner)
  const runner =
    params?.agentRunner ??
    (async () => ({
      success: Math.random() > 0.3, // 70% success rate for demo
      tokenUsage: {
        input: Math.floor(Math.random() * 5000) + 1000,
        output: Math.floor(Math.random() * 2000) + 500,
        total: Math.floor(Math.random() * 7000) + 1500,
      },
      toolCalls: Math.floor(Math.random() * 10) + 2,
      durationMs: Math.floor(Math.random() * 5000) + 1000,
      error: undefined as string | undefined,
    }));

  const result = await runner(enhancedPrompt, genotype);

  // Calculate fitness
  const stats: SessionStats = {
    sessionId: `dojo-${task.id}-${Date.now()}`,
    timestamp: Date.now(),
    success: result.success,
    aborted: false,
    error: result.error,
    tokenUsage: result.tokenUsage,
    toolCalls: result.toolCalls,
    durationMs: result.durationMs,
    model: "claude-opus-4-5",
    provider: "anthropic",
    userSatisfaction: result.success ? 0.8 : 0.2,
  };

  // Use the standard fitness calculation function
  const baseFitness = calculateFitness(stats);
  stats.fitness = baseFitness * (task.weight ?? 1.0);

  // Log stats
  await logSessionStats({
    sessionId: stats.sessionId,
    meta: {
      durationMs: result.durationMs,
      agentMeta: {
        sessionId: stats.sessionId,
        provider: stats.provider,
        model: stats.model,
        usage: result.tokenUsage,
      },
      aborted: false,
      error: result.error ? { kind: "context_overflow", message: result.error } : undefined,
    },
    agentMeta: {
      sessionId: stats.sessionId,
      provider: stats.provider,
      model: stats.model,
      usage: result.tokenUsage,
    },
    toolCallCount: result.toolCalls,
    userSatisfaction: stats.userSatisfaction,
    generation: genotype.generation,
    genotypeId: genotype.genotypeId,
  });

  return {
    taskId: task.id,
    success: result.success,
    fitness: stats.fitness,
    stats,
  };
}

/**
 * Run the full Dojo evaluation suite for a genotype.
 */
export async function runDojoSuite(
  genotype: AgentGenotype,
  params?: {
    tasks?: DojoTask[];
    workspaceDir?: string;
    agentRunner?: NonNullable<Parameters<typeof runDojoTask>[2]>["agentRunner"];
  },
): Promise<{
  genotype: AgentGenotype;
  results: Array<Awaited<ReturnType<typeof runDojoTask>>>;
  avgFitness: number;
  successRate: number;
}> {
  const tasks = params?.tasks ?? DOJO_TASKS;
  const results = await Promise.all(tasks.map((task) => runDojoTask(task, genotype, params)));

  const avgFitness =
    results.length > 0 ? results.reduce((sum, r) => sum + r.fitness, 0) / results.length : 0;
  const successRate =
    results.length > 0 ? results.filter((r) => r.success).length / results.length : 0;

  return {
    genotype,
    results,
    avgFitness,
    successRate,
  };
}
