import type { EventFrame } from "../../gateway/protocol/index.js";
import type { ActivityEntry, ActivityKind } from "../types.js";

/**
 * Attempt to extract a short agent ID from an agent/chat event payload.
 * Falls back to "system" for non-agent events.
 */
function extractAgentId(event: string, payload: Record<string, unknown>): string {
  if (typeof payload.agentId === "string") {
    return payload.agentId;
  }
  if (typeof payload.sessionKey === "string") {
    // Session keys often contain the agent id as prefix: "pi:main"
    const parts = payload.sessionKey.split(":");
    if (parts.length >= 1 && parts[0]) {
      return parts[0];
    }
  }
  if (event === "heartbeat" || event === "cron" || event === "tick") {
    return "system";
  }
  return "unknown";
}

function classifyEvent(event: string, payload: Record<string, unknown>): ActivityKind {
  if (event === "agent") {
    const stream = typeof payload.stream === "string" ? payload.stream : "";
    const data = typeof payload.data === "object" && payload.data ? payload.data : {};
    if (stream === "stderr" || "error" in data) {
      return "error";
    }
    if ("tool" in data || "toolName" in data || "tool_name" in data) {
      return "tool";
    }
    if ("state" in data || "fsmState" in data) {
      return "state_change";
    }
    return "completion";
  }
  if (event === "chat") {
    const state = typeof payload.state === "string" ? payload.state : "";
    if (state === "error") {
      return "error";
    }
    return "completion";
  }
  return "info";
}

function summarizeEvent(event: string, payload: Record<string, unknown>): string {
  if (event === "agent") {
    const data =
      typeof payload.data === "object" && payload.data
        ? (payload.data as Record<string, unknown>)
        : {};
    const toolName = data.tool ?? data.toolName ?? data.tool_name;
    if (typeof toolName === "string") {
      const input = typeof data.input === "string" ? data.input.slice(0, 60) : "";
      return input ? `tool:${toolName} ${input}` : `tool:${toolName}`;
    }
    const state = data.state ?? data.fsmState;
    if (typeof state === "string") {
      return `state → ${state}`;
    }
    const stream = typeof payload.stream === "string" ? payload.stream : "";
    if (stream === "stderr") {
      const msg = typeof data.message === "string" ? data.message.slice(0, 80) : "error";
      return msg;
    }
    return "completion";
  }
  if (event === "chat") {
    const state = typeof payload.state === "string" ? payload.state : "";
    if (state === "error") {
      const msg =
        typeof payload.errorMessage === "string" ? payload.errorMessage.slice(0, 80) : "error";
      return msg;
    }
    if (state === "final") {
      return "completion (final)";
    }
    return `chat ${state}`;
  }
  if (event === "heartbeat") {
    return "heartbeat";
  }
  if (event === "cron") {
    const name = typeof payload.name === "string" ? payload.name : "";
    return name ? `cron: ${name}` : "cron event";
  }
  if (event === "presence") {
    return "presence updated";
  }
  if (event === "health") {
    return "health updated";
  }
  return event;
}

/** Convert a raw gateway EventFrame into an ActivityEntry. */
export function formatGatewayEvent(frame: EventFrame): ActivityEntry {
  const payload =
    typeof frame.payload === "object" && frame.payload
      ? (frame.payload as Record<string, unknown>)
      : {};

  return {
    ts: typeof payload.ts === "number" ? payload.ts : Date.now(),
    agentId: extractAgentId(frame.event, payload),
    kind: classifyEvent(frame.event, payload),
    summary: summarizeEvent(frame.event, payload),
  };
}
