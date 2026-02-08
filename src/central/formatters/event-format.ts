import type { EventFrame } from "../../gateway/protocol/index.js";
import type { ActivityEntry } from "../types.js";

// ── Helpers ──────────────────────────────────────────────────────────

function truncate(s: string, max: number): string {
  if (s.length <= max) {
    return s;
  }
  return s.slice(0, max) + "…";
}

function agentFromSession(sessionKey: string): string {
  const colon = sessionKey.indexOf(":");
  return colon > 0 ? sessionKey.slice(0, colon) : sessionKey;
}

function extractAgentId(event: string, payload: Record<string, unknown>): string {
  if (typeof payload.agentId === "string" && payload.agentId) {
    return payload.agentId;
  }
  if (typeof payload.sessionKey === "string" && payload.sessionKey) {
    return agentFromSession(payload.sessionKey);
  }
  if (event === "heartbeat" || event === "cron" || event === "tick") {
    return "system";
  }
  if (event === "health" || event === "presence" || event === "shutdown") {
    return "gateway";
  }
  return "—";
}

function getData(payload: Record<string, unknown>): Record<string, unknown> {
  return typeof payload.data === "object" && payload.data
    ? (payload.data as Record<string, unknown>)
    : {};
}

// ── Filtering: should we even create an entry? ───────────────────────

/**
 * Returns null if the event should be dropped (noisy delta/debug/etc).
 * Returns an ActivityEntry for events worth showing.
 */
export function formatGatewayEvent(frame: EventFrame): ActivityEntry | null {
  const payload =
    typeof frame.payload === "object" && frame.payload
      ? (frame.payload as Record<string, unknown>)
      : {};
  const event = frame.event;
  const ts = typeof payload.ts === "number" ? payload.ts : Date.now();
  const agentId = extractAgentId(event, payload);
  const runId = typeof payload.runId === "string" ? payload.runId : undefined;

  // ── Agent events ─────────────────────────────────────────────────
  if (event === "agent") {
    const stream = typeof payload.stream === "string" ? payload.stream : "";
    const data = getData(payload);
    const phase = typeof data.phase === "string" ? data.phase : "";

    // SKIP: assistant deltas, debug messages, compaction, tool updates
    if (stream === "assistant") {
      return null;
    }
    if (stream === "debug") {
      return null;
    }
    if (stream === "compaction") {
      return null;
    }
    if (stream === "tool" && phase === "update") {
      return null;
    }

    // Lifecycle events
    if (stream === "lifecycle") {
      if (phase === "start") {
        return { ts, agentId, kind: "lifecycle_start", summary: "run started", runId, payload };
      }
      if (phase === "end") {
        return { ts, agentId, kind: "lifecycle_end", summary: "run completed", runId, payload };
      }
      if (phase === "error") {
        const err = typeof data.error === "string" ? truncate(data.error, 100) : "unknown error";
        return { ts, agentId, kind: "error", summary: `run error: ${err}`, runId, payload };
      }
      return null;
    }

    // Tool start
    if (stream === "tool" && phase === "start") {
      const name = typeof data.name === "string" ? data.name : "?";
      const args = data.args;
      let argStr = "";
      if (typeof args === "object" && args) {
        const entries = Object.entries(args as Record<string, unknown>).slice(0, 3);
        argStr = entries
          .map(([k, v]) => {
            const val = typeof v === "string" ? truncate(v, 50) : JSON.stringify(v);
            return `${k}=${val}`;
          })
          .join(", ");
      }
      const summary = argStr ? `${name}(${truncate(argStr, 100)})` : name;
      return { ts, agentId, kind: "tool_start", summary, runId, payload };
    }

    // Tool result
    if (stream === "tool" && phase === "result") {
      const name = typeof data.name === "string" ? data.name : "?";
      const isError = data.isError === true;
      const meta = typeof data.meta === "string" ? ` [${data.meta}]` : "";
      let resultStr = "";
      if (data.result != null) {
        resultStr =
          typeof data.result === "string"
            ? truncate(data.result, 80)
            : truncate(JSON.stringify(data.result), 80);
      }
      const summary = isError
        ? `${name} FAILED${meta} ${resultStr}`
        : `${name} → ok${meta}${resultStr ? ` ${resultStr}` : ""}`;
      return { ts, agentId, kind: "tool_result", summary, runId, payload };
    }

    // Error stream
    if (stream === "error") {
      const reason = typeof data.reason === "string" ? data.reason : "";
      const message = typeof data.message === "string" ? data.message : "";
      return {
        ts,
        agentId,
        kind: "error",
        summary: reason || message || "unknown error",
        runId,
        payload,
      };
    }

    // Anything else from agent: skip
    return null;
  }

  // ── Chat events — only final and error ───────────────────────────
  if (event === "chat") {
    const state = typeof payload.state === "string" ? payload.state : "";
    if (state === "delta") {
      return null;
    }
    if (state === "error") {
      const msg =
        typeof payload.errorMessage === "string"
          ? truncate(payload.errorMessage, 100)
          : "chat error";
      return { ts, agentId, kind: "error", summary: msg, runId, payload };
    }
    if (state === "final") {
      const text = extractChatText(payload);
      const summary = text ? truncate(text.replaceAll("\n", " "), 120) : "response completed";
      return { ts, agentId, kind: "chat_final", summary, runId, payload };
    }
    return null;
  }

  // ── System events ────────────────────────────────────────────────
  if (event === "tick") {
    return null;
  }
  if (event === "health") {
    return { ts, agentId, kind: "system", summary: "health updated", payload };
  }
  if (event === "presence") {
    return { ts, agentId, kind: "system", summary: "presence updated", payload };
  }
  if (event === "shutdown") {
    const reason = typeof payload.reason === "string" ? payload.reason : "";
    return {
      ts,
      agentId,
      kind: "system",
      summary: reason ? `shutdown: ${reason}` : "shutdown",
      payload,
    };
  }
  if (event === "heartbeat") {
    return { ts, agentId, kind: "system", summary: "heartbeat", payload };
  }
  if (event === "cron") {
    const name = typeof payload.name === "string" ? payload.name : "";
    return { ts, agentId, kind: "system", summary: name ? `cron: ${name}` : "cron", payload };
  }

  // Generic fallback for unknown events
  return { ts, agentId, kind: "system", summary: event, payload };
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
