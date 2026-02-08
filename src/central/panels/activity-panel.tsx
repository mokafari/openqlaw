import { Box, Text } from "ink";
import React from "react";
import type { ActivityEntry, ActivityKind } from "../types.js";
import { LOBSTER_PALETTE } from "../../terminal/palette.js";
import { useDashboard } from "../store.js";

function kindColor(kind: ActivityKind): string {
  switch (kind) {
    case "lifecycle_start":
      return LOBSTER_PALETTE.accentBright;
    case "lifecycle_end":
      return LOBSTER_PALETTE.success;
    case "tool_start":
      return LOBSTER_PALETTE.info;
    case "tool_result":
      return LOBSTER_PALETTE.accent;
    case "chat_final":
      return LOBSTER_PALETTE.success;
    case "error":
      return LOBSTER_PALETTE.error;
    case "system":
      return LOBSTER_PALETTE.muted;
  }
}

function kindTag(kind: ActivityKind): string {
  switch (kind) {
    case "lifecycle_start":
      return "START";
    case "lifecycle_end":
      return "END";
    case "tool_start":
      return "TOOL▸";
    case "tool_result":
      return "TOOL◂";
    case "chat_final":
      return "RESP";
    case "error":
      return "ERR!";
    case "system":
      return "SYS";
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

/** Render expanded payload as key-value pairs. */
function PayloadDetail({ entry }: { entry: ActivityEntry }) {
  const { payload } = entry;
  if (!payload || Object.keys(payload).length === 0) {
    return (
      <Box paddingLeft={4}>
        <Text dimColor>(empty payload)</Text>
      </Box>
    );
  }

  const data =
    typeof payload.data === "object" && payload.data
      ? (payload.data as Record<string, unknown>)
      : null;

  // Collect key-value pairs to display
  const pairs: Array<[string, string]> = [];

  if (entry.runId) {
    pairs.push(["runId", entry.runId]);
  }
  if (typeof payload.sessionKey === "string") {
    pairs.push(["session", payload.sessionKey]);
  }
  if (typeof payload.stream === "string") {
    pairs.push(["stream", payload.stream]);
  }

  if (data) {
    for (const [k, v] of Object.entries(data)) {
      const str =
        typeof v === "string"
          ? v.length > 200
            ? v.slice(0, 200) + "…"
            : v
          : JSON.stringify(v, null, 2);
      pairs.push([`data.${k}`, str]);
    }
  } else {
    for (const [k, v] of Object.entries(payload)) {
      if (k === "ts" || k === "runId" || k === "sessionKey" || k === "stream" || k === "data") {
        continue;
      }
      const str =
        typeof v === "string"
          ? v.length > 200
            ? v.slice(0, 200) + "…"
            : v
          : JSON.stringify(v, null, 2);
      pairs.push([k, str]);
    }
  }

  return (
    <Box flexDirection="column" paddingLeft={4} paddingBottom={1}>
      {pairs.map(([key, val]) => {
        const lines = val.split("\n");
        if (lines.length <= 1) {
          return (
            <Box key={key}>
              <Text color={LOBSTER_PALETTE.muted}>{key}: </Text>
              <Text>{val}</Text>
            </Box>
          );
        }
        return (
          <Box key={key} flexDirection="column">
            <Text color={LOBSTER_PALETTE.muted}>{key}:</Text>
            {lines.slice(0, 20).map((line, i) => (
              <Box key={i} paddingLeft={2}>
                <Text>{line}</Text>
              </Box>
            ))}
            {lines.length > 20 && (
              <Box paddingLeft={2}>
                <Text dimColor>… {lines.length - 20} more lines</Text>
              </Box>
            )}
          </Box>
        );
      })}
    </Box>
  );
}

export function ActivityPanel() {
  const { state } = useDashboard();
  const { activityFeed, logSelectedIndex, logExpandedIndex } = state;

  if (activityFeed.length === 0) {
    return (
      <Box paddingLeft={1}>
        <Text dimColor>Waiting for events…</Text>
      </Box>
    );
  }

  // Visible window
  const visibleCount = 18;
  let offset = 0;
  if (logSelectedIndex < offset) {
    offset = logSelectedIndex;
  } else if (logSelectedIndex >= offset + visibleCount) {
    offset = logSelectedIndex - visibleCount + 1;
  }
  offset = Math.max(0, Math.min(offset, Math.max(0, activityFeed.length - visibleCount)));

  const visible = activityFeed.slice(offset, offset + visibleCount);

  return (
    <Box flexDirection="column" flexGrow={1} paddingLeft={1} overflow="hidden">
      {visible.map((entry, i) => {
        const actualIndex = offset + i;
        const selected = actualIndex === logSelectedIndex;
        const expanded = actualIndex === logExpandedIndex;

        return (
          <Box key={actualIndex} flexDirection="column">
            <Box>
              <Text color={selected ? LOBSTER_PALETTE.accentBright : undefined} bold={selected}>
                {selected ? "▸" : " "}
              </Text>
              <Text dimColor>{formatTime(entry.ts)} </Text>
              <Text color={kindColor(entry.kind)} bold>
                {kindTag(entry.kind).padEnd(5)}
              </Text>
              <Text color={LOBSTER_PALETTE.muted}> [{entry.agentId}] </Text>
              <Text wrap="truncate">{entry.summary}</Text>
            </Box>
            {expanded && <PayloadDetail entry={entry} />}
          </Box>
        );
      })}
      <Box>
        <Text dimColor>
          {activityFeed.length} events
          {offset + visibleCount < activityFeed.length ? " ↓" : ""}
          {offset > 0 ? " ↑" : ""}
        </Text>
      </Box>
    </Box>
  );
}
