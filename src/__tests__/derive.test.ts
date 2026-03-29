import { describe, it, expect } from "vitest";
import { deriveBoard, reconcileConfig } from "../board/derive.js";
import { defaultConfig, COL_TODO, COL_IN_PROGRESS } from "../board/types.js";
import type { BoardConfig, Card } from "../board/types.js";
import type { TmuxServer } from "../tmux/types.js";

function makeServer(windows: Array<{ id: string; name: string; sessionName?: string }>): TmuxServer {
  const sessionMap = new Map<string, typeof windows>();
  for (const w of windows) {
    const sn = w.sessionName ?? "main";
    if (!sessionMap.has(sn)) sessionMap.set(sn, []);
    sessionMap.get(sn)!.push(w);
  }

  return {
    serverName: "test",
    sessions: [...sessionMap.entries()].map(([name, wins], i) => ({
      id: `$${i}`,
      name,
      attached: true,
      windows: wins.map((w, j) => ({
        id: w.id,
        index: j,
        name: w.name,
        active: j === 0,
        panes: [
          {
            id: `%${j}`,
            index: 0,
            active: true,
            command: "zsh",
            pid: 1000 + j,
            workingDir: "/home/user",
            width: 80,
            height: 24,
          },
        ],
      })),
    })),
  };
}

function makeCard(overrides: Partial<Card> & { id: string }): Card {
  return {
    name: overrides.id,
    description: "",
    acceptanceCriteria: "",
    columnId: "0",
    sessionName: "main",
    dir: "/home/user",
    command: "shell",
    worktree: false,
    createdAt: Date.now(),
    ...overrides,
  };
}

describe("deriveBoard", () => {
  it("places unassigned windows in the first column", () => {
    const server = makeServer([
      { id: "@0", name: "editor" },
      { id: "@1", name: "shell" },
    ]);
    const config = defaultConfig();
    const columns = deriveBoard(server, config);

    expect(columns[0].cards).toHaveLength(2);
    expect(columns[1].cards).toHaveLength(0);
    expect(columns[2].cards).toHaveLength(0);
  });

  it("places windows with card records in their card's column", () => {
    const server = makeServer([
      { id: "@0", name: "editor" },
      { id: "@1", name: "shell" },
    ]);
    const config: BoardConfig = {
      ...defaultConfig(),
      cards: {
        "card-1": makeCard({ id: "card-1", name: "my-task", columnId: COL_TODO, windowId: "@1" }),
      },
    };
    const columns = deriveBoard(server, config);

    // @0 is uncategorized → first column, @1 has a card in COL_TODO
    expect(columns[0].cards).toHaveLength(1);
    expect(columns[0].cards[0].name).toBe("editor");
    expect(columns[0].cards[0].uncategorized).toBe(true);
    expect(columns[1].cards).toHaveLength(1);
    expect(columns[1].cards[0].name).toBe("my-task"); // card name, not window name
    expect(columns[1].cards[0].uncategorized).toBe(false);
  });

  it("falls back to first column for invalid card columnId", () => {
    const server = makeServer([{ id: "@0", name: "editor" }]);
    const config: BoardConfig = {
      ...defaultConfig(),
      cards: {
        "card-1": makeCard({ id: "card-1", columnId: "nonexistent", windowId: "@0" }),
      },
    };
    const columns = deriveBoard(server, config);

    expect(columns[0].cards).toHaveLength(1);
  });

  it("gathers windows from multiple sessions", () => {
    const server = makeServer([
      { id: "@0", name: "editor", sessionName: "dev" },
      { id: "@1", name: "logs", sessionName: "ops" },
    ]);
    const columns = deriveBoard(server, defaultConfig());

    expect(columns[0].cards).toHaveLength(2);
    // Cards are reversed (newest first) within each column
    expect(columns[0].cards[0].sessionName).toBe("ops");
    expect(columns[0].cards[1].sessionName).toBe("dev");
  });

  it("shows unstarted cards (no windowId) in their column", () => {
    const server = makeServer([]);
    const config: BoardConfig = {
      ...defaultConfig(),
      cards: {
        "card-1": makeCard({ id: "card-1", name: "todo-task", columnId: COL_TODO }),
      },
    };
    const columns = deriveBoard(server, config);

    expect(columns[1].cards).toHaveLength(1);
    expect(columns[1].cards[0].name).toBe("todo-task");
    expect(columns[1].cards[0].started).toBe(false);
    expect(columns[1].cards[0].windowId).toBeNull();
  });

  it("shows closed cards (with closedAt) with closed flag", () => {
    const server = makeServer([]);
    const config: BoardConfig = {
      ...defaultConfig(),
      cards: {
        "card-1": makeCard({
          id: "card-1",
          name: "done-task",
          columnId: COL_IN_PROGRESS,
          windowId: "@99",
          startedAt: Date.now() - 10000,
          closedAt: Date.now() - 5000,
        }),
      },
    };
    const columns = deriveBoard(server, config);

    // Card's window is not in tmux, so it should be in unstarted/closed cards
    expect(columns[2].cards).toHaveLength(1);
    expect(columns[2].cards[0].closed).toBe(true);
    expect(columns[2].cards[0].started).toBe(false);
  });
});

describe("reconcileConfig", () => {
  it("sets closedAt on cards whose window no longer exists", () => {
    const server = makeServer([{ id: "@0", name: "editor" }]);
    const config: BoardConfig = {
      ...defaultConfig(),
      cards: {
        "card-1": makeCard({ id: "card-1", windowId: "@0", columnId: COL_IN_PROGRESS }),
        "card-2": makeCard({ id: "card-2", windowId: "@99", columnId: COL_IN_PROGRESS }),
      },
    };
    const reconciled = reconcileConfig(config, server);

    expect(reconciled.cards["card-1"].closedAt).toBeUndefined();
    expect(reconciled.cards["card-2"].closedAt).toBeDefined();
  });

  it("detaches closed card when window ID is reused (not 'reappeared')", () => {
    const server = makeServer([{ id: "@0", name: "editor" }]);
    const config: BoardConfig = {
      ...defaultConfig(),
      cards: {
        "card-1": makeCard({ id: "card-1", windowId: "@0", closedAt: Date.now() - 1000 }),
      },
    };
    const reconciled = reconcileConfig(config, server);

    // Card should be detached, not reclaimed
    expect(reconciled.cards["card-1"].windowId).toBeUndefined();
    expect(reconciled.cards["card-1"].closedAt).toBeDefined();
  });

  it("preserves columns unchanged", () => {
    const server = makeServer([]);
    const config = defaultConfig();
    const reconciled = reconcileConfig(config, server);

    expect(reconciled.columns).toEqual(config.columns);
  });

  it("clears windowId when window is gone (prevents stale ID reuse)", () => {
    const server = makeServer([]);
    const config: BoardConfig = {
      ...defaultConfig(),
      cards: {
        "card-1": makeCard({ id: "card-1", windowId: "@5", columnId: COL_IN_PROGRESS }),
      },
    };
    const reconciled = reconcileConfig(config, server);

    expect(reconciled.cards["card-1"].closedAt).toBeDefined();
    expect(reconciled.cards["card-1"].windowId).toBeUndefined();
  });

  it("clears stale windowId on already-closed cards when window is gone", () => {
    const server = makeServer([]);
    const config: BoardConfig = {
      ...defaultConfig(),
      cards: {
        "card-1": makeCard({
          id: "card-1",
          windowId: "@5",
          columnId: COL_IN_PROGRESS,
          closedAt: Date.now() - 5000,
        }),
      },
    };
    const reconciled = reconcileConfig(config, server);

    expect(reconciled.cards["card-1"].closedAt).toBeDefined();
    expect(reconciled.cards["card-1"].windowId).toBeUndefined();
  });

  it("detaches closed card when a new window reuses its ID", () => {
    // A closed card still has windowId "@5". A new, unrelated window gets ID "@5".
    // reconcileConfig should detach the card, not reclaim the window.
    const server = makeServer([{ id: "@5", name: "new-shell" }]);
    const config: BoardConfig = {
      ...defaultConfig(),
      cards: {
        "card-1": makeCard({
          id: "card-1",
          name: "old-task",
          windowId: "@5",
          columnId: COL_IN_PROGRESS,
          closedAt: Date.now() - 5000,
        }),
      },
    };
    const reconciled = reconcileConfig(config, server);

    // Card should be detached — windowId cleared, closedAt preserved
    expect(reconciled.cards["card-1"].windowId).toBeUndefined();
    expect(reconciled.cards["card-1"].closedAt).toBeDefined();

    // And deriveBoard should show the new window as uncategorized
    const columns = deriveBoard(server, reconciled);
    const unassigned = columns[0].cards;
    expect(unassigned).toHaveLength(1);
    expect(unassigned[0].uncategorized).toBe(true);
    expect(unassigned[0].name).toBe("new-shell");
  });

  it("does not link a new window to an old closed card with reused ID", () => {
    // Simulate: card-1 had window @5, window was closed and windowId cleared.
    // A new tmux window gets ID @5 — it should appear as uncategorized, not linked to card-1.
    const server = makeServer([{ id: "@5", name: "new-shell" }]);
    const config: BoardConfig = {
      ...defaultConfig(),
      cards: {
        "card-1": makeCard({
          id: "card-1",
          name: "old-task",
          columnId: COL_IN_PROGRESS,
          closedAt: Date.now() - 5000,
          // windowId already cleared by reconcileConfig fix
        }),
      },
    };
    const columns = deriveBoard(server, config);

    // The new window should be uncategorized, not linked to old card
    const unassigned = columns[0].cards;
    expect(unassigned).toHaveLength(1);
    expect(unassigned[0].uncategorized).toBe(true);
    expect(unassigned[0].name).toBe("new-shell");
  });

  it("returns same config reference when nothing changed", () => {
    const server = makeServer([{ id: "@0", name: "editor" }]);
    const config: BoardConfig = {
      ...defaultConfig(),
      cards: {
        "card-1": makeCard({ id: "card-1", windowId: "@0" }),
      },
    };
    const reconciled = reconcileConfig(config, server);

    expect(reconciled).toBe(config); // same reference — no unnecessary copies
  });
});
