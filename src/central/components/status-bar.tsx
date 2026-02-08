import { Box, Text } from "ink";
import React from "react";
import { LOBSTER_PALETTE } from "../../terminal/palette.js";
import { useDashboard } from "../store.js";

function formatUptime(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  if (hours > 0) {
    return `${hours}h${String(minutes).padStart(2, "0")}m`;
  }
  return `${minutes}m`;
}

export function StatusBar() {
  const { state } = useDashboard();
  const { connected, uptimeMs, presence, runs, activityFeed } = state;

  const statusDot = connected ? "●" : "○";
  const statusColor = connected ? LOBSTER_PALETTE.success : LOBSTER_PALETTE.error;
  const statusText = connected ? "connected" : "disconnected";
  const nodeCount = presence.length;
  const activeRuns = runs.filter((r) => r.status === "running").length;
  const errorRuns = runs.filter((r) => r.status === "error").length;
  const totalTools = runs.reduce((sum, r) => sum + r.tools.length, 0);
  const failedTools = runs.reduce((sum, r) => sum + r.tools.filter((t) => t.isError).length, 0);

  return (
    <Box>
      <Text color={statusColor}>
        {statusDot} {statusText}
      </Text>
      <Text color={LOBSTER_PALETTE.muted}> | </Text>
      <Text>↑{formatUptime(uptimeMs)}</Text>
      <Text color={LOBSTER_PALETTE.muted}> | </Text>
      <Text>
        {nodeCount} node{nodeCount !== 1 ? "s" : ""}
      </Text>
      <Text color={LOBSTER_PALETTE.muted}> | </Text>
      <Text color={activeRuns > 0 ? LOBSTER_PALETTE.accent : undefined}>
        {activeRuns} active run{activeRuns !== 1 ? "s" : ""}
      </Text>
      {errorRuns > 0 && (
        <>
          <Text color={LOBSTER_PALETTE.muted}> | </Text>
          <Text color={LOBSTER_PALETTE.error}>{errorRuns} errors</Text>
        </>
      )}
      <Text color={LOBSTER_PALETTE.muted}> | </Text>
      <Text>
        {totalTools} tools{failedTools > 0 ? ` (${failedTools} failed)` : ""}
      </Text>
      <Text color={LOBSTER_PALETTE.muted}> | </Text>
      <Text dimColor>{activityFeed.length} events</Text>
    </Box>
  );
}
