import { Box, Text } from "ink";
import React from "react";

type ScrollableListProps<T> = {
  items: T[];
  selectedIndex: number;
  height: number;
  scrollOffset: number;
  renderItem: (item: T, index: number, selected: boolean) => React.ReactNode;
  emptyMessage?: string;
};

export function ScrollableList<T>({
  items,
  selectedIndex,
  height,
  scrollOffset,
  renderItem,
  emptyMessage = "No items",
}: ScrollableListProps<T>) {
  if (items.length === 0) {
    return (
      <Box paddingLeft={1}>
        <Text dimColor>{emptyMessage}</Text>
      </Box>
    );
  }

  const visibleCount = Math.max(1, height);

  // Auto-adjust scroll so the selected item stays visible
  let offset = scrollOffset;
  if (selectedIndex < offset) {
    offset = selectedIndex;
  } else if (selectedIndex >= offset + visibleCount) {
    offset = selectedIndex - visibleCount + 1;
  }
  offset = Math.max(0, Math.min(offset, Math.max(0, items.length - visibleCount)));

  const visible = items.slice(offset, offset + visibleCount);

  return (
    <Box flexDirection="column" overflow="hidden">
      {visible.map((item, i) => {
        const actualIndex = offset + i;
        const selected = actualIndex === selectedIndex;
        return <Box key={actualIndex}>{renderItem(item, actualIndex, selected)}</Box>;
      })}
      {items.length > visibleCount && (
        <Box>
          <Text dimColor>
            {offset + visibleCount < items.length ? "↓ more" : ""}
            {offset > 0 ? " ↑ more" : ""}
          </Text>
        </Box>
      )}
    </Box>
  );
}
