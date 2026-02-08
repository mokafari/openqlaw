import { Box, useApp, useInput, useStdout } from "ink";
import React, { useCallback } from "react";
import type { CentralClient } from "./client.js";
import type { PanelId } from "./types.js";
import { KeybindingsBar } from "./components/keybindings-bar.js";
import { PanelFrame } from "./components/panel-frame.js";
import { StatusBar } from "./components/status-bar.js";
import { useGateway } from "./hooks/use-gateway.js";
import { ActivityPanel } from "./panels/activity-panel.js";
import { DetailPanel } from "./panels/detail-panel.js";
import { RunsPanel } from "./panels/runs-panel.js";
import { DashboardContext, useDashboardReducer } from "./store.js";

const PANEL_CYCLE: PanelId[] = ["runs", "log", "detail"];

type AppProps = {
  client: CentralClient;
};

function Dashboard({ client }: AppProps) {
  const [state, dispatch] = useDashboardReducer();
  const { exit } = useApp();
  const { stdout } = useStdout();
  const rows = stdout?.rows ?? 24;
  const { refresh } = useGateway({ client, dispatch });

  const cyclePanel = useCallback(() => {
    const idx = PANEL_CYCLE.indexOf(state.focusedPanel);
    const next = PANEL_CYCLE[(idx + 1) % PANEL_CYCLE.length] ?? "runs";
    dispatch({ type: "FOCUS_PANEL", panel: next });
  }, [state.focusedPanel, dispatch]);

  // Count total flat run entries for bounds checking
  const totalRunEntries = (() => {
    const agentIds = new Set(state.agents.map((a) => a.id));
    for (const run of state.runs) {
      agentIds.add(run.agentId);
    }
    let count = 0;
    for (const agentId of agentIds) {
      count += state.runs.filter((r) => r.agentId === agentId).length;
    }
    return count;
  })();

  useInput((input, key) => {
    // Global keys
    if (input === "q" || (key.ctrl && input === "c")) {
      exit();
      return;
    }
    if (input === "1") {
      dispatch({ type: "FOCUS_PANEL", panel: "runs" });
      return;
    }
    if (input === "2") {
      dispatch({ type: "FOCUS_PANEL", panel: "log" });
      return;
    }
    if (input === "3") {
      dispatch({ type: "FOCUS_PANEL", panel: "detail" });
      return;
    }
    if (key.tab) {
      cyclePanel();
      return;
    }
    if (input === "r") {
      void refresh();
      return;
    }

    // ── Runs panel ───────────────────────────────────────────────
    if (state.focusedPanel === "runs") {
      if (key.upArrow || input === "k") {
        dispatch({
          type: "RUNS_SELECT",
          index: Math.max(0, state.runsSelectedIndex - 1),
        });
      } else if (key.downArrow || input === "j") {
        dispatch({
          type: "RUNS_SELECT",
          index: Math.min(Math.max(0, totalRunEntries - 1), state.runsSelectedIndex + 1),
        });
      } else if (key.return) {
        // Open detail for selected run
        dispatch({ type: "FOCUS_PANEL", panel: "detail" });
      }
    }

    // ── Log panel ────────────────────────────────────────────────
    if (state.focusedPanel === "log") {
      if (key.upArrow || input === "k") {
        dispatch({
          type: "LOG_SELECT",
          index: Math.max(0, state.logSelectedIndex - 1),
        });
      } else if (key.downArrow || input === "j") {
        dispatch({
          type: "LOG_SELECT",
          index: Math.min(state.activityFeed.length - 1, state.logSelectedIndex + 1),
        });
      } else if (key.return) {
        dispatch({ type: "LOG_TOGGLE_EXPAND", index: state.logSelectedIndex });
      } else if (key.escape) {
        if (state.logExpandedIndex !== null) {
          dispatch({ type: "LOG_TOGGLE_EXPAND", index: state.logExpandedIndex });
        }
      } else if (input === "g") {
        dispatch({ type: "LOG_SELECT", index: 0 });
      } else if (input === "G") {
        dispatch({ type: "LOG_SELECT", index: Math.max(0, state.activityFeed.length - 1) });
      } else if (input === "c") {
        dispatch({ type: "CLEAR_ACTIVITY" });
      }
    }

    // ── Detail panel ─────────────────────────────────────────────
    if (state.focusedPanel === "detail") {
      if (key.escape) {
        dispatch({ type: "DETAIL_RUN", runId: null });
        dispatch({ type: "FOCUS_PANEL", panel: "runs" });
      }
    }
  });

  // Layout: top row (runs + log), bottom row (detail), status bar
  const topHeight = Math.max(8, Math.floor((rows - 3) * 0.6));
  const bottomHeight = Math.max(4, rows - 3 - topHeight);

  return (
    <DashboardContext.Provider value={{ state, dispatch }}>
      <Box flexDirection="column" height={rows}>
        <KeybindingsBar focusedPanel={state.focusedPanel} />
        {/* Top row: Runs + Event Log */}
        <Box flexDirection="row" height={topHeight}>
          <Box width="35%">
            <PanelFrame title="Runs" focused={state.focusedPanel === "runs"}>
              <RunsPanel />
            </PanelFrame>
          </Box>
          <Box width="65%">
            <PanelFrame title="Event Log" focused={state.focusedPanel === "log"}>
              <ActivityPanel />
            </PanelFrame>
          </Box>
        </Box>
        {/* Bottom row: Detail */}
        <Box height={bottomHeight}>
          <PanelFrame title="Detail" focused={state.focusedPanel === "detail"}>
            <DetailPanel />
          </PanelFrame>
        </Box>
        <StatusBar />
      </Box>
    </DashboardContext.Provider>
  );
}

export function App({ client }: AppProps) {
  return <Dashboard client={client} />;
}
