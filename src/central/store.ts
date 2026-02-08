import { createContext, useContext, useReducer, type Dispatch } from "react";
import type { AgentSummary, PresenceEntry } from "../gateway/protocol/index.js";
import type { AgentInfo, DashboardAction, DashboardState, HealthSummary } from "./types.js";
import { formatGatewayEvent } from "./formatters/event-format.js";
import { MAX_ACTIVITY_ENTRIES } from "./types.js";

// ── Initial state ────────────────────────────────────────────────────
export const initialState: DashboardState = {
  connected: false,
  hello: null,
  uptimeMs: 0,
  agents: [],
  sessions: [],
  activityFeed: [],
  presence: [],
  health: null,
  focusedPanel: "agents",
  selectedAgentIndex: 0,
  selectedSessionIndex: 0,
  sessionDrillKey: null,
  activityScrollOffset: 0,
  sessionScrollOffset: 0,
};

// ── Helpers ──────────────────────────────────────────────────────────
function toAgentInfo(agent: AgentSummary): AgentInfo {
  return { ...agent, activeRuns: 0, lastActivityTs: null };
}

function mergeAgents(existing: AgentInfo[], incoming: AgentSummary[]): AgentInfo[] {
  const byId = new Map(existing.map((a) => [a.id, a]));
  return incoming.map((a) => {
    const prev = byId.get(a.id);
    if (prev) {
      return { ...prev, ...a };
    }
    return toAgentInfo(a);
  });
}

function pushActivity(
  feed: readonly import("./types.js").ActivityEntry[],
  entry: import("./types.js").ActivityEntry,
): import("./types.js").ActivityEntry[] {
  const next = [...feed, entry];
  if (next.length > MAX_ACTIVITY_ENTRIES) {
    return next.slice(next.length - MAX_ACTIVITY_ENTRIES);
  }
  return next;
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

    case "AGENT_RUN_START": {
      const agents = state.agents.map((a) =>
        a.id === action.agentId
          ? { ...a, activeRuns: a.activeRuns + 1, lastActivityTs: Date.now() }
          : a,
      );
      return { ...state, agents };
    }

    case "AGENT_RUN_END": {
      const agents = state.agents.map((a) =>
        a.id === action.agentId
          ? { ...a, activeRuns: Math.max(0, a.activeRuns - 1), lastActivityTs: Date.now() }
          : a,
      );
      return { ...state, agents };
    }

    case "ADD_ACTIVITY":
      return { ...state, activityFeed: pushActivity(state.activityFeed, action.entry) };

    case "CLEAR_ACTIVITY":
      return { ...state, activityFeed: [], activityScrollOffset: 0 };

    case "TICK":
      return { ...state, uptimeMs: action.uptimeMs };

    case "FOCUS_PANEL":
      return { ...state, focusedPanel: action.panel };

    case "SELECT_AGENT":
      return { ...state, selectedAgentIndex: action.index };

    case "SELECT_SESSION":
      return { ...state, selectedSessionIndex: action.index };

    case "DRILL_SESSION":
      return { ...state, sessionDrillKey: action.key };

    case "SCROLL_ACTIVITY":
      return { ...state, activityScrollOffset: action.offset };

    case "SCROLL_SESSION":
      return { ...state, sessionScrollOffset: action.offset };

    case "GATEWAY_EVENT": {
      const evt = action.event;
      let next = state;

      // Dispatch presence/health events into state
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

      // Track agent run lifecycle
      if (evt.event === "agent") {
        const payload = evt.payload as Record<string, unknown> | undefined;
        if (payload) {
          const data =
            typeof payload.data === "object" && payload.data
              ? (payload.data as Record<string, unknown>)
              : {};
          const agentId = typeof payload.agentId === "string" ? payload.agentId : undefined;
          const runId = typeof payload.runId === "string" ? payload.runId : undefined;
          if (agentId && runId) {
            const lifecycle = data.lifecycle ?? data.event;
            if (lifecycle === "start" || lifecycle === "run_start") {
              const agents = next.agents.map((a) =>
                a.id === agentId
                  ? { ...a, activeRuns: a.activeRuns + 1, lastActivityTs: Date.now() }
                  : a,
              );
              next = { ...next, agents };
            } else if (lifecycle === "end" || lifecycle === "run_end" || lifecycle === "done") {
              const agents = next.agents.map((a) =>
                a.id === agentId
                  ? { ...a, activeRuns: Math.max(0, a.activeRuns - 1), lastActivityTs: Date.now() }
                  : a,
              );
              next = { ...next, agents };
            }
          }
        }
      }

      // Add to activity feed (skip noisy tick events)
      if (evt.event !== "tick") {
        const entry = formatGatewayEvent(evt);
        next = { ...next, activityFeed: pushActivity(next.activityFeed, entry) };
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
