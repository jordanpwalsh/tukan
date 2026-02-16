import { Box, Text } from "ink";
import { Card } from "./Card.js";
import type { BoardColumn } from "../board/types.js";

const CARD_HEIGHT = 5; // border top/bottom + up to 3 content lines
const COLUMN_CHROME = 3; // 2 for column border + 1 for header

interface ColumnProps {
  column: BoardColumn;
  focused: boolean;
  selectedRow: number;
  width: number;
  height: number;
}

export function Column({ column, focused, selectedRow, width, height }: ColumnProps) {
  const borderColor = focused ? "cyan" : "gray";
  const cardWidth = Math.max(width - 2, 12); // inside the column border

  const totalCards = column.cards.length;
  const availableHeight = height - COLUMN_CHROME;
  let maxVisible = Math.max(1, Math.floor(availableHeight / CARD_HEIGHT));
  const needsScroll = totalCards > maxVisible;

  if (needsScroll) {
    // Reserve 2 lines for scroll indicators (▲ above, ▼ below)
    maxVisible = Math.max(1, Math.floor((availableHeight - 2) / CARD_HEIGHT));
  }

  let scrollOffset = 0;
  if (needsScroll) {
    if (focused) {
      // Keep selected row visible, centered when possible
      scrollOffset = Math.min(
        Math.max(0, selectedRow - Math.floor(maxVisible / 2)),
        totalCards - maxVisible,
      );
    }
    // Non-focused columns show from top (scrollOffset stays 0)
  }

  const hasAbove = scrollOffset > 0;
  const hasBelow = scrollOffset + maxVisible < totalCards;
  const visibleCards = needsScroll
    ? column.cards.slice(scrollOffset, scrollOffset + maxVisible)
    : column.cards;

  return (
    <Box
      flexDirection="column"
      borderStyle="single"
      borderColor={borderColor}
      width={width}
      height={height}
    >
      <Box justifyContent="center">
        <Text bold={focused} color={focused ? "cyan" : undefined} inverse={focused && column.cards.length === 0}>
          {focused && column.cards.length === 0 ? " " : ""}{column.title} ({column.cards.length}){focused && column.cards.length === 0 ? " " : ""}
        </Text>
      </Box>
      {hasAbove && (
        <Box justifyContent="center">
          <Text dimColor>▲</Text>
        </Box>
      )}
      {visibleCards.map((card, i) => (
        <Card
          key={card.cardId}
          card={card}
          selected={focused && (scrollOffset + i) === selectedRow}
          width={cardWidth}
        />
      ))}
      {hasBelow && (
        <Box justifyContent="center">
          <Text dimColor>▼</Text>
        </Box>
      )}
      {column.cards.length === 0 && (
        <Box justifyContent="center" paddingY={1}>
          <Text dimColor>empty</Text>
        </Box>
      )}
    </Box>
  );
}
