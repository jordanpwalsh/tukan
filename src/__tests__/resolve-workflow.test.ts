import { describe, expect, it, vi } from "vitest";
import { buildResolveSteps, runResolveWorkflow } from "../worktree/resolve.js";

describe("buildResolveSteps", () => {
  it("builds the full resolve plan in execution order", () => {
    expect(buildResolveSteps(true, true).map((step) => step.id)).toEqual([
      "check-clean",
      "kill-window",
      "merge-branch",
      "delete-branch",
      "remove-worktree",
      "resolve-card",
    ]);
  });

  it("omits worktree steps when merge is disabled", () => {
    expect(buildResolveSteps(false, false).map((step) => step.id)).toEqual([
      "resolve-card",
    ]);
  });
});

describe("runResolveWorkflow", () => {
  it("merges before removing the worktree and finalizes last", async () => {
    const calls: string[] = [];
    const execGit = vi.fn(async (args: string[]) => {
      calls.push(args.join(" "));
      return { stdout: "" };
    });
    const killWindow = vi.fn(async () => {
      calls.push("kill-window");
    });
    const finalize = vi.fn(async () => {
      calls.push("finalize");
    });

    await runResolveWorkflow({
      dir: "/repo",
      cardName: "Fix Login Bug",
      mergeWorktree: true,
      windowId: "@1",
      execGit,
      killWindow,
      finalize,
    });

    expect(calls).toEqual([
      "-C /repo-fix-login-bug status --porcelain",
      "kill-window",
      "-C /repo merge fix-login-bug",
      "-C /repo branch -d fix-login-bug",
      "-C /repo worktree remove /repo-fix-login-bug",
      "finalize",
    ]);
  });

  it("stops before removing the worktree or resolving the card when merge fails", async () => {
    const calls: string[] = [];
    const execGit = vi.fn(async (args: string[]) => {
      calls.push(args.join(" "));
      if (args[2] === "merge") {
        throw new Error("merge conflict");
      }
      return { stdout: "" };
    });
    const finalize = vi.fn(async () => {
      calls.push("finalize");
    });

    await expect(runResolveWorkflow({
      dir: "/repo",
      cardName: "Fix Login Bug",
      mergeWorktree: true,
      execGit,
      finalize,
    })).rejects.toThrow("merge conflict");

    expect(calls).toEqual([
      "-C /repo-fix-login-bug status --porcelain",
      "-C /repo merge fix-login-bug",
    ]);
    expect(finalize).not.toHaveBeenCalled();
  });

  it("allows a dirty worktree when force is enabled", async () => {
    const calls: string[] = [];
    const execGit = vi.fn(async (args: string[]) => {
      calls.push(args.join(" "));
      if (args[2] === "status") {
        return { stdout: " M src/file.ts\n" };
      }
      return { stdout: "" };
    });

    await runResolveWorkflow({
      dir: "/repo",
      cardName: "Fix Login Bug",
      mergeWorktree: true,
      force: true,
      execGit,
      finalize: async () => {
        calls.push("finalize");
      },
    });

    expect(calls).toEqual([
      "-C /repo-fix-login-bug status --porcelain",
      "-C /repo merge fix-login-bug",
      "-C /repo branch -d fix-login-bug",
      "-C /repo worktree remove /repo-fix-login-bug",
      "finalize",
    ]);
  });
});
