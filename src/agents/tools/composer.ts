/**
 * Tool Composer - Dynamic tool composition framework
 * Part of AGI 2026 TIER 2: Tool Ecosystem
 */

// Types
export interface ToolSpec {
  name: string;
  description: string;
  inputSchema?: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
}

export interface CompositionStep {
  tool: string;
  params: Record<string, unknown>;
  outputAs?: string; // Variable name for output
  condition?: string; // Optional condition expression
}

export interface ComposedTool {
  id: string;
  name: string;
  description: string;
  steps: CompositionStep[];
  createdAt: number;
}

export interface CompositionResult {
  success: boolean;
  outputs: Record<string, unknown>;
  stepResults: Array<{
    step: number;
    tool: string;
    success: boolean;
    output?: unknown;
    error?: string;
    durationMs: number;
  }>;
  totalDurationMs: number;
}

// Tool registry (injected tools)
type ToolExecutor = (params: Record<string, unknown>) => Promise<unknown>;
const toolRegistry: Map<string, ToolExecutor> = new Map();

// Composed tools storage
const composedTools: Map<string, ComposedTool> = new Map();

// Generate ID
function generateId(): string {
  return `comp_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

// Register a tool executor
export function registerTool(name: string, executor: ToolExecutor): void {
  toolRegistry.set(name, executor);
}

// Compose tools into a workflow
export function composeTool(
  name: string,
  description: string,
  steps: CompositionStep[],
): ComposedTool {
  const composed: ComposedTool = {
    id: generateId(),
    name,
    description,
    steps,
    createdAt: Date.now(),
  };

  composedTools.set(composed.id, composed);
  return composed;
}

// Validate composition before execution
export function validateComposition(composition: ComposedTool): {
  valid: boolean;
  errors: string[];
  warnings: string[];
} {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!composition.name) {
    errors.push("Composition must have a name");
  }

  if (composition.steps.length === 0) {
    errors.push("Composition must have at least one step");
  }

  const outputVars = new Set<string>();

  for (let i = 0; i < composition.steps.length; i++) {
    const step = composition.steps[i];

    // Check tool exists
    if (!toolRegistry.has(step.tool)) {
      warnings.push(`Step ${i + 1}: Tool '${step.tool}' not registered (may be added at runtime)`);
    }

    // Track output variables
    if (step.outputAs) {
      if (outputVars.has(step.outputAs)) {
        warnings.push(`Step ${i + 1}: Output variable '${step.outputAs}' already defined`);
      }
      outputVars.add(step.outputAs);
    }

    // Check param references
    for (const value of Object.values(step.params)) {
      if (typeof value === "string" && value.startsWith("$")) {
        const varName = value.slice(1);
        if (!outputVars.has(varName) && varName !== "input") {
          errors.push(`Step ${i + 1}: References undefined variable '${varName}'`);
        }
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

// Resolve parameter values (replace $variables with actual values)
function resolveParams(
  params: Record<string, unknown>,
  context: Record<string, unknown>,
): Record<string, unknown> {
  const resolved: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(params)) {
    if (typeof value === "string" && value.startsWith("$")) {
      const varName = value.slice(1);
      resolved[key] = context[varName];
    } else if (typeof value === "object" && value !== null) {
      resolved[key] = resolveParams(value as Record<string, unknown>, context);
    } else {
      resolved[key] = value;
    }
  }

  return resolved;
}

// Evaluate condition
function evaluateCondition(condition: string, context: Record<string, unknown>): boolean {
  try {
    // Simple condition evaluation (supports: $var == value, $var != value, $var)
    const trimmed = condition.trim();

    if (trimmed.includes("==")) {
      const [left, right] = trimmed.split("==").map((s) => s.trim());
      const leftVal = left.startsWith("$") ? context[left.slice(1)] : left;
      const rightVal = right.startsWith("$") ? context[right.slice(1)] : right;
      return leftVal == rightVal;
    }

    if (trimmed.includes("!=")) {
      const [left, right] = trimmed.split("!=").map((s) => s.trim());
      const leftVal = left.startsWith("$") ? context[left.slice(1)] : left;
      const rightVal = right.startsWith("$") ? context[right.slice(1)] : right;
      return leftVal != rightVal;
    }

    if (trimmed.startsWith("$")) {
      return !!context[trimmed.slice(1)];
    }

    return true;
  } catch {
    return true;
  }
}

// Execute composed tool
export async function executeComposed(
  compositionId: string,
  input: Record<string, unknown> = {},
): Promise<CompositionResult> {
  const composition = composedTools.get(compositionId);

  if (!composition) {
    return {
      success: false,
      outputs: {},
      stepResults: [
        {
          step: 0,
          tool: "lookup",
          success: false,
          error: `Composition '${compositionId}' not found`,
          durationMs: 0,
        },
      ],
      totalDurationMs: 0,
    };
  }

  const startTime = Date.now();
  const context: Record<string, unknown> = { input, ...input };
  const stepResults: CompositionResult["stepResults"] = [];

  for (let i = 0; i < composition.steps.length; i++) {
    const step = composition.steps[i];
    const stepStart = Date.now();

    // Check condition
    if (step.condition && !evaluateCondition(step.condition, context)) {
      stepResults.push({
        step: i + 1,
        tool: step.tool,
        success: true,
        output: "skipped (condition not met)",
        durationMs: 0,
      });
      continue;
    }

    // Get tool executor
    const executor = toolRegistry.get(step.tool);
    if (!executor) {
      stepResults.push({
        step: i + 1,
        tool: step.tool,
        success: false,
        error: `Tool '${step.tool}' not registered`,
        durationMs: Date.now() - stepStart,
      });

      return {
        success: false,
        outputs: context,
        stepResults,
        totalDurationMs: Date.now() - startTime,
      };
    }

    // Execute step
    try {
      const resolvedParams = resolveParams(step.params, context);
      const output = await executor(resolvedParams);

      if (step.outputAs) {
        context[step.outputAs] = output;
      }

      stepResults.push({
        step: i + 1,
        tool: step.tool,
        success: true,
        output,
        durationMs: Date.now() - stepStart,
      });
    } catch (error: any) {
      stepResults.push({
        step: i + 1,
        tool: step.tool,
        success: false,
        error: error.message || String(error),
        durationMs: Date.now() - stepStart,
      });

      return {
        success: false,
        outputs: context,
        stepResults,
        totalDurationMs: Date.now() - startTime,
      };
    }
  }

  return {
    success: true,
    outputs: context,
    stepResults,
    totalDurationMs: Date.now() - startTime,
  };
}

// List composed tools
export function listComposedTools(): ComposedTool[] {
  const result: ComposedTool[] = [];
  composedTools.forEach((tool) => result.push(tool));
  return result;
}

// Get composed tool by ID or name
export function getComposedTool(idOrName: string): ComposedTool | undefined {
  // Try by ID first
  if (composedTools.has(idOrName)) {
    return composedTools.get(idOrName);
  }

  // Try by name
  let found: ComposedTool | undefined;
  composedTools.forEach((tool) => {
    if (tool.name === idOrName) {
      found = tool;
    }
  });
  if (found) return found;

  return undefined;
}

// Delete composed tool
export function deleteComposedTool(id: string): boolean {
  return composedTools.delete(id);
}

// Reset (for testing)
export function reset(): void {
  composedTools.clear();
}
