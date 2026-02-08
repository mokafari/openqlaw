import { Box, Text } from "ink";
import React from "react";
import { LOBSTER_PALETTE } from "../../terminal/palette.js";

type PanelFrameProps = {
  title: string;
  focused: boolean;
  children: React.ReactNode;
};

export function PanelFrame({ title, focused, children }: PanelFrameProps) {
  const borderColor = focused ? LOBSTER_PALETTE.accent : LOBSTER_PALETTE.muted;
  return (
    <Box
      flexDirection="column"
      borderStyle="single"
      borderColor={borderColor}
      flexGrow={1}
      overflow="hidden"
    >
      <Box>
        <Text color={focused ? LOBSTER_PALETTE.accent : LOBSTER_PALETTE.muted} bold={focused}>
          {" "}
          {title}{" "}
        </Text>
      </Box>
      {children}
    </Box>
  );
}
