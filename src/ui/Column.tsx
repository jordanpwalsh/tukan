import { Box, Text } from "ink";
import { Card } from "./Card.js";
import type { BoardColumn } from "../board/types.js";

interface ColumnProps {
  column: BoardColumn;
  focused: boolean;
  selectedRow: number;
  width: number;
}

export function Column({ column, focused, selectedRow, width }: ColumnProps) {
  const borderColor = focused ? "cyan" : "gray";
  const cardWidth = Math.max(width - 2, 12); // inside the column border

  return (
    <Box
      flexDirection="column"
      borderStyle="single"
      borderColor={borderColor}
      width={width}
    >
      <Box justifyContent="center">
        <Text bold color={focused ? "cyan" : undefined}>
          {column.title} ({column.cards.length})
        </Text>
      </Box>
      {column.cards.map((card, i) => (
        <Card
          key={card.windowId}
          card={card}
          selected={focused && i === selectedRow}
          width={cardWidth}
        />
      ))}
      {column.cards.length === 0 && (
        <Box justifyContent="center" paddingY={1}>
          <Text dimColor>empty</Text>
        </Box>
      )}
    </Box>
  );
}
