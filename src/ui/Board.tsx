import { Box } from "ink";
import { Column } from "./Column.js";
import type { BoardColumn, Cursor } from "../board/types.js";

interface BoardProps {
  columns: BoardColumn[];
  cursor: Cursor;
  width: number;
  height: number;
}

export function Board({ columns, cursor, width, height }: BoardProps) {
  const colWidth = Math.floor(width / columns.length);

  return (
    <Box flexDirection="row" width={width} height={height - 2}>
      {columns.map((col, i) => (
        <Column
          key={col.id}
          column={col}
          focused={i === cursor.col}
          selectedRow={cursor.row}
          width={colWidth}
        />
      ))}
    </Box>
  );
}
