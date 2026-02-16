import { describe, it, expect } from "vitest";
import { parseSessions, parseWindows, parsePanes, assembleServer } from "../tmux/parse.js";

describe("parseSessions", () => {
  it("parses session lines", () => {
    const output = "$0\tdev\t1\n$1\twork\t0\n";
    const sessions = parseSessions(output);
    expect(sessions).toEqual([
      { id: "$0", name: "dev", attached: true, windows: [] },
      { id: "$1", name: "work", attached: false, windows: [] },
    ]);
  });

  it("returns empty array for empty input", () => {
    expect(parseSessions("")).toEqual([]);
    expect(parseSessions("  ")).toEqual([]);
  });
});

describe("parseWindows", () => {
  it("parses window lines with session reference", () => {
    const output = "$0\t@0\t0\teditor\t1\n$0\t@1\t1\tshell\t0\n";
    const windows = parseWindows(output);
    expect(windows).toEqual([
      { sessionId: "$0", id: "@0", index: 0, name: "editor", active: true, panes: [] },
      { sessionId: "$0", id: "@1", index: 1, name: "shell", active: false, panes: [] },
    ]);
  });
});

describe("parsePanes", () => {
  it("parses pane lines with window reference", () => {
    const output = "@0\t%0\t0\t1\tzsh\t1234\t/home/user\t80\t24\n";
    const panes = parsePanes(output);
    expect(panes).toEqual([
      {
        windowId: "@0",
        id: "%0",
        index: 0,
        active: true,
        command: "zsh",
        pid: 1234,
        workingDir: "/home/user",
        width: 80,
        height: 24,
      },
    ]);
  });
});

describe("assembleServer", () => {
  it("nests panes into windows into sessions", () => {
    const sessions = parseSessions("$0\tdev\t1\n");
    const windows = parseWindows("$0\t@0\t0\teditor\t1\n");
    const panes = parsePanes("@0\t%0\t0\t1\tzsh\t1234\t/home\t80\t24\n");

    const server = assembleServer("default", sessions, windows, panes);

    expect(server.serverName).toBe("default");
    expect(server.sessions).toHaveLength(1);
    expect(server.sessions[0].windows).toHaveLength(1);
    expect(server.sessions[0].windows[0].panes).toHaveLength(1);
    expect(server.sessions[0].windows[0].panes[0].id).toBe("%0");
  });

  it("handles sessions with no windows", () => {
    const sessions = parseSessions("$0\tempty\t0\n");
    const server = assembleServer("tmux", sessions, [], []);
    expect(server.sessions[0].windows).toEqual([]);
  });
});
