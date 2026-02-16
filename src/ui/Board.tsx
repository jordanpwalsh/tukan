import { useEffect } from "react";
import { Box, Text } from "ink";
import { Column } from "./Column.js";
import type { BoardColumn, Cursor } from "../board/types.js";

const MAX_VISIBLE = 4;
const MIN_COL_WIDTH = 32;

interface BoardProps {
  columns: BoardColumn[];
  cursor: Cursor;
  width: number;
  height: number;
  onScrollChange?: (colScroll: number) => void;
}

export function Board({ columns, cursor, width, height, onScrollChange }: BoardProps) {
  const total = columns.length;
  const maxByWidth = Math.max(1, Math.floor(width / MIN_COL_WIDTH));
  const visible = Math.min(total, MAX_VISIBLE, maxByWidth);

  // Only scroll when cursor moves past the visible edge
  let scrollOffset = cursor.colScroll ?? 0;
  if (total > visible) {
    // Clamp previous offset to valid range first (in case columns changed)
    scrollOffset = Math.min(Math.max(0, scrollOffset), total - visible);
    // If cursor went past the right edge, shift right
    if (cursor.col >= scrollOffset + visible) {
      scrollOffset = cursor.col - visible + 1;
    }
    // If cursor went past the left edge, shift left
    if (cursor.col < scrollOffset) {
      scrollOffset = cursor.col;
    }
  } else {
    scrollOffset = 0;
  }

  // Sync computed scroll back to cursor if it changed
  useEffect(() => {
    if (scrollOffset !== (cursor.colScroll ?? 0)) {
      onScrollChange?.(scrollOffset);
    }
  }, [scrollOffset, cursor.colScroll, onScrollChange]);

  const hasLeft = scrollOffset > 0;
  const hasRight = scrollOffset + visible < total;

  const indicatorWidth = 3; // " ◀ " or " ▶ "
  const usedByIndicators = (hasLeft ? indicatorWidth : 0) + (hasRight ? indicatorWidth : 0);
  const colWidth = Math.floor((width - usedByIndicators) / visible);
  const boardHeight = height - 2; // leave room for status bar

  const visibleColumns = columns.slice(scrollOffset, scrollOffset + visible);

  return (
    <Box flexDirection="row" width={width} height={boardHeight}>
      {hasLeft && (
        <Box width={indicatorWidth} alignItems="center" justifyContent="center">
          <Text dimColor>{"◀"}</Text>
        </Box>
      )}
      {visibleColumns.map((col, i) => (
        <Column
          key={col.id}
          column={col}
          focused={scrollOffset + i === cursor.col}
          selectedRow={cursor.row}
          width={colWidth}
          height={boardHeight}
        />
      ))}
      {hasRight && (
        <Box width={indicatorWidth} alignItems="center" justifyContent="center">
          <Text dimColor>{"▶"}</Text>
        </Box>
      )}
    </Box>
  );
}
