import { Box, Text } from "ink";
import React from "react";
import type { ActivityEntry, ActivityKind } from "../types.js";
import { LOBSTER_PALETTE } from "../../terminal/palette.js";
import { useDashboard } from "../store.js";

function kindColor(kind: ActivityKind): string {
  switch (kind) {
    case "tool_start":
      return LOBSTER_PALETTE.info;
    case "tool_result":
      return LOBSTER_PALETTE.accent;
    case "assistant":
      return LOBSTER_PALETTE.success;
    case "lifecycle":
      return LOBSTER_PALETTE.accentBright;
    case "error":
      return LOBSTER_PALETTE.error;
    case "state_change":
      return LOBSTER_PALETTE.warn;
    case "info":
      return LOBSTER_PALETTE.muted;
  }
}

function kindLabel(kind: ActivityKind): string {
  switch (kind) {
    case "tool_start":
      return "tool▸";
    case "tool_result":
      return "tool◂";
    case "assistant":
      return "asst";
    case "lifecycle":
      return "life";
    case "error":
      return "ERR!";
    case "state_change":
      return "fsm";
    case "info":
      return "info";
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

/** Format a payload value for display, handling nested objects. */
function formatValue(value: unknown): string[] {
  if (value === null || value === undefined) {
    return [String(value)];
  }
  if (typeof value === "string") {
    // Multi-line strings: show each line
    if (value.includes("\n")) {
      const lines = value.split("\n");
      if (lines.length > 20) {
        return [...lines.slice(0, 18), `  … (${lines.length - 18} more lines)`];
      }
      return lines;
    }
    if (value.length > 200) {
      return [value.slice(0, 200) + "…"];
    }
    return [value];
  }
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return [String(value)];
  }
  if (typeof value !== "object") {
    return [JSON.stringify(value)];
  }
  // Arrays and objects: pretty-print with limited depth
  const json = JSON.stringify(value, null, 2);
  const lines = json.split("\n");
  const maxLines = 30;
  if (lines.length > maxLines) {
    return [...lines.slice(0, maxLines - 1), `… (${lines.length - maxLines + 1} more lines)`];
  }
  return lines;
}

/** Render expanded payload details for an activity entry. */
function PayloadDetail({ entry }: { entry: ActivityEntry }) {
  const { payload, eventName } = entry;
  if (!payload || Object.keys(payload).length === 0) {
    return (
      <Box paddingLeft={2}>
        <Text dimColor>(no payload data)</Text>
      </Box>
    );
  }

  // For agent events, show the structured data prominently
  const stream = typeof payload.stream === "string" ? payload.stream : null;
  const data =
    typeof payload.data === "object" && payload.data
      ? (payload.data as Record<string, unknown>)
      : null;
  const runId = typeof payload.runId === "string" ? payload.runId : null;
  const sessionKey = typeof payload.sessionKey === "string" ? payload.sessionKey : null;

  // Build key-value pairs to display
  const pairs: Array<{ key: string; value: unknown }> = [];

  if (eventName) {
    pairs.push({ key: "event", value: eventName });
  }
  if (runId) {
    pairs.push({ key: "runId", value: runId });
  }
  if (sessionKey) {
    pairs.push({ key: "sessionKey", value: sessionKey });
  }
  if (stream) {
    pairs.push({ key: "stream", value: stream });
  }

  // For agent events, display data fields individually
  if (data) {
    for (const [k, v] of Object.entries(data)) {
      pairs.push({ key: `data.${k}`, value: v });
    }
  } else {
    // For other events, show all payload keys (except ts which is in the header)
    for (const [k, v] of Object.entries(payload)) {
      if (k === "ts" || k === "runId" || k === "sessionKey" || k === "stream" || k === "data") {
        continue;
      }
      pairs.push({ key: k, value: v });
    }
  }

  return (
    <Box flexDirection="column" paddingLeft={2} paddingBottom={1}>
      {pairs.map((pair) => {
        const lines = formatValue(pair.value);
        if (lines.length === 1) {
          return (
            <Box key={pair.key}>
              <Text color={LOBSTER_PALETTE.muted}>{pair.key}: </Text>
              <Text>{lines[0]}</Text>
            </Box>
          );
        }
        return (
          <Box key={pair.key} flexDirection="column">
            <Text color={LOBSTER_PALETTE.muted}>{pair.key}:</Text>
            {lines.map((line, i) => (
              <Box key={i} paddingLeft={2}>
                <Text>{line}</Text>
              </Box>
            ))}
          </Box>
        );
      })}
    </Box>
  );
}

export function ActivityPanel() {
  const { state } = useDashboard();
  const { activityFeed, activitySelectedIndex, expandedActivityIndex, activityScrollOffset } =
    state;

  if (activityFeed.length === 0) {
    return (
      <Box paddingLeft={1}>
        <Text dimColor>No activity yet</Text>
      </Box>
    );
  }

  // Compute visible window
  const visibleCount = 20;
  let offset = activityScrollOffset;
  if (activitySelectedIndex < offset) {
    offset = activitySelectedIndex;
  } else if (activitySelectedIndex >= offset + visibleCount) {
    offset = activitySelectedIndex - visibleCount + 1;
  }
  offset = Math.max(0, Math.min(offset, Math.max(0, activityFeed.length - visibleCount)));

  const visible = activityFeed.slice(offset, offset + visibleCount);

  return (
    <Box flexDirection="column" flexGrow={1} paddingLeft={1} overflow="hidden">
      {visible.map((entry, i) => {
        const actualIndex = offset + i;
        const selected = actualIndex === activitySelectedIndex;
        const expanded = actualIndex === expandedActivityIndex;

        return (
          <Box key={actualIndex} flexDirection="column">
            <Box>
              <Text color={selected ? LOBSTER_PALETTE.accentBright : undefined} bold={selected}>
                {selected ? "▸" : " "}
              </Text>
              <Text dimColor>{formatTime(entry.ts)}</Text>
              <Text color={LOBSTER_PALETTE.muted}>{" ["}</Text>
              <Text color={LOBSTER_PALETTE.accent}>{entry.agentId}</Text>
              <Text color={LOBSTER_PALETTE.muted}>{"] "}</Text>
              <Text color={kindColor(entry.kind)} bold>
                {kindLabel(entry.kind)}
              </Text>
              <Text> </Text>
              <Text color={kindColor(entry.kind)} wrap="truncate">
                {entry.summary}
              </Text>
            </Box>
            {expanded && <PayloadDetail entry={entry} />}
          </Box>
        );
      })}
      {activityFeed.length > visibleCount && (
        <Box>
          <Text dimColor>
            {offset + visibleCount < activityFeed.length ? "↓" : " "}
            {offset > 0 ? " ↑" : ""} {activityFeed.length} entries · Enter to expand · c to clear
          </Text>
        </Box>
      )}
    </Box>
  );
}
