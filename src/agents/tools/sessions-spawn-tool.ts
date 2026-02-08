import { Type } from "@sinclair/typebox";
import crypto from "node:crypto";
import type { GatewayMessageChannel } from "../../utils/message-channel.js";
import type { AnyAgentTool } from "./common.js";
import { formatThinkingLevels, normalizeThinkLevel } from "../../auto-reply/thinking.js";
import { loadConfig } from "../../config/config.js";
import { callGateway } from "../../gateway/call.js";
import {
  isSubagentSessionKey,
  normalizeAgentId,
  parseAgentSessionKey,
} from "../../routing/session-key.js";
import { normalizeDeliveryContext } from "../../utils/delivery-context.js";
import { resolveAgentConfig } from "../agent-scope.js";
import { selectAgentForTask } from "../evolution/dytopo-sessions-integration.js";
import { AGENT_LANE_SUBAGENT } from "../lanes.js";
import { optionalStringEnum } from "../schema/typebox.js";
import { buildSubagentSystemPrompt } from "../subagent-announce.js";
import { registerSubagentRun } from "../subagent-registry.js";
import { jsonResult, readStringParam } from "./common.js";
import {
  resolveDisplaySessionKey,
  resolveInternalSessionKey,
  resolveMainSessionAlias,
} from "./sessions-helpers.js";

/**
 * Agent roles for multi-agent deliberation pattern.
 * - executor: Default role, executes the task
 * - critic: Devil's advocate, finds flaws and risks in proposed approaches
 * - reviewer: Evaluates quality and completeness of work
 */
export type AgentRole = "executor" | "critic" | "reviewer";

const SessionsSpawnToolSchema = Type.Object({
  task: Type.String(),
  label: Type.Optional(Type.String()),
  agentId: Type.Optional(Type.String()),
  model: Type.Optional(Type.String()),
  thinking: Type.Optional(Type.String()),
  runTimeoutSeconds: Type.Optional(Type.Number({ minimum: 0 })),
  // Back-compat alias. Prefer runTimeoutSeconds.
  timeoutSeconds: Type.Optional(Type.Number({ minimum: 0 })),
  cleanup: optionalStringEnum(["delete", "keep"] as const),
  /** Role for multi-agent deliberation. Affects the system prompt. */
  role: optionalStringEnum(["executor", "critic", "reviewer"] as const),
});

/**
 * Role-specific system prompt prefixes for multi-agent deliberation.
 */
const ROLE_PROMPTS: Record<AgentRole, string> = {
  executor: "",
  critic: `# Critical Evaluator Role

Your role is to **critically evaluate and find flaws** in the proposed approach.

## Your Mandate
- Look for hidden assumptions, edge cases, and failure modes
- Identify security vulnerabilities, race conditions, and scalability issues
- Question whether the approach is the best one, or if alternatives exist
- Be skeptical but constructive - provide specific concerns with reasoning
- If you find no significant issues, explicitly state that

## Output Format
1. **Assessment**: Your overall verdict (approve/concerns/reject)
2. **Issues Found**: List each concern with severity (critical/moderate/minor)
3. **Recommendations**: Concrete suggestions to address issues
4. **Blind Spots**: What might we be missing?

---

`,
  reviewer: `# Quality Reviewer Role

Your role is to **review the quality and completeness** of the work.

## Your Mandate
- Verify requirements are fully addressed
- Check for consistency and correctness
- Ensure edge cases are handled
- Validate that the solution is maintainable and documented
- Assess whether this is production-ready

## Output Format
1. **Completeness**: What percentage of requirements are met?
2. **Quality Score**: Rate 1-10 with justification
3. **Gaps**: What's missing or incomplete?
4. **Suggestions**: Improvements for production readiness

---

`,
};

function splitModelRef(ref?: string) {
  if (!ref) {
    return { provider: undefined, model: undefined };
  }
  const trimmed = ref.trim();
  if (!trimmed) {
    return { provider: undefined, model: undefined };
  }
  const [provider, model] = trimmed.split("/", 2);
  if (model) {
    return { provider, model };
  }
  return { provider: undefined, model: trimmed };
}

function normalizeModelSelection(value: unknown): string | undefined {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed || undefined;
  }
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const primary = (value as { primary?: unknown }).primary;
  if (typeof primary === "string" && primary.trim()) {
    return primary.trim();
  }
  return undefined;
}

export function createSessionsSpawnTool(opts?: {
  agentSessionKey?: string;
  agentChannel?: GatewayMessageChannel;
  agentAccountId?: string;
  agentTo?: string;
  agentThreadId?: string | number;
  agentGroupId?: string | null;
  agentGroupChannel?: string | null;
  agentGroupSpace?: string | null;
  sandboxed?: boolean;
  /** Explicit agent ID override for cron/hook sessions where session key parsing may not work. */
  requesterAgentIdOverride?: string;
}): AnyAgentTool {
  return {
    label: "Sessions",
    name: "sessions_spawn",
    description:
      "Spawn a background sub-agent run in an isolated session and announce the result back to the requester chat.",
    parameters: SessionsSpawnToolSchema,
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const task = readStringParam(params, "task", { required: true });
      const label = typeof params.label === "string" ? params.label.trim() : "";
      const requestedAgentId = readStringParam(params, "agentId");
      const modelOverride = readStringParam(params, "model");
      const thinkingOverrideRaw = readStringParam(params, "thinking");
      const cleanup =
        params.cleanup === "keep" || params.cleanup === "delete" ? params.cleanup : "keep";
      const requesterOrigin = normalizeDeliveryContext({
        channel: opts?.agentChannel,
        accountId: opts?.agentAccountId,
        to: opts?.agentTo,
        threadId: opts?.agentThreadId,
      });
      const DEFAULT_SUBAGENT_TIMEOUT_SECONDS = 600; // 10 minutes
      const runTimeoutSeconds = (() => {
        const explicit =
          typeof params.runTimeoutSeconds === "number" && Number.isFinite(params.runTimeoutSeconds)
            ? Math.max(0, Math.floor(params.runTimeoutSeconds))
            : undefined;
        if (explicit !== undefined) {
          return explicit;
        }
        const legacy =
          typeof params.timeoutSeconds === "number" && Number.isFinite(params.timeoutSeconds)
            ? Math.max(0, Math.floor(params.timeoutSeconds))
            : undefined;
        return legacy ?? DEFAULT_SUBAGENT_TIMEOUT_SECONDS;
      })();
      let modelWarning: string | undefined;
      let modelApplied = false;

      const cfg = loadConfig();
      const { mainKey, alias } = resolveMainSessionAlias(cfg);
      const requesterSessionKey = opts?.agentSessionKey;
      if (typeof requesterSessionKey === "string" && isSubagentSessionKey(requesterSessionKey)) {
        return jsonResult({
          status: "forbidden",
          error: "sessions_spawn is not allowed from sub-agent sessions",
        });
      }
      const requesterInternalKey = requesterSessionKey
        ? resolveInternalSessionKey({
            key: requesterSessionKey,
            alias,
            mainKey,
          })
        : alias;
      const requesterDisplayKey = resolveDisplaySessionKey({
        key: requesterInternalKey,
        alias,
        mainKey,
      });

      const requesterAgentId = normalizeAgentId(
        opts?.requesterAgentIdOverride ?? parseAgentSessionKey(requesterInternalKey)?.agentId,
      );

      // Determine target agent using DyTopo if no explicit agentId provided
      let targetAgentId: string;
      let selectionReasoning: string;

      if (requestedAgentId) {
        // Explicit agent override - use directly
        targetAgentId = normalizeAgentId(requestedAgentId);
        selectionReasoning = "Explicit agentId provided in request";
      } else {
        // Use DyTopo for agent selection
        try {
          const allowAgents =
            resolveAgentConfig(cfg, requesterAgentId)?.subagents?.allowAgents ?? [];
          const availableAgents = allowAgents.includes("*") ? undefined : allowAgents;

          const dyTopoSelection = selectAgentForTask(task, availableAgents);
          targetAgentId = normalizeAgentId(dyTopoSelection.agentId);
          selectionReasoning = `DyTopo selection (${(dyTopoSelection.confidence * 100).toFixed(0)}% confidence): ${dyTopoSelection.reasoning}`;

          // Log the DyTopo selection for observability
          console.log(`[sessions_spawn] DyTopo agent selection:`, {
            task: task.slice(0, 100) + (task.length > 100 ? "..." : ""),
            selectedAgent: targetAgentId,
            confidence: dyTopoSelection.confidence,
            reasoning: dyTopoSelection.reasoning,
            availableAgents,
          });
        } catch (err) {
          // Fallback to requester agent if DyTopo fails
          targetAgentId = requesterAgentId;
          selectionReasoning = `DyTopo failed (${err instanceof Error ? err.message : "unknown error"}), fallback to requester agent`;
          console.warn(`[sessions_spawn] DyTopo selection failed, using fallback:`, err);
        }
      }
      if (targetAgentId !== requesterAgentId) {
        const allowAgents = resolveAgentConfig(cfg, requesterAgentId)?.subagents?.allowAgents ?? [];
        const allowAny = allowAgents.some((value) => value.trim() === "*");
        const normalizedTargetId = targetAgentId.toLowerCase();
        const allowSet = new Set(
          allowAgents
            .filter((value) => value.trim() && value.trim() !== "*")
            .map((value) => normalizeAgentId(value).toLowerCase()),
        );
        if (!allowAny && !allowSet.has(normalizedTargetId)) {
          const allowedText = allowAny
            ? "*"
            : allowSet.size > 0
              ? Array.from(allowSet).join(", ")
              : "none";
          return jsonResult({
            status: "forbidden",
            error: `agentId is not allowed for sessions_spawn (allowed: ${allowedText})`,
          });
        }
      }
      const childSessionKey = `agent:${targetAgentId}:subagent:${crypto.randomUUID()}`;
      const spawnedByKey = requesterInternalKey;
      const targetAgentConfig = resolveAgentConfig(cfg, targetAgentId);
      const resolvedModel =
        normalizeModelSelection(modelOverride) ??
        normalizeModelSelection(targetAgentConfig?.subagents?.model) ??
        normalizeModelSelection(cfg.agents?.defaults?.subagents?.model);

      const resolvedThinkingDefaultRaw =
        readStringParam(targetAgentConfig?.subagents ?? {}, "thinking") ??
        readStringParam(cfg.agents?.defaults?.subagents ?? {}, "thinking");

      let thinkingOverride: string | undefined;
      const thinkingCandidateRaw = thinkingOverrideRaw || resolvedThinkingDefaultRaw;
      if (thinkingCandidateRaw) {
        const normalized = normalizeThinkLevel(thinkingCandidateRaw);
        if (!normalized) {
          const { provider, model } = splitModelRef(resolvedModel);
          const hint = formatThinkingLevels(provider, model);
          return jsonResult({
            status: "error",
            error: `Invalid thinking level "${thinkingCandidateRaw}". Use one of: ${hint}.`,
          });
        }
        thinkingOverride = normalized;
      }
      if (resolvedModel) {
        try {
          await callGateway({
            method: "sessions.patch",
            params: { key: childSessionKey, model: resolvedModel },
            timeoutMs: 10_000,
          });
          modelApplied = true;
        } catch (err) {
          const messageText =
            err instanceof Error ? err.message : typeof err === "string" ? err : "error";
          const recoverable =
            messageText.includes("invalid model") || messageText.includes("model not allowed");
          if (!recoverable) {
            return jsonResult({
              status: "error",
              error: messageText,
              childSessionKey,
            });
          }
          modelWarning = messageText;
        }
      }
      // Extract role for multi-agent deliberation
      const role =
        params.role === "executor" || params.role === "critic" || params.role === "reviewer"
          ? (params.role as AgentRole)
          : "executor";
      const rolePromptPrefix = ROLE_PROMPTS[role];

      const baseSystemPrompt = buildSubagentSystemPrompt({
        requesterSessionKey,
        requesterOrigin,
        childSessionKey,
        label: label || undefined,
        task,
        timeoutSeconds: runTimeoutSeconds > 0 ? runTimeoutSeconds : undefined,
      });

      // Prepend role-specific prompt for critic/reviewer roles
      const childSystemPrompt = rolePromptPrefix
        ? rolePromptPrefix + baseSystemPrompt
        : baseSystemPrompt;

      const childIdem = crypto.randomUUID();
      let childRunId: string = childIdem;
      try {
        const response = await callGateway<{ runId: string }>({
          method: "agent",
          params: {
            message: task,
            sessionKey: childSessionKey,
            channel: requesterOrigin?.channel,
            idempotencyKey: childIdem,
            deliver: false,
            lane: AGENT_LANE_SUBAGENT,
            extraSystemPrompt: childSystemPrompt,
            thinking: thinkingOverride,
            timeout: runTimeoutSeconds > 0 ? runTimeoutSeconds : undefined,
            label: label || undefined,
            spawnedBy: spawnedByKey,
            groupId: opts?.agentGroupId ?? undefined,
            groupChannel: opts?.agentGroupChannel ?? undefined,
            groupSpace: opts?.agentGroupSpace ?? undefined,
          },
          timeoutMs: 10_000,
        });
        if (typeof response?.runId === "string" && response.runId) {
          childRunId = response.runId;
        }
      } catch (err) {
        const messageText =
          err instanceof Error ? err.message : typeof err === "string" ? err : "error";
        return jsonResult({
          status: "error",
          error: messageText,
          childSessionKey,
          runId: childRunId,
        });
      }

      registerSubagentRun({
        runId: childRunId,
        childSessionKey,
        requesterSessionKey: requesterInternalKey,
        requesterOrigin,
        requesterDisplayKey,
        task,
        cleanup,
        label: label || undefined,
        runTimeoutSeconds,
      });

      return jsonResult({
        status: "accepted",
        childSessionKey,
        runId: childRunId,
        modelApplied: resolvedModel ? modelApplied : undefined,
        warning: modelWarning,
        role: role !== "executor" ? role : undefined,
        agentSelection: {
          selectedAgent: targetAgentId,
          reasoning: selectionReasoning,
        },
      });
    },
  };
}
