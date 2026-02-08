import { Box, Text } from "ink";
import React from "react";
import type { RunInfo, ToolCall } from "../types.js";
import { LOBSTER_PALETTE } from "../../terminal/palette.js";
import { buildFlatRunTree, useDashboard } from "../store.js";

function formatDuration(startedAt: number, endedAt?: number): string {
  const end = endedAt ?? Date.now();
  const ms = end - startedAt;
  if (ms < 1000) {
    return `${ms}ms`;
  }
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) {
    return `${seconds}.${Math.floor((ms % 1000) / 100)}s`;
  }
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m${String(seconds % 60).padStart(2, "0")}s`;
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max) + "…";
}

function ToolRow({ tool }: { tool: ToolCall }) {
  const dur = tool.endedAt ? formatDuration(tool.startedAt, tool.endedAt) : "running…";
  const statusIcon = tool.endedAt == null ? "●" : tool.isError ? "✗" : "✓";
  const statusColor =
    tool.endedAt == null
      ? LOBSTER_PALETTE.accent
      : tool.isError
        ? LOBSTER_PALETTE.error
        : LOBSTER_PALETTE.success;

  // Summarize args
  const argEntries = Object.entries(tool.args).slice(0, 3);
  const argStr = argEntries
    .map(([k, v]) => {
      const val = typeof v === "string" ? truncate(v, 40) : JSON.stringify(v);
      return `${k}=${val}`;
    })
    .join(", ");

  // Summarize result
  let resultStr = "";
  if (tool.result != null) {
    resultStr =
      typeof tool.result === "string"
        ? truncate(tool.result, 60)
        : truncate(JSON.stringify(tool.result), 60);
  }

  return (
    <Box flexDirection="column" paddingLeft={2}>
      <Box>
        <Text color={statusColor}>{statusIcon} </Text>
        <Text bold>{tool.name}</Text>
        <Text dimColor> {dur}</Text>
        {tool.meta && <Text dimColor> [{tool.meta}]</Text>}
      </Box>
      {argStr && (
        <Box paddingLeft={4}>
          <Text color={LOBSTER_PALETTE.muted}>args: </Text>
          <Text>{truncate(argStr, 100)}</Text>
        </Box>
      )}
      {resultStr && (
        <Box paddingLeft={4}>
          <Text color={tool.isError ? LOBSTER_PALETTE.error : LOBSTER_PALETTE.muted}>
            {tool.isError ? "error: " : "result: "}
          </Text>
          <Text>{resultStr}</Text>
        </Box>
      )}
    </Box>
  );
}

function RunDetail({ run }: { run: RunInfo }) {
  const statusColor =
    run.status === "running"
      ? LOBSTER_PALETTE.accent
      : run.status === "completed"
        ? LOBSTER_PALETTE.success
        : LOBSTER_PALETTE.error;

  return (
    <Box flexDirection="column" paddingLeft={1}>
      {/* Header */}
      <Box>
        <Text color={statusColor} bold>
          {run.status.toUpperCase()}
        </Text>
        <Text dimColor> · </Text>
        <Text bold>{run.agentId}</Text>
        <Text dimColor>:{run.sessionKey.split(":").slice(1).join(":") || "?"}</Text>
        <Text dimColor> · {formatDuration(run.startedAt, run.endedAt)}</Text>
      </Box>
      <Box>
        <Text dimColor>runId: {run.runId.slice(0, 12)}…</Text>
      </Box>
      {run.spawnedBy && (
        <Box>
          <Text dimColor>spawned by: </Text>
          <Text color={LOBSTER_PALETTE.accent}>{run.spawnedBy}</Text>
        </Box>
      )}

      {/* Error */}
      {run.errorMessage && (
        <Box paddingTop={1}>
          <Text color={LOBSTER_PALETTE.error}>Error: {run.errorMessage.slice(0, 200)}</Text>
        </Box>
      )}

      {/* Tools */}
      {run.tools.length > 0 && (
        <Box flexDirection="column" paddingTop={1}>
          <Text bold>
            Tools ({run.tools.length}
            {run.tools.filter((t) => t.isError).length > 0
              ? `, ${run.tools.filter((t) => t.isError).length} errors`
              : ""}
            ):
          </Text>
          {run.tools.map((tool) => (
            <ToolRow key={tool.toolCallId} tool={tool} />
          ))}
        </Box>
      )}

      {/* Response */}
      {run.lastResponse && (
        <Box flexDirection="column" paddingTop={1}>
          <Text bold>Response:</Text>
          <Box paddingLeft={2}>
            <Text wrap="wrap">{truncate(run.lastResponse, 500)}</Text>
          </Box>
        </Box>
      )}
    </Box>
  );
}

export function DetailPanel() {
  const { state } = useDashboard();
  const { runs, detailRunId, runsSelectedIndex } = state;

  // Find the run to display: explicit detailRunId, or the selected run
  const run =
    (detailRunId ? runs.find((r) => r.runId === detailRunId) : null) ??
    getFlatRun(runs, runsSelectedIndex, state.agents);

  if (!run) {
    return (
      <Box paddingLeft={1}>
        <Text dimColor>Select a run to inspect. Press Enter on a run in the Runs panel.</Text>
      </Box>
    );
  }

  return <RunDetail run={run} />;
}

/** Map the flat runsSelectedIndex to the actual RunInfo using the same tree ordering as RunsPanel. */
function getFlatRun(
  runs: RunInfo[],
  selectedIndex: number,
  agents: import("../types.js").AgentInfo[],
): RunInfo | undefined {
  const agentIds = new Set(agents.map((a) => a.id));
  for (const run of runs) {
    agentIds.add(run.agentId);
  }
  let idx = 0;
  for (const agentId of agentIds) {
    const agentRuns = runs.filter((r) => r.agentId === agentId);
    const flatTree = buildFlatRunTree(agentRuns);
    for (const { run } of flatTree) {
      if (idx === selectedIndex) {
        return run;
      }
      idx++;
    }
  }
  return runs[0];
}
