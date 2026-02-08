import { Box, useApp, useInput, useStdout } from "ink";
import React, { useCallback } from "react";
import type { CentralClient } from "./client.js";
import type { PanelId } from "./types.js";
import { KeybindingsBar } from "./components/keybindings-bar.js";
import { PanelFrame } from "./components/panel-frame.js";
import { StatusBar } from "./components/status-bar.js";
import { useGateway } from "./hooks/use-gateway.js";
import { ActivityPanel } from "./panels/activity-panel.js";
import { AgentsPanel } from "./panels/agents-panel.js";
import { SessionPanel } from "./panels/session-panel.js";
import { DashboardContext, useDashboardReducer } from "./store.js";

const PANEL_CYCLE: PanelId[] = ["agents", "activity", "session"];

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
    const next = PANEL_CYCLE[(idx + 1) % PANEL_CYCLE.length] ?? "agents";
    dispatch({ type: "FOCUS_PANEL", panel: next });
  }, [state.focusedPanel, dispatch]);

  useInput((input, key) => {
    // Global keys
    if (input === "q" || (key.ctrl && input === "c")) {
      exit();
      return;
    }
    if (input === "1") {
      dispatch({ type: "FOCUS_PANEL", panel: "agents" });
      return;
    }
    if (input === "2") {
      dispatch({ type: "FOCUS_PANEL", panel: "activity" });
      return;
    }
    if (input === "3") {
      dispatch({ type: "FOCUS_PANEL", panel: "session" });
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

    // Panel-specific keys
    if (state.focusedPanel === "agents") {
      if (key.upArrow || input === "k") {
        dispatch({
          type: "SELECT_AGENT",
          index: Math.max(0, state.selectedAgentIndex - 1),
        });
      } else if (key.downArrow || input === "j") {
        dispatch({
          type: "SELECT_AGENT",
          index: Math.min(state.agents.length - 1, state.selectedAgentIndex + 1),
        });
      } else if (key.return) {
        const agent = state.agents[state.selectedAgentIndex];
        if (agent) {
          dispatch({ type: "FOCUS_PANEL", panel: "session" });
        }
      }
    } else if (state.focusedPanel === "activity") {
      if (key.upArrow || input === "k") {
        dispatch({
          type: "SCROLL_ACTIVITY",
          offset: Math.max(0, state.activityScrollOffset - 1),
        });
      } else if (key.downArrow || input === "j") {
        dispatch({
          type: "SCROLL_ACTIVITY",
          offset: state.activityScrollOffset + 1,
        });
      } else if (input === "g") {
        dispatch({ type: "SCROLL_ACTIVITY", offset: 0 });
      } else if (input === "G") {
        dispatch({
          type: "SCROLL_ACTIVITY",
          offset: Math.max(0, state.activityFeed.length - 1),
        });
      } else if (input === "c") {
        dispatch({ type: "CLEAR_ACTIVITY" });
      }
    } else if (state.focusedPanel === "session") {
      if (key.escape) {
        dispatch({ type: "DRILL_SESSION", key: null });
      } else if (key.upArrow || input === "k") {
        dispatch({
          type: "SELECT_SESSION",
          index: Math.max(0, state.selectedSessionIndex - 1),
        });
      } else if (key.downArrow || input === "j") {
        dispatch({
          type: "SELECT_SESSION",
          index: Math.min(state.sessions.length - 1, state.selectedSessionIndex + 1),
        });
      } else if (key.return) {
        const session = state.sessions[state.selectedSessionIndex];
        if (session) {
          dispatch({ type: "DRILL_SESSION", key: session.key });
        }
      }
    }
  });

  // Right panel: Activity by default, Session when focused
  const rightPanel =
    state.focusedPanel === "session" ? (
      <PanelFrame title="Sessions" focused>
        <SessionPanel />
      </PanelFrame>
    ) : (
      <PanelFrame title="Activity" focused={state.focusedPanel === "activity"}>
        <ActivityPanel />
      </PanelFrame>
    );

  return (
    <DashboardContext.Provider value={{ state, dispatch }}>
      <Box flexDirection="column" height={rows}>
        <KeybindingsBar focusedPanel={state.focusedPanel} />
        <Box flexDirection="row" flexGrow={1}>
          <Box width="40%">
            <PanelFrame title="Agents" focused={state.focusedPanel === "agents"}>
              <AgentsPanel />
            </PanelFrame>
          </Box>
          <Box width="60%">{rightPanel}</Box>
        </Box>
        <StatusBar />
      </Box>
    </DashboardContext.Provider>
  );
}

export function App({ client }: AppProps) {
  return <Dashboard client={client} />;
}
