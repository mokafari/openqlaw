import { createContext, useContext, useReducer, type Dispatch } from "react";
import type { AgentSummary, PresenceEntry } from "../gateway/protocol/index.js";
import type {
  AgentInfo,
  DashboardAction,
  DashboardState,
  HealthSummary,
  RunInfo,
  ToolCall,
} from "./types.js";
import { formatGatewayEvent } from "./formatters/event-format.js";
import { MAX_ACTIVITY_ENTRIES, MAX_RUNS } from "./types.js";

// ── Initial state ────────────────────────────────────────────────────
export const initialState: DashboardState = {
  connected: false,
  hello: null,
  uptimeMs: 0,
  agents: [],
  sessions: [],
  runs: [],
  activityFeed: [],
  presence: [],
  health: null,
  focusedPanel: "runs",
  runsSelectedIndex: 0,
  logSelectedIndex: 0,
  logExpandedIndex: null,
  detailRunId: null,
};

// ── Helpers ──────────────────────────────────────────────────────────
function toAgentInfo(agent: AgentSummary): AgentInfo {
  return { ...agent, activeRuns: 0, lastActivityTs: null };
}

function mergeAgents(existing: AgentInfo[], incoming: AgentSummary[]): AgentInfo[] {
  const byId = new Map(existing.map((a) => [a.id, a]));
  return incoming.map((a) => {
    const prev = byId.get(a.id);
    return prev ? { ...prev, ...a } : toAgentInfo(a);
  });
}

function pushActivity(
  feed: readonly import("./types.js").ActivityEntry[],
  entry: import("./types.js").ActivityEntry,
): import("./types.js").ActivityEntry[] {
  const next = [...feed, entry];
  return next.length > MAX_ACTIVITY_ENTRIES ? next.slice(next.length - MAX_ACTIVITY_ENTRIES) : next;
}

function agentFromSession(sessionKey: string): string {
  const colon = sessionKey.indexOf(":");
  return colon > 0 ? sessionKey.slice(0, colon) : sessionKey;
}

// ── Run tracking from agent events ───────────────────────────────────
function processAgentEventForRuns(
  runs: RunInfo[],
  agents: AgentInfo[],
  payload: Record<string, unknown>,
): { runs: RunInfo[]; agents: AgentInfo[] } {
  const stream = typeof payload.stream === "string" ? payload.stream : "";
  const data =
    typeof payload.data === "object" && payload.data
      ? (payload.data as Record<string, unknown>)
      : {};
  const phase = typeof data.phase === "string" ? data.phase : "";
  const runId = typeof payload.runId === "string" ? payload.runId : "";
  const sessionKey = typeof payload.sessionKey === "string" ? payload.sessionKey : "";

  if (!runId) {
    return { runs, agents };
  }

  const agentId = agentFromSession(sessionKey);

  // Lifecycle: start
  if (stream === "lifecycle" && phase === "start") {
    const existing = runs.find((r) => r.runId === runId);
    if (!existing) {
      const startedAt = typeof data.startedAt === "number" ? data.startedAt : Date.now();
      const newRun: RunInfo = {
        runId,
        sessionKey,
        agentId,
        status: "running",
        startedAt,
        tools: [],
        lastResponse: "",
      };
      const newRuns = [newRun, ...runs].slice(0, MAX_RUNS);
      const newAgents = agents.map((a) =>
        a.id === agentId ? { ...a, activeRuns: a.activeRuns + 1, lastActivityTs: Date.now() } : a,
      );
      return { runs: newRuns, agents: newAgents };
    }
    return { runs, agents };
  }

  // Lifecycle: end
  if (stream === "lifecycle" && (phase === "end" || phase === "error")) {
    const newRuns = runs.map((r) => {
      if (r.runId !== runId) {
        return r;
      }
      const endedAt = typeof data.endedAt === "number" ? data.endedAt : Date.now();
      const errorMessage =
        phase === "error" && typeof data.error === "string" ? data.error : undefined;
      return {
        ...r,
        status: (phase === "error" ? "error" : "completed") as RunInfo["status"],
        endedAt,
        errorMessage: errorMessage ?? r.errorMessage,
      };
    });
    const newAgents = agents.map((a) =>
      a.id === agentId
        ? { ...a, activeRuns: Math.max(0, a.activeRuns - 1), lastActivityTs: Date.now() }
        : a,
    );
    return { runs: newRuns, agents: newAgents };
  }

  // Tool: start
  if (stream === "tool" && phase === "start") {
    const toolCallId = typeof data.toolCallId === "string" ? data.toolCallId : "";
    const name = typeof data.name === "string" ? data.name : "?";
    const args =
      typeof data.args === "object" && data.args ? (data.args as Record<string, unknown>) : {};
    const tool: ToolCall = { toolCallId, name, args, startedAt: Date.now() };
    const newRuns = runs.map((r) => (r.runId === runId ? { ...r, tools: [...r.tools, tool] } : r));
    return { runs: newRuns, agents };
  }

  // Tool: result
  if (stream === "tool" && phase === "result") {
    const toolCallId = typeof data.toolCallId === "string" ? data.toolCallId : "";
    const isError = data.isError === true;
    const result = data.result;
    const meta = typeof data.meta === "string" ? data.meta : undefined;
    const newRuns = runs.map((r) => {
      if (r.runId !== runId) {
        return r;
      }
      const tools = r.tools.map((t) =>
        t.toolCallId === toolCallId ? { ...t, endedAt: Date.now(), isError, result, meta } : t,
      );
      return { ...r, tools };
    });
    return { runs: newRuns, agents };
  }

  // Assistant: accumulate final text (only if we get a final assistant event)
  if (stream === "assistant") {
    const text = typeof data.text === "string" ? data.text : "";
    if (text) {
      const newRuns = runs.map((r) => (r.runId === runId ? { ...r, lastResponse: text } : r));
      return { runs: newRuns, agents };
    }
  }

  return { runs, agents };
}

// ── Reducer ──────────────────────────────────────────────────────────
export function dashboardReducer(state: DashboardState, action: DashboardAction): DashboardState {
  switch (action.type) {
    case "SET_CONNECTED":
      return { ...state, connected: action.connected };

    case "SET_HELLO":
      return {
        ...state,
        hello: action.hello,
        connected: true,
        uptimeMs: action.hello.snapshot?.uptimeMs ?? 0,
        presence: action.hello.snapshot?.presence ?? [],
      };

    case "SET_AGENTS":
      return { ...state, agents: mergeAgents(state.agents, action.agents) };

    case "SET_SESSIONS":
      return { ...state, sessions: action.sessions };

    case "SET_HEALTH":
      return { ...state, health: action.health };

    case "SET_PRESENCE":
      return { ...state, presence: action.presence };

    case "ADD_ACTIVITY":
      return { ...state, activityFeed: pushActivity(state.activityFeed, action.entry) };

    case "CLEAR_ACTIVITY":
      return {
        ...state,
        activityFeed: [],
        logSelectedIndex: 0,
        logExpandedIndex: null,
      };

    case "TICK":
      return { ...state, uptimeMs: action.uptimeMs };

    case "FOCUS_PANEL":
      return { ...state, focusedPanel: action.panel };

    case "RUNS_SELECT":
      return { ...state, runsSelectedIndex: action.index };

    case "LOG_SELECT":
      return { ...state, logSelectedIndex: action.index };

    case "LOG_TOGGLE_EXPAND": {
      const isExpanded = state.logExpandedIndex === action.index;
      return { ...state, logExpandedIndex: isExpanded ? null : action.index };
    }

    case "DETAIL_RUN":
      return { ...state, detailRunId: action.runId };

    case "GATEWAY_EVENT": {
      const evt = action.event;
      let next = state;

      // Presence/health
      if (evt.event === "presence") {
        const payload = evt.payload as { presence?: PresenceEntry[] } | undefined;
        if (Array.isArray(payload?.presence)) {
          next = { ...next, presence: payload.presence };
        }
      } else if (evt.event === "health") {
        const payload = evt.payload as HealthSummary | undefined;
        if (payload) {
          next = { ...next, health: payload };
        }
      }

      // Run tracking from agent events
      if (evt.event === "agent") {
        const payload = evt.payload as Record<string, unknown> | undefined;
        if (payload) {
          const result = processAgentEventForRuns(next.runs, next.agents, payload);
          next = { ...next, runs: result.runs, agents: result.agents };
        }
      }

      // Filtered activity feed
      const entry = formatGatewayEvent(evt);
      if (entry) {
        const newFeed = pushActivity(next.activityFeed, entry);
        // Auto-follow: if user was at the latest, keep them there
        const wasAtEnd =
          next.logSelectedIndex >= next.activityFeed.length - 1 || next.activityFeed.length === 0;
        next = {
          ...next,
          activityFeed: newFeed,
          logSelectedIndex: wasAtEnd ? newFeed.length - 1 : next.logSelectedIndex,
        };
      }

      return next;
    }

    default:
      return state;
  }
}

// ── React context ────────────────────────────────────────────────────
export type DashboardStore = {
  state: DashboardState;
  dispatch: Dispatch<DashboardAction>;
};

export const DashboardContext = createContext<DashboardStore>({
  state: initialState,
  dispatch: () => {},
});

export function useDashboard(): DashboardStore {
  return useContext(DashboardContext);
}

export function useDashboardReducer() {
  return useReducer(dashboardReducer, initialState);
}
