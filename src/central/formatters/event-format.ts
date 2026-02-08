import type { EventFrame } from "../../gateway/protocol/index.js";
import type { ActivityEntry, ActivityKind } from "../types.js";

/**
 * Extract agent ID from session key ("pi:main" → "pi") or payload fields.
 */
function extractAgentId(event: string, payload: Record<string, unknown>): string {
  // Direct agentId field
  if (typeof payload.agentId === "string" && payload.agentId) {
    return payload.agentId;
  }
  // Derive from sessionKey (format: "agentId:sessionName")
  if (typeof payload.sessionKey === "string" && payload.sessionKey) {
    const colon = payload.sessionKey.indexOf(":");
    if (colon > 0) {
      return payload.sessionKey.slice(0, colon);
    }
    return payload.sessionKey;
  }
  // System events
  if (event === "heartbeat" || event === "cron" || event === "tick") {
    return "system";
  }
  if (event === "health" || event === "presence" || event === "shutdown") {
    return "system";
  }
  return "—";
}

function getData(payload: Record<string, unknown>): Record<string, unknown> {
  return typeof payload.data === "object" && payload.data
    ? (payload.data as Record<string, unknown>)
    : {};
}

function classifyAgentEvent(payload: Record<string, unknown>): ActivityKind {
  const stream = typeof payload.stream === "string" ? payload.stream : "";
  const data = getData(payload);

  if (stream === "lifecycle") {
    const phase = data.phase;
    if (phase === "error") {
      return "error";
    }
    return "lifecycle";
  }
  if (stream === "tool") {
    const phase = data.phase;
    if (phase === "start") {
      return "tool_start";
    }
    return "tool_result";
  }
  if (stream === "assistant") {
    return "assistant";
  }
  if (stream === "error") {
    return "error";
  }
  if (stream === "compaction") {
    return "info";
  }
  return "info";
}

function classifyEvent(event: string, payload: Record<string, unknown>): ActivityKind {
  if (event === "agent") {
    return classifyAgentEvent(payload);
  }
  if (event === "chat") {
    const state = typeof payload.state === "string" ? payload.state : "";
    if (state === "error") {
      return "error";
    }
    return "assistant";
  }
  return "info";
}

function truncate(s: string, max: number): string {
  if (s.length <= max) {
    return s;
  }
  return s.slice(0, max) + "…";
}

function extractChatText(payload: Record<string, unknown>): string {
  const msg = payload.message as Record<string, unknown> | undefined;
  if (!msg) {
    return "";
  }
  const content = msg.content;
  if (Array.isArray(content)) {
    for (const part of content) {
      if (typeof part === "object" && part && (part as Record<string, unknown>).type === "text") {
        const text = (part as Record<string, unknown>).text;
        if (typeof text === "string") {
          return text;
        }
      }
    }
  }
  if (typeof msg.text === "string") {
    return msg.text;
  }
  return "";
}

function summarizeAgentEvent(payload: Record<string, unknown>): string {
  const stream = typeof payload.stream === "string" ? payload.stream : "";
  const data = getData(payload);

  if (stream === "lifecycle") {
    const phase = typeof data.phase === "string" ? data.phase : "?";
    if (phase === "error" && typeof data.error === "string") {
      return `lifecycle error: ${truncate(data.error, 100)}`;
    }
    return `lifecycle: ${phase}`;
  }

  if (stream === "tool") {
    const phase = typeof data.phase === "string" ? data.phase : "?";
    const name = typeof data.name === "string" ? data.name : "?";
    if (phase === "start") {
      const args = data.args;
      let argSummary = "";
      if (typeof args === "object" && args) {
        const entries = Object.entries(args as Record<string, unknown>);
        const parts = entries.slice(0, 3).map(([k, v]) => {
          const val = typeof v === "string" ? truncate(v, 60) : JSON.stringify(v);
          return `${k}=${val}`;
        });
        argSummary = parts.join(", ");
      }
      return argSummary ? `tool:${name}(${truncate(argSummary, 120)})` : `tool:${name}`;
    }
    if (phase === "result") {
      const isError = data.isError === true;
      const meta = typeof data.meta === "string" ? ` [${data.meta}]` : "";
      const resultStr = (() => {
        if (data.result == null) {
          return "";
        }
        if (typeof data.result === "string") {
          return truncate(data.result, 100);
        }
        return truncate(JSON.stringify(data.result), 100);
      })();
      return isError
        ? `tool:${name} ERROR${meta} ${resultStr}`
        : `tool:${name} → ${resultStr}${meta}`;
    }
    if (phase === "update") {
      return `tool:${name} (updating…)`;
    }
    return `tool:${name} ${phase}`;
  }

  if (stream === "assistant") {
    const text = typeof data.text === "string" ? data.text : "";
    const delta = typeof data.delta === "string" ? data.delta : "";
    // Show the delta for streaming, or full text if no delta
    const display = delta || text;
    if (!display) {
      return "assistant (empty)";
    }
    return truncate(display.replaceAll("\n", " "), 120);
  }

  if (stream === "compaction") {
    const phase = typeof data.phase === "string" ? data.phase : "?";
    return `compaction: ${phase}`;
  }

  if (stream === "error") {
    const reason = typeof data.reason === "string" ? data.reason : "";
    const message = typeof data.message === "string" ? data.message : "";
    return `error: ${reason || message || "unknown"}`;
  }

  if (stream === "debug") {
    const message = typeof data.message === "string" ? data.message : "";
    return `debug: ${truncate(message, 100)}`;
  }

  return `stream:${stream}`;
}

function summarizeEvent(event: string, payload: Record<string, unknown>): string {
  if (event === "agent") {
    return summarizeAgentEvent(payload);
  }
  if (event === "chat") {
    const state = typeof payload.state === "string" ? payload.state : "";
    if (state === "error") {
      const msg =
        typeof payload.errorMessage === "string" ? payload.errorMessage.slice(0, 80) : "error";
      return `chat error: ${msg}`;
    }
    if (state === "final") {
      const text = extractChatText(payload);
      return text ? `chat final: ${truncate(text.replaceAll("\n", " "), 120)}` : "chat final";
    }
    if (state === "delta") {
      const text = extractChatText(payload);
      return text ? truncate(text.replaceAll("\n", " "), 120) : "chat delta";
    }
    return `chat: ${state}`;
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
  if (event === "shutdown") {
    const reason = typeof payload.reason === "string" ? payload.reason : "";
    return reason ? `shutdown: ${reason}` : "shutdown";
  }
  return event;
}

/** Convert a raw gateway EventFrame into an ActivityEntry with full payload. */
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
    payload,
    eventName: frame.event,
  };
}
