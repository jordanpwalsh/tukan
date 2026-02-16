import { Box, Text } from "ink";
import { Column } from "./Column.js";
import type { BoardColumn, Cursor } from "../board/types.js";

const MAX_VISIBLE = 4;
const MIN_COL_WIDTH = 24;

interface BoardProps {
  columns: BoardColumn[];
  cursor: Cursor;
  width: number;
  height: number;
}

export function Board({ columns, cursor, width, height }: BoardProps) {
  const total = columns.length;
  const maxByWidth = Math.max(1, Math.floor(width / MIN_COL_WIDTH));
  const visible = Math.min(total, MAX_VISIBLE, maxByWidth);

  // Scroll so the cursor column is always visible
  let scrollOffset = 0;
  if (total > visible) {
    // Try to keep cursor roughly centered, clamped to valid range
    scrollOffset = Math.min(
      Math.max(0, cursor.col - Math.floor(visible / 2)),
      total - visible,
    );
  }

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
