import { describe, it, expect } from "vitest";
import { resolveSwitchArgs } from "../tmux/switch.js";
import type { TmuxServer } from "../tmux/types.js";

const server: TmuxServer = {
  serverName: "myserver",
  sessions: [
    {
      id: "$0",
      name: "main",
      attached: true,
      windows: [
        {
          id: "@1",
          index: 0,
          name: "editor",
          active: true,
          panes: [],
        },
      ],
    },
  ],
};

const target = { sessionName: "main", windowId: "@1" };

describe("resolveSwitchArgs", () => {
  it("returns switch mode when inside tmux on the same server", () => {
    const result = resolveSwitchArgs(target, server, {
      TMUX: "/tmp/tmux-1000/myserver,12345,0",
    });

    expect(result).toEqual({
      mode: "switch",
      args: ["-L", "myserver", "switch-client", "-t", "main:@1"],
    });
  });

  it("returns attach mode when outside tmux", () => {
    const result = resolveSwitchArgs(target, server, {});

    expect(result).toEqual({
      mode: "attach",
      args: ["-L", "myserver", "attach-session", "-t", "main:@1"],
    });
  });

  it("returns attach mode when inside tmux on a different server", () => {
    const result = resolveSwitchArgs(target, server, {
      TMUX: "/tmp/tmux-1000/other,12345,0",
    });

    expect(result).toEqual({
      mode: "attach",
      args: ["-L", "myserver", "attach-session", "-t", "main:@1"],
    });
  });

  it("omits -L when serverName is empty", () => {
    const noNameServer: TmuxServer = { serverName: "", sessions: server.sessions };
    const result = resolveSwitchArgs(target, noNameServer, {});

    expect(result).toEqual({
      mode: "attach",
      args: ["attach-session", "-t", "main:@1"],
    });
  });
});
