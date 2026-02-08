import type {
  AgentSummary,
  EventFrame,
  HelloOk,
  PresenceEntry,
} from "../gateway/protocol/index.js";

// ── Panel focus ──────────────────────────────────────────────────────
export type PanelId = "runs" | "log" | "detail";

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
  /** Parent session key if this session was spawned by another. */
  spawnedBy?: string;
};

// ── Per-run tracking ─────────────────────────────────────────────────
export type RunStatus = "running" | "completed" | "error";

export type ToolCall = {
  toolCallId: string;
  name: string;
  args: Record<string, unknown>;
  startedAt: number;
  endedAt?: number;
  isError?: boolean;
  result?: unknown;
  meta?: string;
};

export type RunInfo = {
  runId: string;
  sessionKey: string;
  agentId: string;
  status: RunStatus;
  startedAt: number;
  endedAt?: number;
  tools: ToolCall[];
  /** Last assistant text (final, not delta). */
  lastResponse: string;
  errorMessage?: string;
  /** Parent session key if this run's session was spawned by another. */
  spawnedBy?: string;
};

// ── Activity feed entry (filtered — no deltas/debug) ────────────────
export type ActivityKind =
  | "lifecycle_start"
  | "lifecycle_end"
  | "tool_start"
  | "tool_result"
  | "chat_final"
  | "error"
  | "system";

export type ActivityEntry = {
  ts: number;
  agentId: string;
  kind: ActivityKind;
  summary: string;
  runId?: string;
  /** Raw event payload for drill-in inspection. */
  payload: Record<string, unknown>;
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
  /** Runs indexed by runId — most recent first in the list view. */
  runs: RunInfo[];
  /** Filtered event log (no deltas/debug). */
  activityFeed: ActivityEntry[];
  presence: PresenceEntry[];
  health: HealthSummary | null;
  // UI
  focusedPanel: PanelId;
  runsSelectedIndex: number;
  logSelectedIndex: number;
  logExpandedIndex: number | null;
  /** Which run detail to show in the detail panel (null = last selected). */
  detailRunId: string | null;
};

// ── Reducer actions ──────────────────────────────────────────────────
export type DashboardAction =
  | { type: "SET_CONNECTED"; connected: boolean }
  | { type: "SET_HELLO"; hello: HelloOk }
  | { type: "SET_AGENTS"; agents: AgentSummary[] }
  | { type: "SET_SESSIONS"; sessions: SessionSummary[] }
  | { type: "SET_HEALTH"; health: HealthSummary }
  | { type: "SET_PRESENCE"; presence: PresenceEntry[] }
  | { type: "ADD_ACTIVITY"; entry: ActivityEntry }
  | { type: "CLEAR_ACTIVITY" }
  | { type: "TICK"; uptimeMs: number }
  | { type: "FOCUS_PANEL"; panel: PanelId }
  | { type: "RUNS_SELECT"; index: number }
  | { type: "LOG_SELECT"; index: number }
  | { type: "LOG_TOGGLE_EXPAND"; index: number }
  | { type: "DETAIL_RUN"; runId: string | null }
  | { type: "GATEWAY_EVENT"; event: EventFrame };

// ── Max entries ──────────────────────────────────────────────────────
export const MAX_ACTIVITY_ENTRIES = 500;
export const MAX_RUNS = 100;

// ── Client options (mirrors CLI flags) ───────────────────────────────
export type CentralClientOptions = {
  url?: string;
  token?: string;
  password?: string;
};
