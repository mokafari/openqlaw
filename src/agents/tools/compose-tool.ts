/**
 * Compose Tool - Agent-facing tool for creating composed tool workflows
 *
 * Allows agents to chain multiple tools together into reusable workflows.
 */

import { Type } from "@sinclair/typebox";
import type { AnyAgentTool } from "./common.js";
import { jsonResult } from "./common.js";
import {
  composeTool,
  executeComposition,
  listComposedTools,
  validateComposition,
  type CompositionStep,
} from "./composer.js";

export function createComposeToolTool(): AnyAgentTool {
  return {
    name: "compose_tool",
    label: "Compose Tool",
    description: `Create a composed tool that chains multiple tool calls together.

Steps are executed in sequence. Each step can:
- Pass parameters directly or reference previous outputs with $varName
- Set outputAs to capture the result for later steps
- Set condition to skip based on a simple expression

Example:
  name: "search_and_fetch"
  description: "Search web and fetch top result"
  steps: [
    { tool: "web_search", params: { query: "$input" }, outputAs: "results" },
    { tool: "web_fetch", params: { url: "$results[0].url" }, outputAs: "content" }
  ]

After creation, the composed tool can be executed with execute_composed.`,
    parameters: Type.Object({
      name: Type.String({ description: "Name for the composed tool" }),
      description: Type.String({ description: "What the composed tool does" }),
      steps: Type.Array(
        Type.Object({
          tool: Type.String({ description: "Tool name to call" }),
          params: Type.Object(
            {},
            {
              additionalProperties: true,
              description: "Parameters (use $var for previous outputs)",
            },
          ),
          outputAs: Type.Optional(Type.String({ description: "Variable name to store output" })),
          condition: Type.Optional(
            Type.String({ description: "Condition expression to skip step" }),
          ),
        }),
        { description: "Ordered list of tool steps" },
      ),
    }),
    execute: async (_toolCallId, args) => {
      const params = args as {
        name: string;
        description: string;
        steps: CompositionStep[];
      };

      if (!params.name?.trim()) {
        return jsonResult({ error: "name is required" });
      }
      if (!params.steps?.length) {
        return jsonResult({ error: "at least one step is required" });
      }

      // Create the composed tool
      const composed = composeTool(params.name, params.description, params.steps);

      // Validate it
      const validation = validateComposition(composed);
      if (!validation.valid) {
        return jsonResult({
          error: "Invalid composition",
          issues: validation.errors,
        });
      }

      return jsonResult({
        success: true,
        composedToolId: composed.id,
        name: composed.name,
        stepCount: composed.steps.length,
        message: `Created composed tool "${composed.name}" with ${composed.steps.length} steps. Use execute_composed to run it.`,
      });
    },
  };
}

export function createExecuteComposedTool(
  toolExecutors: Map<string, (params: Record<string, unknown>) => Promise<unknown>>,
): AnyAgentTool {
  return {
    name: "execute_composed",
    label: "Execute Composed Tool",
    description: `Execute a previously created composed tool.

Pass the composedToolId from compose_tool and any initial inputs.
The tool will execute all steps in sequence, passing outputs between steps.`,
    parameters: Type.Object({
      composedToolId: Type.String({ description: "ID of the composed tool to execute" }),
      inputs: Type.Optional(
        Type.Object(
          {},
          { additionalProperties: true, description: "Initial inputs (available as $input)" },
        ),
      ),
    }),
    execute: async (_toolCallId, args) => {
      const params = args as {
        composedToolId: string;
        inputs?: Record<string, unknown>;
      };

      if (!params.composedToolId) {
        return jsonResult({ error: "composedToolId is required" });
      }

      // Find the composed tool
      const tools = listComposedTools();
      const composed = tools.find((t) => t.id === params.composedToolId);

      if (!composed) {
        return jsonResult({
          error: `Composed tool not found: ${params.composedToolId}`,
          availableTools: tools.map((t) => ({ id: t.id, name: t.name })),
        });
      }

      // Execute it
      const result = await executeComposition(composed, toolExecutors, params.inputs);

      return jsonResult({
        success: result.success,
        outputs: result.outputs,
        stepResults: result.stepResults.map((s) => ({
          step: s.step,
          tool: s.tool,
          success: s.success,
          error: s.error,
          durationMs: s.durationMs,
        })),
        totalDurationMs: result.totalDurationMs,
      });
    },
  };
}

export function createListComposedToolsTool(): AnyAgentTool {
  return {
    name: "list_composed",
    label: "List Composed Tools",
    description: "List all composed tools created in this session.",
    parameters: Type.Object({}),
    execute: async () => {
      const tools = listComposedTools();

      if (tools.length === 0) {
        return jsonResult({
          message: "No composed tools. Use compose_tool to create one.",
          tools: [],
        });
      }

      return jsonResult({
        count: tools.length,
        tools: tools.map((t) => ({
          id: t.id,
          name: t.name,
          description: t.description,
          stepCount: t.steps.length,
          createdAt: new Date(t.createdAt).toISOString(),
        })),
      });
    },
  };
}
