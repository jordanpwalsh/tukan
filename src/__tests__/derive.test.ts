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
    expect(columns[0].cards[0].sessionName).toBe("dev");
    expect(columns[0].cards[1].sessionName).toBe("ops");
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

  it("clears closedAt when window reappears", () => {
    const server = makeServer([{ id: "@0", name: "editor" }]);
    const config: BoardConfig = {
      ...defaultConfig(),
      cards: {
        "card-1": makeCard({ id: "card-1", windowId: "@0", closedAt: Date.now() - 1000 }),
      },
    };
    const reconciled = reconcileConfig(config, server);

    expect(reconciled.cards["card-1"].closedAt).toBeUndefined();
  });

  it("preserves columns unchanged", () => {
    const server = makeServer([]);
    const config = defaultConfig();
    const reconciled = reconcileConfig(config, server);

    expect(reconciled.columns).toEqual(config.columns);
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
