/**
 * OpenClaw Memory (Cognee) Plugin
 *
 * Long-term memory with graph + vector search for AI conversations.
 * Uses Cognee for knowledge graph generation and hybrid search.
 * Provides seamless auto-recall and auto-capture via lifecycle hooks.
 */

import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { Type } from "@sinclair/typebox";
import { execFile } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { cogneeConfigSchema, type CogneeMemoryConfig } from "./config.js";

const execFileAsync = promisify(execFile);

// ============================================================================
// Python Bridge Interface
// ============================================================================

function getBridgePath(): string {
  const currentFile = fileURLToPath(import.meta.url);
  const currentDir = join(currentFile, "..");
  return join(currentDir, "bridge.py");
}

interface BridgeResult {
  status?: string;
  error?: string;
  results?: Array<{ text?: string; content?: string; [key: string]: unknown }>;
  count?: number;
  text?: string;
}

class CogneeBridge {
  constructor(
    private readonly bridgePath: string,
    private readonly dataDir: string,
    private readonly llmApiKey: string,
    private readonly llmProvider: string,
    private readonly llmModel?: string,
  ) {}

  private async callBridge(command: string, ...args: string[]): Promise<BridgeResult> {
    const env = {
      ...process.env,
      COGNEE_DATA_DIR: this.dataDir,
      LLM_API_KEY: this.llmApiKey,
      LLM_PROVIDER: this.llmProvider,
      ...(this.llmModel ? { LLM_MODEL: this.llmModel } : {}),
    };

    try {
      const { stdout, stderr } = await execFileAsync(
        "python3",
        [this.bridgePath, command, ...args],
        {
          env,
          timeout: 60000, // 60 second timeout
          maxBuffer: 10 * 1024 * 1024, // 10MB buffer for large responses
        },
      );

      // If there's stderr but no stdout, it's likely an error
      if (stderr && !stdout) {
        // Try to parse stderr as JSON (our bridge outputs JSON errors)
        try {
          const errorResult = JSON.parse(stderr) as BridgeResult;
          return errorResult;
        } catch {
          return { error: stderr };
        }
      }

      if (!stdout) {
        return { error: "No output from bridge script" };
      }

      const result = JSON.parse(stdout) as BridgeResult;
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // Check for common errors
      if (message.includes("ENOENT") || message.includes("not found")) {
        return { error: "Python3 not found. Please ensure python3 is installed and in PATH." };
      }
      if (message.includes("timeout")) {
        return { error: "Bridge operation timed out after 60 seconds." };
      }
      return { error: `Bridge error: ${message}` };
    }
  }

  async add(text: string): Promise<BridgeResult> {
    return this.callBridge("add", text);
  }

  async cognify(): Promise<BridgeResult> {
    return this.callBridge("cognify");
  }

  async memify(): Promise<BridgeResult> {
    return this.callBridge("memify");
  }

  async search(query: string, limit = 5): Promise<BridgeResult> {
    return this.callBridge("search", query, limit.toString());
  }

  async deleteAll(): Promise<BridgeResult> {
    return this.callBridge("delete");
  }
}

// ============================================================================
// Rule-based capture filter (same as memory-lancedb)
// ============================================================================

const MEMORY_TRIGGERS = [
  /zapamatuj si|pamatuj|remember/i,
  /preferuji|radši|nechci|prefer/i,
  /rozhodli jsme|budeme používat/i,
  /\+\d{10,}/,
  /[\w.-]+@[\w.-]+\.\w+/,
  /můj\s+\w+\s+je|je\s+můj/i,
  /my\s+\w+\s+is|is\s+my/i,
  /i (like|prefer|hate|love|want|need)/i,
  /always|never|important/i,
];

function shouldCapture(text: string): boolean {
  if (text.length < 10 || text.length > 500) {
    return false;
  }
  // Skip injected context from memory recall
  if (text.includes("<relevant-memories>")) {
    return false;
  }
  // Skip system-generated content
  if (text.startsWith("<") && text.includes("</")) {
    return false;
  }
  // Skip agent summary responses (contain markdown formatting)
  if (text.includes("**") && text.includes("\n-")) {
    return false;
  }
  // Skip emoji-heavy responses (likely agent output)
  const emojiCount = (text.match(/[\u{1F300}-\u{1F9FF}]/gu) || []).length;
  if (emojiCount > 3) {
    return false;
  }
  return MEMORY_TRIGGERS.some((r) => r.test(text));
}

// ============================================================================
// Plugin Definition
// ============================================================================

const memoryPlugin = {
  id: "memory-cognee",
  name: "Memory (Cognee)",
  description: "Cognee-backed memory with graph + vector search",
  kind: "memory" as const,
  configSchema: cogneeConfigSchema,

  register(api: OpenClawPluginApi) {
    const cfg = cogneeConfigSchema.parse(api.pluginConfig);
    const resolvedDataDir = api.resolvePath(cfg.dataDir!);
    const bridgePath = getBridgePath();
    const bridge = new CogneeBridge(
      bridgePath,
      resolvedDataDir,
      cfg.llm.apiKey,
      cfg.llm.provider,
      cfg.llm.model,
    );

    api.logger.info(`memory-cognee: plugin registered (data: ${resolvedDataDir})`);

    // ========================================================================
    // Tools
    // ========================================================================

    api.registerTool(
      {
        name: "memory_recall",
        label: "Memory Recall",
        description:
          "Search through long-term memories using Cognee's graph + vector search. Use when you need context about user preferences, past decisions, or previously discussed topics.",
        parameters: Type.Object({
          query: Type.String({ description: "Search query" }),
          limit: Type.Optional(Type.Number({ description: "Max results (default: 5)" })),
        }),
        async execute(_toolCallId, params) {
          const { query, limit = 5 } = params as { query: string; limit?: number };

          try {
            const result = await bridge.search(query, limit);

            if (result.error) {
              api.logger?.warn(`memory-cognee: search failed: ${result.error}`);
              return {
                content: [
                  {
                    type: "text",
                    text: `Memory search unavailable: ${result.error}. The Cognee memory system may not be properly configured.`,
                  },
                ],
                details: { error: result.error },
              };
            }

            if (!result.results || result.results.length === 0) {
              return {
                content: [{ type: "text", text: "No relevant memories found." }],
                details: { count: 0 },
              };
            }

            const text = result.results
              .map((r, i) => {
                const content = r.text || r.content || JSON.stringify(r);
                return `${i + 1}. ${content}`;
              })
              .join("\n");

            return {
              content: [
                {
                  type: "text",
                  text: `Found ${result.count ?? result.results.length} memories:\n\n${text}`,
                },
              ],
              details: { count: result.count ?? result.results.length, results: result.results },
            };
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            api.logger?.error(`memory-cognee: search exception: ${message}`);
            return {
              content: [
                {
                  type: "text",
                  text: `Memory search error: ${message}. Please check Cognee installation and configuration.`,
                },
              ],
              details: { error: message },
            };
          }
        },
      },
      { name: "memory_recall" },
    );

    api.registerTool(
      {
        name: "memory_store",
        label: "Memory Store",
        description:
          "Save important information in long-term memory using Cognee. Use for preferences, facts, decisions. Automatically generates knowledge graph relationships.",
        parameters: Type.Object({
          text: Type.String({ description: "Information to remember" }),
        }),
        async execute(_toolCallId, params) {
          const { text } = params as { text: string };

          try {
            // Add to Cognee
            const addResult = await bridge.add(text);
            if (addResult.error) {
              api.logger?.warn(`memory-cognee: store failed: ${addResult.error}`);
              return {
                content: [
                  {
                    type: "text",
                    text: `Memory storage unavailable: ${addResult.error}. The Cognee memory system may not be properly configured.`,
                  },
                ],
                details: { error: addResult.error },
              };
            }

            // Generate knowledge graph (async, non-blocking)
            bridge.cognify().catch((err) => {
              api.logger?.warn(`memory-cognee: cognify failed: ${String(err)}`);
            });

            // Add memory algorithms (async, non-blocking)
            bridge.memify().catch((err) => {
              api.logger?.warn(`memory-cognee: memify failed: ${String(err)}`);
            });

            return {
              content: [
                {
                  type: "text",
                  text: `Stored: "${text.slice(0, 100)}${text.length > 100 ? "..." : ""}"`,
                },
              ],
              details: { action: "created", text: text.slice(0, 100) },
            };
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            api.logger?.error(`memory-cognee: store exception: ${message}`);
            return {
              content: [
                {
                  type: "text",
                  text: `Memory storage error: ${message}. Please check Cognee installation and configuration.`,
                },
              ],
              details: { error: message },
            };
          }
        },
      },
      { name: "memory_store" },
    );

    api.registerTool(
      {
        name: "memory_forget",
        label: "Memory Forget",
        description: "Delete all memories from Cognee. GDPR-compliant.",
        parameters: Type.Object({
          confirm: Type.Optional(Type.Boolean({ description: "Confirm deletion" })),
        }),
        async execute(_toolCallId, params) {
          const { confirm } = params as { confirm?: boolean };

          if (!confirm) {
            return {
              content: [
                {
                  type: "text",
                  text: "Deletion requires confirmation. Set confirm=true to delete all memories.",
                },
              ],
              details: { error: "confirmation_required" },
            };
          }

          const result = await bridge.deleteAll();
          if (result.error) {
            return {
              content: [{ type: "text", text: `Error deleting memories: ${result.error}` }],
              details: { error: result.error },
            };
          }

          return {
            content: [{ type: "text", text: "All memories deleted." }],
            details: { action: "deleted" },
          };
        },
      },
      { name: "memory_forget" },
    );

    // ========================================================================
    // CLI Commands
    // ========================================================================

    api.registerCli(
      ({ program }) => {
        const memory = program.command("cognee").description("Cognee memory plugin commands");

        memory
          .command("add")
          .description("Add text to Cognee")
          .argument("<text>", "Text to add")
          .action(async (text: string) => {
            const result = await bridge.add(text);
            if (result.error) {
              console.error(`Error: ${result.error}`);
              process.exit(1);
            }
            console.log("Added to Cognee");
            // Trigger cognify and memify in background
            bridge.cognify().catch(console.error);
            bridge.memify().catch(console.error);
          });

        memory
          .command("search")
          .description("Search memories")
          .argument("<query>", "Search query")
          .option("--limit <n>", "Max results", "5")
          .action(async (query: string, opts: { limit?: string }) => {
            const limit = parseInt(opts.limit || "5", 10);
            const result = await bridge.search(query, limit);
            if (result.error) {
              console.error(`Error: ${result.error}`);
              process.exit(1);
            }
            console.log(JSON.stringify(result, null, 2));
          });

        memory
          .command("cognify")
          .description("Generate knowledge graph")
          .action(async () => {
            const result = await bridge.cognify();
            if (result.error) {
              console.error(`Error: ${result.error}`);
              process.exit(1);
            }
            console.log("Knowledge graph generated");
          });

        memory
          .command("memify")
          .description("Add memory algorithms")
          .action(async () => {
            const result = await bridge.memify();
            if (result.error) {
              console.error(`Error: ${result.error}`);
              process.exit(1);
            }
            console.log("Memory algorithms added");
          });

        memory
          .command("delete")
          .description("Delete all memories")
          .option("--confirm", "Confirm deletion", false)
          .action(async (opts: { confirm?: boolean }) => {
            if (!opts.confirm) {
              console.error("Deletion requires --confirm flag");
              process.exit(1);
            }
            const result = await bridge.deleteAll();
            if (result.error) {
              console.error(`Error: ${result.error}`);
              process.exit(1);
            }
            console.log("All memories deleted");
          });
      },
      { commands: ["cognee"] },
    );

    // ========================================================================
    // Lifecycle Hooks
    // ========================================================================

    // Auto-recall: inject relevant memories before agent starts
    if (cfg.autoRecall) {
      api.on("before_agent_start", async (event) => {
        if (!event.prompt || event.prompt.length < 5) {
          return;
        }

        try {
          // Add timeout to prevent blocking agent start
          const searchPromise = bridge.search(event.prompt, 3);
          const timeoutPromise = new Promise<BridgeResult>((resolve) => {
            setTimeout(() => {
              resolve({ error: "Memory search timed out" });
            }, 5000); // 5 second timeout for recall
          });

          const result = await Promise.race([searchPromise, timeoutPromise]);

          if (result.error || !result.results || result.results.length === 0) {
            if (result.error && result.error !== "Memory search timed out") {
              api.logger.warn?.(`memory-cognee: recall failed: ${result.error}`);
            }
            return;
          }

          const memoryContext = result.results
            .map((r, i) => {
              const content = r.text || r.content || JSON.stringify(r);
              return `- ${content}`;
            })
            .join("\n");

          api.logger.info?.(
            `memory-cognee: injecting ${result.results.length} memories into context`,
          );

          return {
            prependContext: `<relevant-memories>\nThe following memories may be relevant to this conversation:\n${memoryContext}\n</relevant-memories>`,
          };
        } catch (err) {
          api.logger.warn?.(`memory-cognee: recall failed: ${String(err)}`);
          // Don't block agent start on recall errors
          return;
        }
      });
    }

    // Auto-capture: analyze and store important information after agent ends
    if (cfg.autoCapture) {
      api.on("agent_end", async (event) => {
        if (!event.success || !event.messages || event.messages.length === 0) {
          return;
        }

        try {
          // Extract text content from messages
          const texts: string[] = [];
          for (const msg of event.messages) {
            if (!msg || typeof msg !== "object") {
              continue;
            }
            const msgObj = msg as Record<string, unknown>;

            const role = msgObj.role;
            if (role !== "user" && role !== "assistant") {
              continue;
            }

            const content = msgObj.content;

            if (typeof content === "string") {
              texts.push(content);
              continue;
            }

            if (Array.isArray(content)) {
              for (const block of content) {
                if (
                  block &&
                  typeof block === "object" &&
                  "type" in block &&
                  (block as Record<string, unknown>).type === "text" &&
                  "text" in block &&
                  typeof (block as Record<string, unknown>).text === "string"
                ) {
                  texts.push((block as Record<string, unknown>).text as string);
                }
              }
            }
          }

          // Filter for capturable content
          const toCapture = texts.filter((text) => text && shouldCapture(text));
          if (toCapture.length === 0) {
            return;
          }

          // Store each capturable piece (limit to 3 per conversation)
          let stored = 0;
          for (const text of toCapture.slice(0, 3)) {
            const addResult = await bridge.add(text);
            if (!addResult.error) {
              stored++;
            }
          }

          if (stored > 0) {
            api.logger.info(`memory-cognee: auto-captured ${stored} memories`);
            // Trigger graph generation in background
            bridge.cognify().catch((err) => {
              api.logger.warn(`memory-cognee: cognify failed: ${String(err)}`);
            });
            bridge.memify().catch((err) => {
              api.logger.warn(`memory-cognee: memify failed: ${String(err)}`);
            });
          }
        } catch (err) {
          api.logger.warn(`memory-cognee: capture failed: ${String(err)}`);
        }
      });
    }

    // ========================================================================
    // Service
    // ========================================================================

    api.registerService({
      id: "memory-cognee",
      start: () => {
        api.logger.info(
          `memory-cognee: initialized (data: ${resolvedDataDir}, provider: ${cfg.llm.provider})`,
        );
      },
      stop: () => {
        api.logger.info("memory-cognee: stopped");
      },
    });
  },
};

export default memoryPlugin;
