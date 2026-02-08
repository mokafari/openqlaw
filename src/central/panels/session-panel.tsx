import { Box, Text } from "ink";
import React from "react";
import type { SessionSummary } from "../types.js";
import { LOBSTER_PALETTE } from "../../terminal/palette.js";
import { ScrollableList } from "../components/scrollable-list.js";
import { useDashboard } from "../store.js";

function formatTokens(n: number | null | undefined): string {
  if (n == null) {
    return "—";
  }
  if (n >= 1000) {
    return `${(n / 1000).toFixed(1)}k`;
  }
  return String(n);
}

function formatAge(updatedAt: number | null | undefined): string {
  if (!updatedAt) {
    return "—";
  }
  const seconds = Math.floor((Date.now() - updatedAt) / 1000);
  if (seconds < 60) {
    return `${seconds}s`;
  }
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${minutes}m`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours}h`;
  }
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

export function SessionPanel() {
  const { state } = useDashboard();
  const { sessions, selectedSessionIndex, sessionDrillKey } = state;

  // Drill-in mode: show session details
  if (sessionDrillKey) {
    const session = sessions.find((s) => s.key === sessionDrillKey);
    if (!session) {
      return (
        <Box paddingLeft={1}>
          <Text dimColor>Session not found. Press Esc to go back.</Text>
        </Box>
      );
    }
    return (
      <Box flexDirection="column" paddingLeft={1}>
        <Box>
          <Text color={LOBSTER_PALETTE.accent} bold>
            Session: {session.key}
          </Text>
        </Box>
        <Box paddingTop={1} flexDirection="column">
          <Text>
            <Text dimColor>Model: </Text>
            {session.model ?? "default"}
          </Text>
          <Text>
            <Text dimColor>Label: </Text>
            {session.label ?? session.displayName ?? "—"}
          </Text>
          <Text>
            <Text dimColor>Tokens: </Text>
            {formatTokens(session.totalTokens)}
            {session.contextTokens != null ? ` / ${formatTokens(session.contextTokens)}` : ""}
          </Text>
          <Text>
            <Text dimColor>Age: </Text>
            {formatAge(session.updatedAt)}
          </Text>
        </Box>
        <Box paddingTop={1}>
          <Text dimColor>Press Esc to go back</Text>
        </Box>
      </Box>
    );
  }

  // List mode
  return (
    <Box flexDirection="column" flexGrow={1} paddingLeft={1}>
      <ScrollableList<SessionSummary>
        items={sessions}
        selectedIndex={selectedSessionIndex}
        height={20}
        scrollOffset={state.sessionScrollOffset}
        emptyMessage="No sessions"
        renderItem={(session, _idx, selected) => (
          <Box>
            <Text color={selected ? LOBSTER_PALETTE.accentBright : undefined} bold={selected}>
              {selected ? "▸ " : "  "}
              {session.key}
            </Text>
            <Text dimColor>
              {" "}
              {session.model ? `[${session.model}]` : ""} {formatTokens(session.totalTokens)} tok
              {" · "}
              {formatAge(session.updatedAt)}
            </Text>
          </Box>
        )}
      />
    </Box>
  );
}
