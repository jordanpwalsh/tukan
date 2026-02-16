import type { BoardConfig, BoardColumn, Cursor, Card } from "./types.js";

export function moveLeft(cursor: Cursor, columns: BoardColumn[]): Cursor {
  if (cursor.col <= 0) return cursor;
  const newCol = cursor.col - 1;
  const maxRow = Math.max(0, columns[newCol].cards.length - 1);
  return { col: newCol, row: Math.min(cursor.row, maxRow) };
}

export function moveRight(cursor: Cursor, columns: BoardColumn[]): Cursor {
  if (cursor.col >= columns.length - 1) return cursor;
  const newCol = cursor.col + 1;
  const maxRow = Math.max(0, columns[newCol].cards.length - 1);
  return { col: newCol, row: Math.min(cursor.row, maxRow) };
}

export function moveUp(cursor: Cursor): Cursor {
  if (cursor.row <= 0) return cursor;
  return { ...cursor, row: cursor.row - 1 };
}

export function moveDown(cursor: Cursor, columns: BoardColumn[]): Cursor {
  const maxRow = columns[cursor.col].cards.length - 1;
  if (cursor.row >= maxRow) return cursor;
  return { ...cursor, row: cursor.row + 1 };
}

export function moveCard(
  config: BoardConfig,
  columns: BoardColumn[],
  cursor: Cursor,
  direction: "left" | "right",
  generateId?: () => string,
): { config: BoardConfig; cursor: Cursor } | null {
  const col = columns[cursor.col];
  const card = col?.cards[cursor.row];
  if (!card) return null;

  const targetColIdx =
    direction === "left" ? cursor.col - 1 : cursor.col + 1;
  if (targetColIdx < 0 || targetColIdx >= columns.length) return null;

  const targetCol = columns[targetColIdx];

  const newCursor: Cursor = {
    col: targetColIdx,
    row: targetCol.cards.length, // card will be appended at the end
  };

  if (card.uncategorized) {
    // Auto-create a Card record for uncategorized window
    const id = generateId?.() ?? card.cardId;
    const newCard: Card = {
      id,
      name: card.name,
      description: "",
      acceptanceCriteria: "",
      columnId: targetCol.id,
      sessionName: card.sessionName,
      dir: card.workingDir,
      command: "shell",
      worktree: false,
      windowId: card.windowId!,
      createdAt: Date.now(),
    };
    return {
      config: {
        ...config,
        cards: { ...config.cards, [id]: newCard },
      },
      cursor: newCursor,
    };
  }

  // Update existing card's columnId
  const existingCard = config.cards[card.cardId];
  if (!existingCard) return null;

  return {
    config: {
      ...config,
      cards: {
        ...config.cards,
        [card.cardId]: { ...existingCard, columnId: targetCol.id },
      },
    },
    cursor: newCursor,
  };
}
