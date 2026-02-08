import { Box, Text } from "ink";
import React from "react";
import type { PanelId } from "../types.js";
import { LOBSTER_PALETTE } from "../../terminal/palette.js";

type KeybindingsBarProps = {
  focusedPanel: PanelId;
};

type Binding = { key: string; label: string; panel?: PanelId };

const BINDINGS: Binding[] = [
  { key: "1", label: "Agents", panel: "agents" },
  { key: "2", label: "Activity", panel: "activity" },
  { key: "3", label: "Session", panel: "session" },
  { key: "Tab", label: "Cycle" },
  { key: "r", label: "Refresh" },
  { key: "q", label: "Quit" },
];

export function KeybindingsBar({ focusedPanel }: KeybindingsBarProps) {
  return (
    <Box>
      {BINDINGS.map((b) => {
        const active = b.panel === focusedPanel;
        return (
          <Box key={b.key} marginRight={1}>
            <Text color={LOBSTER_PALETTE.muted}>[</Text>
            <Text color={LOBSTER_PALETTE.accent} bold>
              {b.key}
            </Text>
            <Text color={LOBSTER_PALETTE.muted}>]</Text>
            <Text color={active ? LOBSTER_PALETTE.accentBright : undefined}>{b.label}</Text>
          </Box>
        );
      })}
    </Box>
  );
}
