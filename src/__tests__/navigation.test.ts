import { describe, it, expect } from "vitest";
import { moveLeft, moveRight, moveUp, moveDown, moveCard } from "../board/navigation.js";
import { defaultConfig } from "../board/types.js";
import type { BoardColumn, BoardCard, Cursor } from "../board/types.js";

function makeBoardCard(colIdx: number, cardIdx: number, opts?: Partial<BoardCard>): BoardCard {
  return {
    cardId: `card-${colIdx}-${cardIdx}`,
    windowId: `@${colIdx}_${cardIdx}`,
    displayId: `#${colIdx}_${cardIdx}`,
    sessionName: "main",
    name: `win-${colIdx}-${cardIdx}`,
    command: "zsh",
    workingDir: "/home",
    active: false,
    started: false,
    closed: false,
    uncategorized: true,
    hasActivity: false,
    spinning: false,
    idleTime: null,
    ...opts,
  };
}

function makeColumns(cardCounts: number[]): BoardColumn[] {
  return cardCounts.map((count, i) => ({
    id: `col${i}`,
    title: `Column ${i}`,
    cards: Array.from({ length: count }, (_, j) => makeBoardCard(i, j)),
  }));
}

describe("moveLeft", () => {
  it("moves cursor left and clamps row", () => {
    const columns = makeColumns([2, 5, 1]);
    const cursor: Cursor = { col: 1, row: 4 };
    const result = moveLeft(cursor, columns);
    expect(result).toEqual({ col: 0, row: 1 });
  });

  it("stays at col 0", () => {
    const columns = makeColumns([3, 3]);
    const cursor: Cursor = { col: 0, row: 1 };
    expect(moveLeft(cursor, columns)).toEqual(cursor);
  });
});

describe("moveRight", () => {
  it("moves cursor right and clamps row", () => {
    const columns = makeColumns([5, 2]);
    const cursor: Cursor = { col: 0, row: 4 };
    const result = moveRight(cursor, columns);
    expect(result).toEqual({ col: 1, row: 1 });
  });

  it("stays at last column", () => {
    const columns = makeColumns([3, 3]);
    const cursor: Cursor = { col: 1, row: 0 };
    expect(moveRight(cursor, columns)).toEqual(cursor);
  });
});

describe("moveUp", () => {
  it("moves cursor up", () => {
    expect(moveUp({ col: 0, row: 2 })).toEqual({ col: 0, row: 1 });
  });

  it("stays at row 0", () => {
    const cursor: Cursor = { col: 0, row: 0 };
    expect(moveUp(cursor)).toEqual(cursor);
  });
});

describe("moveDown", () => {
  it("moves cursor down", () => {
    const columns = makeColumns([3]);
    expect(moveDown({ col: 0, row: 0 }, columns)).toEqual({ col: 0, row: 1 });
  });

  it("stays at last row", () => {
    const columns = makeColumns([3]);
    expect(moveDown({ col: 0, row: 2 }, columns)).toEqual({ col: 0, row: 2 });
  });
});

describe("moveCard", () => {
  it("moves uncategorized card right and creates card record", () => {
    const columns = makeColumns([2, 1, 0]);
    const config = {
      ...defaultConfig(),
      columns: columns.map((c) => ({ id: c.id, title: c.title })),
    };
    const cursor: Cursor = { col: 0, row: 1 };

    const result = moveCard(config, columns, cursor, "right", () => "new-id");
    expect(result).not.toBeNull();
    // Should auto-create a card record for uncategorized window
    expect(result!.config.cards["new-id"]).toBeDefined();
    expect(result!.config.cards["new-id"].columnId).toBe("col1");
    expect(result!.config.cards["new-id"].windowId).toBe("@0_1");
    expect(result!.cursor.col).toBe(1);
  });

  it("moves existing card right and updates columnId", () => {
    const columns = makeColumns([2, 1, 0]);
    // Override the first card to be a non-uncategorized card with a record
    columns[0].cards[1] = makeBoardCard(0, 1, { uncategorized: false, started: true });
    const config = {
      ...defaultConfig(),
      columns: columns.map((c) => ({ id: c.id, title: c.title })),
      cards: {
        "card-0-1": {
          id: "card-0-1",
          name: "my-task",
          description: "",
          acceptanceCriteria: "",
          columnId: "col0",
          sessionName: "main",
          dir: "/home",
          command: "shell" as const,
          worktree: false,
          windowId: "@0_1",
          createdAt: Date.now(),
        },
      },
    };
    const cursor: Cursor = { col: 0, row: 1 };

    const result = moveCard(config, columns, cursor, "right");
    expect(result).not.toBeNull();
    expect(result!.config.cards["card-0-1"].columnId).toBe("col1");
    expect(result!.cursor.col).toBe(1);
  });

  it("returns null when moving left from first column", () => {
    const columns = makeColumns([2, 1]);
    const config = {
      ...defaultConfig(),
      columns: columns.map((c) => ({ id: c.id, title: c.title })),
    };
    expect(moveCard(config, columns, { col: 0, row: 0 }, "left")).toBeNull();
  });

  it("returns null when moving right from last column", () => {
    const columns = makeColumns([2, 1]);
    const config = {
      ...defaultConfig(),
      columns: columns.map((c) => ({ id: c.id, title: c.title })),
    };
    expect(moveCard(config, columns, { col: 1, row: 0 }, "right")).toBeNull();
  });

  it("returns null for empty column", () => {
    const columns = makeColumns([0, 1]);
    const config = {
      ...defaultConfig(),
      columns: columns.map((c) => ({ id: c.id, title: c.title })),
    };
    expect(moveCard(config, columns, { col: 0, row: 0 }, "right")).toBeNull();
  });
});
