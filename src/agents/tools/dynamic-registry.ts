/**
 * Dynamic Tool Registry
 *
 * Allows agents to define, validate, and register new tools at runtime
 * without requiring a restart. Handler code runs in a sandboxed vm context.
 */

import fs from "node:fs/promises";
import path from "node:path";
import type { AnyAgentTool } from "./common.js";
import { createSubsystemLogger } from "../../logging/subsystem.js";
import { jsonResult } from "./common.js";

const log = createSubsystemLogger("agents/dynamic-tools");

export type DynamicToolDefinition = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  handlerCode: string;
  createdAt: number;
  createdBy?: string;
};

// Built-in tool names that cannot be overridden
const RESERVED_TOOL_NAMES = new Set([
  "read",
  "write",
  "edit",
  "exec",
  "process",
  "message",
  "browser",
  "canvas",
  "cron",
  "gateway",
  "tts",
  "web_search",
  "web_fetch",
  "create_tool",
  "remove_tool",
]);

export class DynamicToolRegistry {
  private tools = new Map<string, { definition: DynamicToolDefinition; tool: AnyAgentTool }>();
  private persistDir?: string;

  constructor(persistDir?: string) {
    this.persistDir = persistDir;
  }

  registerTool(definition: DynamicToolDefinition): AnyAgentTool {
    if (!/^[a-z][a-z0-9_]*$/.test(definition.name)) {
      throw new Error(
        `Invalid tool name: "${definition.name}". Must be snake_case [a-z][a-z0-9_]*.`,
      );
    }
    if (definition.name.length > 64) {
      throw new Error("Tool name must be 64 characters or fewer.");
    }
    if (RESERVED_TOOL_NAMES.has(definition.name)) {
      throw new Error(`Tool name "${definition.name}" is reserved and cannot be used.`);
    }
    if (!definition.handlerCode || definition.handlerCode.trim().length === 0) {
      throw new Error("Handler code is required.");
    }

    const tool = this.compileHandler(definition);
    this.tools.set(definition.name, { definition, tool });
    log.info(`dynamic tool registered: ${definition.name}`);
    return tool;
  }

  unregisterTool(name: string): boolean {
    const deleted = this.tools.delete(name);
    if (deleted) {
      log.info(`dynamic tool unregistered: ${name}`);
    }
    return deleted;
  }

  getTools(): AnyAgentTool[] {
    return Array.from(this.tools.values()).map((entry) => entry.tool);
  }

  getTool(name: string): AnyAgentTool | undefined {
    return this.tools.get(name)?.tool;
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }

  listDefinitions(): DynamicToolDefinition[] {
    return Array.from(this.tools.values()).map((entry) => entry.definition);
  }

  private compileHandler(definition: DynamicToolDefinition): AnyAgentTool {
    const { name, description, parameters, handlerCode } = definition;

    return {
      name,
      label: `Dynamic: ${name}`,
      description,
      parameters,
      execute: async (_toolCallId: string, params: unknown) => {
        const result = await this.executeSandboxed(handlerCode, params, name);
        return jsonResult(
          typeof result === "object" && result !== null
            ? result
            : { result: result != null ? JSON.stringify(result) : "" },
        );
      },
    };
  }

  private async executeSandboxed(
    code: string,
    params: unknown,
    toolName: string,
  ): Promise<unknown> {
    const { runInNewContext } = await import("node:vm");

    const sandbox: Record<string, unknown> = {
      params,
      JSON,
      Math,
      Date,
      Array,
      Object,
      String,
      Number,
      Boolean,
      RegExp,
      Error,
      Map,
      Set,
      Promise,
      console: {
        log: (...args: unknown[]) => log.debug(`[${toolName}] ${args.map(String).join(" ")}`),
        warn: (...args: unknown[]) => log.warn(`[${toolName}] ${args.map(String).join(" ")}`),
        error: (...args: unknown[]) => log.warn(`[${toolName}] ${args.map(String).join(" ")}`),
      },
      fetch: globalThis.fetch,
      // Blocked globals
      setTimeout: undefined,
      setInterval: undefined,
      process: undefined,
      require: undefined,
      Bun: undefined,
      Deno: undefined,
    };

    const wrappedCode = `(async function(params) { ${code} })(params)`;

    try {
      const result = await runInNewContext(wrappedCode, sandbox, {
        timeout: 30_000,
        filename: `dynamic-tool:${toolName}`,
      });
      return result;
    } catch (err) {
      throw new Error(`Dynamic tool "${toolName}" execution failed: ${String(err)}`, {
        cause: err,
      });
    }
  }

  async persistTool(definition: DynamicToolDefinition): Promise<void> {
    if (!this.persistDir) {
      return;
    }
    await fs.mkdir(this.persistDir, { recursive: true });
    const filePath = path.join(this.persistDir, `${definition.name}.json`);
    await fs.writeFile(filePath, JSON.stringify(definition, null, 2));
  }

  async removePersisted(name: string): Promise<void> {
    if (!this.persistDir) {
      return;
    }
    const filePath = path.join(this.persistDir, `${name}.json`);
    try {
      await fs.unlink(filePath);
    } catch {
      // File may not exist
    }
  }

  async loadPersistedTools(): Promise<void> {
    if (!this.persistDir) {
      return;
    }
    let files: string[];
    try {
      files = await fs.readdir(this.persistDir);
    } catch {
      return; // Directory doesn't exist yet
    }
    for (const file of files) {
      if (!file.endsWith(".json")) {
        continue;
      }
      try {
        const content = await fs.readFile(path.join(this.persistDir, file), "utf-8");
        const def = JSON.parse(content) as DynamicToolDefinition;
        this.registerTool(def);
      } catch (err) {
        log.warn(`failed to load persisted dynamic tool ${file}: ${String(err)}`);
      }
    }
  }
}

let globalDynamicRegistry: DynamicToolRegistry | undefined;

export function getGlobalDynamicRegistry(): DynamicToolRegistry {
  if (!globalDynamicRegistry) {
    globalDynamicRegistry = new DynamicToolRegistry();
  }
  return globalDynamicRegistry;
}

export function initGlobalDynamicRegistry(persistDir?: string): DynamicToolRegistry {
  globalDynamicRegistry = new DynamicToolRegistry(persistDir);
  return globalDynamicRegistry;
}
