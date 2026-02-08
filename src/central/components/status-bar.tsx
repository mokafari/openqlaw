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
  const { connected, uptimeMs, presence, health } = state;

  const statusDot = connected ? "●" : "○";
  const statusColor = connected ? LOBSTER_PALETTE.success : LOBSTER_PALETTE.error;
  const statusText = connected ? "connected" : "disconnected";
  const nodeCount = presence.length;

  // Extract channel health from the health payload (best-effort)
  const channels = (() => {
    if (!health || typeof health !== "object") {
      return "";
    }
    const ch = (health as Record<string, unknown>).channels;
    if (!Array.isArray(ch)) {
      return "";
    }
    return ch
      .map((c: unknown) => {
        if (typeof c !== "object" || !c) {
          return null;
        }
        const entry = c as Record<string, unknown>;
        const name = typeof entry.name === "string" ? entry.name : "?";
        const ok = entry.connected === true || entry.healthy === true;
        return `${name}${ok ? "✓" : "✗"}`;
      })
      .filter(Boolean)
      .join(" ");
  })();

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
      {channels ? (
        <>
          <Text color={LOBSTER_PALETTE.muted}> | </Text>
          <Text>{channels}</Text>
        </>
      ) : null}
    </Box>
  );
}
