import { Box, Text } from "ink";
import React from "react";
import type { ActivityEntry, ActivityKind } from "../types.js";
import { LOBSTER_PALETTE } from "../../terminal/palette.js";
import { ScrollableList } from "../components/scrollable-list.js";
import { useDashboard } from "../store.js";

function kindColor(kind: ActivityKind): string {
  switch (kind) {
    case "tool":
      return LOBSTER_PALETTE.info;
    case "completion":
      return LOBSTER_PALETTE.success;
    case "error":
      return LOBSTER_PALETTE.error;
    case "state_change":
      return LOBSTER_PALETTE.accent;
    case "info":
      return LOBSTER_PALETTE.muted;
  }
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  return [
    String(d.getHours()).padStart(2, "0"),
    String(d.getMinutes()).padStart(2, "0"),
    String(d.getSeconds()).padStart(2, "0"),
  ].join(":");
}

export function ActivityPanel() {
  const { state } = useDashboard();
  const { activityFeed, activityScrollOffset } = state;

  // Show newest at the bottom — selectedIndex at the end for auto-scroll
  const selectedIndex = Math.max(0, activityFeed.length - 1);

  return (
    <Box flexDirection="column" flexGrow={1} paddingLeft={1}>
      <ScrollableList<ActivityEntry>
        items={activityFeed}
        selectedIndex={selectedIndex}
        height={20}
        scrollOffset={activityScrollOffset}
        emptyMessage="No activity yet"
        renderItem={(entry) => (
          <Box>
            <Text dimColor>{formatTime(entry.ts)}</Text>
            <Text color={LOBSTER_PALETTE.muted}>{" ["}</Text>
            <Text color={LOBSTER_PALETTE.accent}>{entry.agentId}</Text>
            <Text color={LOBSTER_PALETTE.muted}>{"] "}</Text>
            <Text color={kindColor(entry.kind)}>{entry.summary}</Text>
          </Box>
        )}
      />
    </Box>
  );
}
