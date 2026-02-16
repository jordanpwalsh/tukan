import { describe, it, expect } from "vitest";
import { buildNewWindowArgs, buildNewSessionArgs, buildWorktreeArgs, sanitizeBranchName } from "../tmux/create.js";
import type { NewWindowOpts } from "../tmux/create.js";

const serverName = "myserver";

const baseOpts: NewWindowOpts = {
  sessionName: "main",
  name: "my-task",
  dir: "/home/user/project",
  command: "shell",
};

const baseArgs = [
  "-L", serverName,
  "new-window",
  "-P", "-F", "#{window_id}",
  "-t", "main",
  "-n", "my-task",
  "-c", "/home/user/project",
];

const envArgs = [
  "-e", "TUKAN_CARD_NAME=my-task",
  "-e", "TUKAN_CARD_DESCRIPTION=",
  "-e", "TUKAN_CARD_AC=",
];

describe("buildNewWindowArgs", () => {
  it("shell mode returns base args with env vars and no trailing command", () => {
    const args = buildNewWindowArgs(baseOpts, serverName);
    expect(args).toEqual([...baseArgs, ...envArgs]);
  });

  it("claude mode appends claude and prompt with description and criteria", () => {
    const args = buildNewWindowArgs(
      {
        ...baseOpts,
        command: "claude",
        description: "Fix the login bug",
        acceptanceCriteria: "Users can log in successfully",
      },
      serverName,
    );
    expect(args).toEqual([
      ...baseArgs,
      "-e", "TUKAN_CARD_NAME=my-task",
      "-e", "TUKAN_CARD_DESCRIPTION=Fix the login bug",
      "-e", "TUKAN_CARD_AC=Users can log in successfully",
      "claude",
      "Fix the login bug\n\nAcceptance criteria: Users can log in successfully",
    ]);
  });

  it("custom mode appends the custom command", () => {
    const args = buildNewWindowArgs(
      { ...baseOpts, command: "custom", customCommand: "vim ." },
      serverName,
    );
    expect(args).toEqual([...baseArgs, ...envArgs, "vim ."]);
  });

  it("claude mode with no description or criteria appends only claude", () => {
    const args = buildNewWindowArgs(
      { ...baseOpts, command: "claude" },
      serverName,
    );
    expect(args).toEqual([...baseArgs, ...envArgs, "claude"]);
  });

  it("claude mode with only description omits criteria", () => {
    const args = buildNewWindowArgs(
      { ...baseOpts, command: "claude", description: "Do something" },
      serverName,
    );
    expect(args).toEqual([
      ...baseArgs,
      "-e", "TUKAN_CARD_NAME=my-task",
      "-e", "TUKAN_CARD_DESCRIPTION=Do something",
      "-e", "TUKAN_CARD_AC=",
      "claude",
      "Do something",
    ]);
  });

  it("omits -L when serverName is empty", () => {
    const args = buildNewWindowArgs(baseOpts, "");
    expect(args).toEqual([
      "new-window",
      "-P", "-F", "#{window_id}",
      "-t", "main",
      "-n", "my-task",
      "-c", "/home/user/project",
      ...envArgs,
    ]);
  });
});

describe("buildNewSessionArgs", () => {
  it("uses new-session -d -s instead of new-window -t", () => {
    const args = buildNewSessionArgs(baseOpts, serverName);
    expect(args).toEqual([
      "-L", serverName,
      "new-session",
      "-d",
      "-P", "-F", "#{window_id}",
      "-s", "main",
      "-n", "my-task",
      "-c", "/home/user/project",
      ...envArgs,
    ]);
  });

  it("appends command for claude mode", () => {
    const args = buildNewSessionArgs(
      { ...baseOpts, command: "claude", description: "Fix bug" },
      serverName,
    );
    expect(args[args.length - 2]).toBe("claude");
    expect(args[args.length - 1]).toBe("Fix bug");
  });
});

describe("sanitizeBranchName", () => {
  it("lowercases and replaces spaces with hyphens", () => {
    expect(sanitizeBranchName("Fix Login Bug")).toBe("fix-login-bug");
  });

  it("strips non-alphanumeric characters", () => {
    expect(sanitizeBranchName("feat: add @auth!")).toBe("feat-add-auth");
  });

  it("collapses consecutive dots", () => {
    expect(sanitizeBranchName("v1..2")).toBe("v1.2");
  });

  it("trims leading/trailing separators", () => {
    expect(sanitizeBranchName("-hello-")).toBe("hello");
  });

  it("falls back to 'worktree' for empty result", () => {
    expect(sanitizeBranchName("!!!")).toBe("worktree");
  });
});

describe("buildWorktreeArgs", () => {
  it("returns git worktree add args and the worktree path", () => {
    const result = buildWorktreeArgs("/home/user/project", "Fix Login Bug");
    expect(result.args).toEqual([
      "-C", "/home/user/project",
      "worktree", "add",
      "/home/user/project-fix-login-bug",
      "-b", "fix-login-bug",
    ]);
    expect(result.worktreePath).toBe("/home/user/project-fix-login-bug");
  });
});
