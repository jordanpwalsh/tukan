import { describe, it, expect } from "vitest";
import { buildNewWindowArgs, buildNewSessionArgs, buildWorktreeArgs, buildWorktreeMergeArgs, buildWorktreeRemoveArgs, buildSendKeysArgs, sanitizeBranchName } from "../tmux/create.js";
import type { NewWindowOpts } from "../tmux/create.js";

const serverName = "myserver";

const baseOpts: NewWindowOpts = {
  sessionName: "main",
  name: "my-task",
  dir: "/home/user/project",
  commandTemplate: "",
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

  it("claude template wraps command so shell remains after exit", () => {
    const args = buildNewWindowArgs(
      {
        ...baseOpts,
        commandTemplate: "claude",
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
      "sh", "-c", 'claude "$@"; exec "${SHELL:-sh}"', "--",
      "Fix the login bug\n\nAcceptance criteria: Users can log in successfully",
    ]);
  });

  it("custom template wraps command so shell remains after exit", () => {
    const args = buildNewWindowArgs(
      { ...baseOpts, commandTemplate: "vim ." },
      serverName,
    );
    expect(args).toEqual([...baseArgs, ...envArgs, "sh", "-c", 'vim .; exec "${SHELL:-sh}"']);
  });

  it("claude template with no description or criteria wraps bare claude", () => {
    const args = buildNewWindowArgs(
      { ...baseOpts, commandTemplate: "claude" },
      serverName,
    );
    expect(args).toEqual([...baseArgs, ...envArgs, "sh", "-c", 'claude "$@"; exec "${SHELL:-sh}"', "--"]);
  });

  it("claude template with only description omits criteria", () => {
    const args = buildNewWindowArgs(
      { ...baseOpts, commandTemplate: "claude", description: "Do something" },
      serverName,
    );
    expect(args).toEqual([
      ...baseArgs,
      "-e", "TUKAN_CARD_NAME=my-task",
      "-e", "TUKAN_CARD_DESCRIPTION=Do something",
      "-e", "TUKAN_CARD_AC=",
      "sh", "-c", 'claude "$@"; exec "${SHELL:-sh}"', "--",
      "Do something",
    ]);
  });

  it("shell mode with description does not append command to args", () => {
    const args = buildNewWindowArgs(
      { ...baseOpts, description: "npm run build" },
      serverName,
    );
    expect(args).toEqual([
      ...baseArgs,
      "-e", "TUKAN_CARD_NAME=my-task",
      "-e", "TUKAN_CARD_DESCRIPTION=npm run build",
      "-e", "TUKAN_CARD_AC=",
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

  it("appends wrapped command for claude template", () => {
    const args = buildNewSessionArgs(
      { ...baseOpts, commandTemplate: "claude", description: "Fix bug" },
      serverName,
    );
    expect(args.slice(-5)).toEqual([
      "sh", "-c", 'claude "$@"; exec "${SHELL:-sh}"', "--", "Fix bug",
    ]);
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

describe("buildSendKeysArgs", () => {
  it("builds send-keys args for a single line", () => {
    const result = buildSendKeysArgs("@1", "npm run build", "myserver");
    expect(result).toEqual([
      ["-L", "myserver", "send-keys", "-t", "@1", "npm run build", "Enter"],
    ]);
  });

  it("splits multiline description into separate send-keys calls", () => {
    const result = buildSendKeysArgs("@1", "npm install\nnpm run build", "myserver");
    expect(result).toEqual([
      ["-L", "myserver", "send-keys", "-t", "@1", "npm install", "Enter"],
      ["-L", "myserver", "send-keys", "-t", "@1", "npm run build", "Enter"],
    ]);
  });

  it("skips blank lines", () => {
    const result = buildSendKeysArgs("@1", "line1\n\n\nline2", "myserver");
    expect(result).toEqual([
      ["-L", "myserver", "send-keys", "-t", "@1", "line1", "Enter"],
      ["-L", "myserver", "send-keys", "-t", "@1", "line2", "Enter"],
    ]);
  });

  it("omits -L when serverName is empty", () => {
    const result = buildSendKeysArgs("@1", "echo hi", "");
    expect(result).toEqual([
      ["send-keys", "-t", "@1", "echo hi", "Enter"],
    ]);
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

  it("uses custom relative path when provided", () => {
    const result = buildWorktreeArgs("/home/user/project", "My Feature", "../custom-wt");
    expect(result.worktreePath).toBe("/home/user/custom-wt");
    expect(result.args).toContain("/home/user/custom-wt");
  });
});

describe("buildWorktreeMergeArgs", () => {
  it("returns merge and branch delete steps", () => {
    const steps = buildWorktreeMergeArgs("/home/user/project", "fix-login-bug");
    expect(steps).toEqual([
      ["-C", "/home/user/project", "merge", "fix-login-bug"],
      ["-C", "/home/user/project", "branch", "-d", "fix-login-bug"],
    ]);
  });

  it("passes branch name through unchanged", () => {
    const steps = buildWorktreeMergeArgs("/repo", "feat/my-branch");
    expect(steps[0]).toEqual(["-C", "/repo", "merge", "feat/my-branch"]);
    expect(steps[1]).toEqual(["-C", "/repo", "branch", "-d", "feat/my-branch"]);
  });
});

describe("buildWorktreeRemoveArgs", () => {
  it("returns git worktree remove args", () => {
    const args = buildWorktreeRemoveArgs("/home/user/project", "/home/user/project-fix-login-bug");
    expect(args).toEqual([
      "-C", "/home/user/project",
      "worktree", "remove",
      "/home/user/project-fix-login-bug",
    ]);
  });
});

describe("worktree resolve round-trip", () => {
  it("buildWorktreeArgs output feeds into remove and merge helpers", () => {
    const wt = buildWorktreeArgs("/home/user/project", "Fix Login Bug");
    const branch = sanitizeBranchName("Fix Login Bug");

    const removeArgs = buildWorktreeRemoveArgs("/home/user/project", wt.worktreePath);
    expect(removeArgs).toContain(wt.worktreePath);

    const mergeSteps = buildWorktreeMergeArgs("/home/user/project", branch);
    expect(mergeSteps[0][3]).toBe("fix-login-bug");
    expect(mergeSteps[1][4]).toBe("fix-login-bug");
  });

  it("worktree add args without -b checks out existing branch", () => {
    const wt = buildWorktreeArgs("/home/user/project", "Fix Login Bug");
    const checkoutArgs = wt.args.filter((a) => a !== "-b");
    expect(checkoutArgs).toEqual([
      "-C", "/home/user/project",
      "worktree", "add",
      "/home/user/project-fix-login-bug",
      "fix-login-bug",
    ]);
  });
});
