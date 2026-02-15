import { describe, it, expect } from "vitest";
import { deriveBoard, reconcileConfig } from "../board/derive.js";
import { defaultConfig } from "../board/types.js";
import type { TmuxServer } from "../tmux/types.js";

function makeServer(windows: Array<{ id: string; name: string; sessionName?: string }>): TmuxServer {
  const sessionMap = new Map<string, typeof windows>();
  for (const w of windows) {
    const sn = w.sessionName ?? "main";
    if (!sessionMap.has(sn)) sessionMap.set(sn, []);
    sessionMap.get(sn)!.push(w);
  }

  return {
    socketPath: "/tmp/tmux-test",
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

  it("respects column assignments", () => {
    const server = makeServer([
      { id: "@0", name: "editor" },
      { id: "@1", name: "shell" },
    ]);
    const config = {
      ...defaultConfig(),
      assignments: { "@1": "todo" },
    };
    const columns = deriveBoard(server, config);

    expect(columns[0].cards).toHaveLength(1);
    expect(columns[0].cards[0].name).toBe("editor");
    expect(columns[1].cards).toHaveLength(1);
    expect(columns[1].cards[0].name).toBe("shell");
  });

  it("falls back to first column for invalid assignment", () => {
    const server = makeServer([{ id: "@0", name: "editor" }]);
    const config = {
      ...defaultConfig(),
      assignments: { "@0": "nonexistent" },
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
});

describe("reconcileConfig", () => {
  it("removes assignments for windows that no longer exist", () => {
    const server = makeServer([{ id: "@0", name: "editor" }]);
    const config = {
      ...defaultConfig(),
      assignments: { "@0": "new", "@99": "done" },
    };
    const reconciled = reconcileConfig(config, server);

    expect(reconciled.assignments).toEqual({ "@0": "new" });
  });

  it("preserves columns unchanged", () => {
    const server = makeServer([]);
    const config = defaultConfig();
    const reconciled = reconcileConfig(config, server);

    expect(reconciled.columns).toEqual(config.columns);
  });
});
