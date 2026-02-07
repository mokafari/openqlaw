import type { ReachabilityCheckContext } from "./aas/types.js";
import type { AnyAgentTool } from "./tools/common.js";
import { maybeSnapshotDevContinuation } from "../infra/dev-self-edit-hook.js";
import { createSubsystemLogger } from "../logging/subsystem.js";
import { getGlobalHookRunner } from "../plugins/hook-runner-global.js";
import { CONTEXT_AREAS } from "./aas/context-areas.js";
import { checkReachability, validateReachability } from "./aas/reachability.js";
import { getToolMetadata } from "./aas/tool-surface.js";
import { formatToolStart } from "./personality/formatter.js";
import { normalizeToolName } from "./tool-policy.js";

type HookContext = {
  agentId?: string;
  sessionKey?: string;
  workspaceDir?: string;
  reachabilityEnforcement?: "warn" | "block";
  synonymDictionary?: import("./personality/synonyms.js").SynonymDictionary;
};

type HookOutcome = { blocked: true; reason: string } | { blocked: false; params: unknown };

const log = createSubsystemLogger("agents/tools");

// Module-level synonym dictionary, set lazily after Quake integration init.
let globalSynonymDictionary: import("./personality/synonyms.js").SynonymDictionary | undefined;

export function setGlobalSynonymDictionary(
  dict: import("./personality/synonyms.js").SynonymDictionary | undefined,
): void {
  globalSynonymDictionary = dict;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Validate required parameters for built-in tools.
 * Returns a block reason if validation fails, undefined otherwise.
 */
function validateBuiltInToolParams(toolName: string, params: unknown): string | undefined {
  const record = isPlainObject(params) ? params : {};

  // Read tool requires a path parameter
  if (toolName === "read") {
    const path = typeof record.path === "string" ? record.path.trim() : "";
    const filePath = typeof record.file_path === "string" ? record.file_path.trim() : "";
    if (!path && !filePath) {
      return 'Read tool requires "path" or "file_path" parameter. Provide the file path to read.';
    }
  }

  return undefined;
}

export async function runBeforeToolCallHook(args: {
  toolName: string;
  params: unknown;
  toolCallId?: string;
  ctx?: HookContext;
}): Promise<HookOutcome> {
  const toolName = normalizeToolName(args.toolName || "tool");
  const params = args.params;

  // Built-in validation for required parameters
  const validationError = validateBuiltInToolParams(toolName, params);
  if (validationError) {
    return { blocked: true, reason: validationError };
  }

  const hookRunner = getGlobalHookRunner();
  if (!hookRunner?.hasHooks("before_tool_call")) {
    return { blocked: false, params };
  }
  try {
    const normalizedParams = isPlainObject(params) ? params : {};
    const hookResult = await hookRunner.runBeforeToolCall(
      {
        toolName,
        params: normalizedParams,
      },
      {
        toolName,
        agentId: args.ctx?.agentId,
        sessionKey: args.ctx?.sessionKey,
      },
    );

    if (hookResult?.block) {
      return {
        blocked: true,
        reason: hookResult.blockReason || "Tool call blocked by plugin hook",
      };
    }

    if (hookResult?.params && isPlainObject(hookResult.params)) {
      if (isPlainObject(params)) {
        return { blocked: false, params: { ...params, ...hookResult.params } };
      }
      return { blocked: false, params: hookResult.params };
    }
  } catch (err) {
    const toolCallId = args.toolCallId ? ` toolCallId=${args.toolCallId}` : "";
    log.warn(`before_tool_call hook failed: tool=${toolName}${toolCallId} error=${String(err)}`);
  }

  return { blocked: false, params };
}

/**
 * Check reachability requirements for a tool before execution.
 * Uses the AAS tool surface metadata + reachability graph to verify
 * that required capabilities (READ/WRITE/NETWORK/AUTH/ELEVATED) are met.
 */
async function checkToolReachability(
  toolName: string,
  params: unknown,
  ctx?: HookContext,
): Promise<{ blocked: boolean; reason?: string }> {
  const metadata = getToolMetadata(toolName);
  if (!metadata) {
    return { blocked: false }; // Unknown tool — skip check
  }

  // Build reachability context from tool params + hook context
  const record = isPlainObject(params) ? params : {};
  const targetPath =
    typeof record.path === "string"
      ? record.path
      : typeof record.file_path === "string"
        ? record.file_path
        : undefined;
  const reachCtx: ReachabilityCheckContext = {
    workspaceDir: ctx?.workspaceDir ?? process.cwd(),
    toolName,
    targetPath,
  };

  // Collect required reachability types from all context areas
  const requiredTypes = new Set<import("./aas/types.js").ReachabilityType>();
  for (const areaId of metadata.contextAreas) {
    const area = CONTEXT_AREAS[areaId];
    if (area?.requiredReachability) {
      for (const type of area.requiredReachability) {
        requiredTypes.add(type);
      }
    }
  }

  // Validate context area transitions if tool has reachability edges
  if (metadata.reachabilityEdges && metadata.reachabilityEdges.length > 0) {
    for (const edge of metadata.reachabilityEdges) {
      // Parse edge format: "from->to"
      const match = edge.match(/^(.+?)\s*->\s*(.+)$/);
      if (match) {
        const [, fromArea, toArea] = match;
        try {
          const validation = await validateReachability(fromArea, toArea, reachCtx);
          if (!validation.valid) {
            const reason = `Tool "${toolName}" transition ${fromArea} -> ${toArea} invalid: ${validation.reason ?? "missing capabilities"}`;
            if (ctx?.reachabilityEnforcement === "block") {
              return { blocked: true, reason };
            }
            log.warn(reason);
          }
        } catch (err) {
          log.warn(
            `reachability validation failed for tool=${toolName} edge=${edge}: ${String(err)}`,
          );
          // Don't block on validation failure — fail open
        }
      }
    }
  }

  if (requiredTypes.size === 0) {
    return { blocked: false };
  }

  try {
    const result = await checkReachability([...requiredTypes], reachCtx);
    if (!result.available) {
      const reason = `Tool "${toolName}" requires capabilities not available: ${result.missing.join(", ")}`;
      if (ctx?.reachabilityEnforcement === "block") {
        return { blocked: true, reason };
      }
      log.warn(reason);
    }
  } catch (err) {
    log.warn(`reachability check failed for tool=${toolName}: ${String(err)}`);
    // Don't block on check failure — fail open
  }

  return { blocked: false };
}

export function wrapToolWithBeforeToolCallHook(
  tool: AnyAgentTool,
  ctx?: HookContext,
): AnyAgentTool {
  const execute = tool.execute;
  if (!execute) {
    return tool;
  }
  const toolName = tool.name || "tool";
  return {
    ...tool,
    execute: async (toolCallId, params, signal, onUpdate) => {
      const outcome = await runBeforeToolCallHook({
        toolName,
        params,
        toolCallId,
        ctx,
      });
      if (outcome.blocked) {
        throw new Error(outcome.reason);
      }
      // AAS reachability pre-check: verify tool capabilities are available
      const reachResult = await checkToolReachability(toolName, outcome.params, ctx);
      if (reachResult.blocked) {
        throw new Error(reachResult.reason ?? "Tool blocked by reachability check");
      }
      // Emit personality-flavored tool start log via synonym dictionary
      const dict = ctx?.synonymDictionary ?? globalSynonymDictionary;
      if (dict) {
        try {
          const msg = formatToolStart(toolName, { synonymDictionary: dict });
          log.debug(`[personality] ${msg}`);
        } catch {
          // Non-fatal: synonym formatting is advisory
        }
      }
      // Snapshot continuation before self-edits so the dev server can recover context
      if (isPlainObject(outcome.params)) {
        maybeSnapshotDevContinuation({
          toolName,
          params: outcome.params,
          toolCallId,
          sessionKey: ctx?.sessionKey,
        });
      }
      return await execute(toolCallId, outcome.params, signal, onUpdate);
    },
  };
}

export const __testing = {
  runBeforeToolCallHook,
  isPlainObject,
};
