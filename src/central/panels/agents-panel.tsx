import { Box, Text } from "ink";
import React from "react";
import type { AgentInfo } from "../types.js";
import { LOBSTER_PALETTE } from "../../terminal/palette.js";
import { ScrollableList } from "../components/scrollable-list.js";
import { useDashboard } from "../store.js";

function fsmColor(agent: AgentInfo): string {
  if (agent.activeRuns > 0) {
    return LOBSTER_PALETTE.accent;
  }
  return LOBSTER_PALETTE.success;
}

function fsmLabel(agent: AgentInfo): string {
  if (agent.activeRuns > 0) {
    return "executing";
  }
  return "idle";
}

function timeSince(ts: number | null): string {
  if (!ts) {
    return "—";
  }
  const seconds = Math.floor((Date.now() - ts) / 1000);
  if (seconds < 60) {
    return `${seconds}s ago`;
  }
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${minutes}m ago`;
  }
  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
}

export function AgentsPanel() {
  const { state } = useDashboard();
  const { agents, selectedAgentIndex } = state;

  return (
    <Box flexDirection="column" flexGrow={1} paddingLeft={1}>
      <ScrollableList
        items={agents}
        selectedIndex={selectedAgentIndex}
        height={20}
        scrollOffset={0}
        emptyMessage="No agents"
        renderItem={(agent, _idx, selected) => (
          <Box flexDirection="column">
            <Box>
              <Text color={selected ? LOBSTER_PALETTE.accentBright : undefined} bold={selected}>
                {selected ? "▸ " : "  "}
                {agent.identity?.name ?? agent.name ?? agent.id}
              </Text>
              <Text color={fsmColor(agent)}> ({fsmLabel(agent)})</Text>
            </Box>
            <Box paddingLeft={4}>
              <Text dimColor>
                {agent.activeRuns} run{agent.activeRuns !== 1 ? "s" : ""}
                {" · "}
                last: {timeSince(agent.lastActivityTs)}
              </Text>
            </Box>
          </Box>
        )}
      />
    </Box>
  );
}
