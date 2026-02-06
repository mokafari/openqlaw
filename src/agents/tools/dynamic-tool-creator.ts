/**
 * Dynamic Tool Creator
 *
 * Agent-facing tool that allows creating new tools at runtime.
 * Created tools run in a sandboxed VM context.
 */

import { Type } from "@sinclair/typebox";
import type { AnyAgentTool } from "./common.js";
import { jsonResult } from "./common.js";
import { getGlobalDynamicRegistry } from "./dynamic-registry.js";

export function createDynamicToolCreatorTool(): AnyAgentTool {
  return {
    name: "create_tool",
    label: "Create Tool",
    description: `Create a new agent tool at runtime. The tool becomes immediately available.

Provide:
- name: snake_case identifier (e.g., "calculate_fibonacci")
- description: what the tool does
- parameters: JSON Schema for input (optional, defaults to empty object)
- handler: JavaScript function body that receives "params" and returns a result

The handler runs sandboxed with access to: params, JSON, Math, Date, fetch, console.
No access to: filesystem, process, require, timers.

Example:
  name: "calculate_fibonacci"
  description: "Calculate the nth Fibonacci number"
  parameters: { "type": "object", "properties": { "n": { "type": "number" } } }
  handler: "let a = 0, b = 1; for (let i = 0; i < params.n; i++) { [a, b] = [b, a + b]; } return a;"`,
    parameters: Type.Object({
      name: Type.String({ description: "Snake_case tool name" }),
      description: Type.String({ description: "What the tool does" }),
      parameters: Type.Optional(
        Type.Object({}, { additionalProperties: true, description: "JSON Schema for tool input" }),
      ),
      handler: Type.String({ description: "JavaScript function body (receives 'params')" }),
    }),
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const name = typeof params.name === "string" ? params.name.trim() : "";
      const description = typeof params.description === "string" ? params.description.trim() : "";
      const handler = typeof params.handler === "string" ? params.handler.trim() : "";
      const parameters = (params.parameters as Record<string, unknown>) ?? {
        type: "object",
        properties: {},
      };

      if (!name) {
        return jsonResult({ error: "name is required" });
      }
      if (!description) {
        return jsonResult({ error: "description is required" });
      }
      if (!handler) {
        return jsonResult({ error: "handler is required" });
      }

      const registry = getGlobalDynamicRegistry();

      if (registry.has(name)) {
        return jsonResult({ error: `Tool "${name}" already exists. Remove it first.` });
      }

      try {
        const definition = {
          name,
          description,
          parameters,
          handlerCode: handler,
          createdAt: Date.now(),
        };

        registry.registerTool(definition);
        await registry.persistTool(definition);

        return jsonResult({
          ok: true,
          message: `Tool "${name}" created and available for use.`,
          toolName: name,
        });
      } catch (err) {
        return jsonResult({ error: String(err) });
      }
    },
  };
}

export function createDynamicToolRemoverTool(): AnyAgentTool {
  return {
    name: "remove_tool",
    label: "Remove Tool",
    description: "Remove a previously created dynamic tool.",
    parameters: Type.Object({
      name: Type.String({ description: "Name of the dynamic tool to remove" }),
    }),
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const name = typeof params.name === "string" ? params.name.trim() : "";

      if (!name) {
        return jsonResult({ error: "name is required" });
      }

      const registry = getGlobalDynamicRegistry();

      if (!registry.has(name)) {
        return jsonResult({ error: `Tool "${name}" not found.` });
      }

      registry.unregisterTool(name);
      await registry.removePersisted(name);

      return jsonResult({
        ok: true,
        message: `Tool "${name}" removed.`,
      });
    },
  };
}
