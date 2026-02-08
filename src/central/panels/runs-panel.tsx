import { Box, Text } from "ink";
import React from "react";
import type { RunInfo } from "../types.js";
import { LOBSTER_PALETTE } from "../../terminal/palette.js";
import { useDashboard } from "../store.js";

function statusColor(status: RunInfo["status"]): string {
  if (status === "running") {
    return LOBSTER_PALETTE.accent;
  }
  if (status === "completed") {
    return LOBSTER_PALETTE.success;
  }
  return LOBSTER_PALETTE.error;
}

function statusIcon(status: RunInfo["status"]): string {
  if (status === "running") {
    return "●";
  }
  if (status === "completed") {
    return "✓";
  }
  return "✗";
}

function formatDuration(startedAt: number, endedAt?: number): string {
  const end = endedAt ?? Date.now();
  const seconds = Math.floor((end - startedAt) / 1000);
  if (seconds < 60) {
    return `${seconds}s`;
  }
  const minutes = Math.floor(seconds / 60);
  const remainingSec = seconds % 60;
  return `${minutes}m${String(remainingSec).padStart(2, "0")}s`;
}

function toolSummary(run: RunInfo): string {
  const total = run.tools.length;
  const errors = run.tools.filter((t) => t.isError).length;
  const pending = run.tools.filter((t) => !t.endedAt).length;
  const parts: string[] = [];
  parts.push(`${total} tool${total !== 1 ? "s" : ""}`);
  if (errors > 0) {
    parts.push(`${errors} err`);
  }
  if (pending > 0) {
    parts.push(`${pending} running`);
  }
  return parts.join(", ");
}

export function RunsPanel() {
  const { state } = useDashboard();
  const { runs, runsSelectedIndex, agents } = state;

  if (runs.length === 0 && agents.length === 0) {
    return (
      <Box paddingLeft={1} flexDirection="column">
        <Text dimColor>No runs yet. Waiting for agent activity…</Text>
      </Box>
    );
  }

  // Show agents as headers with their runs
  const agentIds = new Set(agents.map((a) => a.id));
  for (const run of runs) {
    agentIds.add(run.agentId);
  }

  let rowIndex = 0;

  return (
    <Box flexDirection="column" paddingLeft={1} overflow="hidden">
      {[...agentIds].map((agentId) => {
        const agent = agents.find((a) => a.id === agentId);
        const agentRuns = runs.filter((r) => r.agentId === agentId);
        const activeCount = agentRuns.filter((r) => r.status === "running").length;
        const name = agent?.identity?.name ?? agent?.name ?? agentId;

        return (
          <Box key={agentId} flexDirection="column">
            <Box>
              <Text color={activeCount > 0 ? LOBSTER_PALETTE.accent : LOBSTER_PALETTE.muted} bold>
                {name}
              </Text>
              <Text dimColor> ({activeCount > 0 ? `${activeCount} active` : "idle"})</Text>
            </Box>
            {agentRuns.map((run) => {
              const thisIndex = rowIndex++;
              const selected = thisIndex === runsSelectedIndex;
              return (
                <Box key={run.runId} flexDirection="column" paddingLeft={2}>
                  <Box>
                    <Text
                      color={selected ? LOBSTER_PALETTE.accentBright : undefined}
                      bold={selected}
                    >
                      {selected ? "▸ " : "  "}
                    </Text>
                    <Text color={statusColor(run.status)}>{statusIcon(run.status)} </Text>
                    <Text color={selected ? LOBSTER_PALETTE.accentBright : undefined}>
                      {run.sessionKey.split(":")[1] ?? run.sessionKey}
                    </Text>
                    <Text dimColor>
                      {" "}
                      {formatDuration(run.startedAt, run.endedAt)} · {toolSummary(run)}
                    </Text>
                  </Box>
                  {run.errorMessage && (
                    <Box paddingLeft={6}>
                      <Text color={LOBSTER_PALETTE.error}>{run.errorMessage.slice(0, 80)}</Text>
                    </Box>
                  )}
                </Box>
              );
            })}
            {agentRuns.length === 0 && (
              <Box paddingLeft={2}>
                <Text dimColor> no recent runs</Text>
              </Box>
            )}
          </Box>
        );
      })}
    </Box>
  );
}
