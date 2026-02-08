import type {
  AgentSummary,
  EventFrame,
  HelloOk,
  PresenceEntry,
} from "../gateway/protocol/index.js";

// ── Panel focus ──────────────────────────────────────────────────────
export type PanelId = "agents" | "activity" | "session";

// ── Agent info enriched with live run data ───────────────────────────
export type AgentInfo = AgentSummary & {
  activeRuns: number;
  lastActivityTs: number | null;
};

// ── Session summary from sessions.list ───────────────────────────────
export type SessionSummary = {
  key: string;
  sessionId?: string;
  updatedAt?: number | null;
  model?: string;
  contextTokens?: number | null;
  totalTokens?: number | null;
  label?: string;
  displayName?: string;
};

// ── Activity feed entry ──────────────────────────────────────────────
export type ActivityKind =
  | "tool_start"
  | "tool_result"
  | "assistant"
  | "lifecycle"
  | "error"
  | "state_change"
  | "info";

export type ActivityEntry = {
  ts: number;
  agentId: string;
  kind: ActivityKind;
  summary: string;
  /** Raw event payload for drill-in inspection. */
  payload: Record<string, unknown>;
  /** Gateway event name (e.g. "agent", "chat", "health"). */
  eventName: string;
};

// ── Health summary (loose shape — gateway returns opaque payload) ────
export type HealthSummary = Record<string, unknown>;

// ── Dashboard state ──────────────────────────────────────────────────
export type DashboardState = {
  connected: boolean;
  hello: HelloOk | null;
  uptimeMs: number;
  agents: AgentInfo[];
  sessions: SessionSummary[];
  activityFeed: ActivityEntry[];
  presence: PresenceEntry[];
  health: HealthSummary | null;
  // UI
  focusedPanel: PanelId;
  selectedAgentIndex: number;
  selectedSessionIndex: number;
  sessionDrillKey: string | null;
  activityScrollOffset: number;
  activitySelectedIndex: number;
  expandedActivityIndex: number | null;
  sessionScrollOffset: number;
};

// ── Reducer actions ──────────────────────────────────────────────────
export type DashboardAction =
  | { type: "SET_CONNECTED"; connected: boolean }
  | { type: "SET_HELLO"; hello: HelloOk }
  | { type: "SET_AGENTS"; agents: AgentSummary[] }
  | { type: "SET_SESSIONS"; sessions: SessionSummary[] }
  | { type: "SET_HEALTH"; health: HealthSummary }
  | { type: "SET_PRESENCE"; presence: PresenceEntry[] }
  | { type: "AGENT_RUN_START"; agentId: string; runId: string }
  | { type: "AGENT_RUN_END"; agentId: string; runId: string }
  | { type: "ADD_ACTIVITY"; entry: ActivityEntry }
  | { type: "CLEAR_ACTIVITY" }
  | { type: "TICK"; uptimeMs: number }
  | { type: "FOCUS_PANEL"; panel: PanelId }
  | { type: "SELECT_AGENT"; index: number }
  | { type: "SELECT_SESSION"; index: number }
  | { type: "DRILL_SESSION"; key: string | null }
  | { type: "SCROLL_ACTIVITY"; offset: number }
  | { type: "SELECT_ACTIVITY"; index: number }
  | { type: "TOGGLE_EXPAND_ACTIVITY"; index: number }
  | { type: "SCROLL_SESSION"; offset: number }
  | { type: "GATEWAY_EVENT"; event: EventFrame };

// ── Max entries for the activity ring buffer ─────────────────────────
export const MAX_ACTIVITY_ENTRIES = 500;

// ── Client options (mirrors CLI flags) ───────────────────────────────
export type CentralClientOptions = {
  url?: string;
  token?: string;
  password?: string;
};
