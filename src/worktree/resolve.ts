import { buildWorktreeArgs, buildWorktreeMergeArgs, buildWorktreeRemoveArgs } from "../tmux/create.js";

export type ResolveStepStatus = "pending" | "running" | "completed" | "failed" | "skipped";

export interface ResolveStep {
  id: "check-clean" | "kill-window" | "merge-branch" | "delete-branch" | "remove-worktree" | "resolve-card";
  label: string;
  status: ResolveStepStatus;
  detail?: string;
}

export interface ResolveWorkflowOptions {
  dir: string;
  cardName: string;
  worktreePath?: string;
  mergeWorktree: boolean;
  windowId?: string;
  force?: boolean;
  execGit: (args: string[]) => Promise<{ stdout?: string }>;
  killWindow?: () => Promise<void>;
  finalize: () => Promise<void>;
  onUpdate?: (steps: ResolveStep[]) => void;
}

export function buildResolveSteps(hasWindow: boolean, mergeWorktree: boolean): ResolveStep[] {
  const steps: ResolveStep[] = [];
  if (mergeWorktree) {
    steps.push({ id: "check-clean", label: "Check worktree for uncommitted changes", status: "pending" });
  }
  if (hasWindow) {
    steps.push({ id: "kill-window", label: "Close tmux window", status: "pending" });
  }
  if (mergeWorktree) {
    steps.push({ id: "merge-branch", label: "Merge worktree branch into current branch", status: "pending" });
    steps.push({ id: "delete-branch", label: "Delete merged worktree branch", status: "pending" });
    steps.push({ id: "remove-worktree", label: "Remove worktree directory", status: "pending" });
  }
  steps.push({ id: "resolve-card", label: "Move card to Done", status: "pending" });
  return steps;
}

function cloneSteps(steps: ResolveStep[]): ResolveStep[] {
  return steps.map((step) => ({ ...step }));
}

function updateStep(
  steps: ResolveStep[],
  stepId: ResolveStep["id"],
  status: ResolveStepStatus,
  detail?: string,
  onUpdate?: (steps: ResolveStep[]) => void,
): void {
  const step = steps.find((candidate) => candidate.id === stepId);
  if (!step) return;
  step.status = status;
  step.detail = detail;
  onUpdate?.(cloneSteps(steps));
}

export async function runResolveWorkflow(options: ResolveWorkflowOptions): Promise<ResolveStep[]> {
  const {
    dir,
    cardName,
    worktreePath,
    mergeWorktree,
    windowId,
    force = false,
    execGit,
    killWindow,
    finalize,
    onUpdate,
  } = options;
  const steps = buildResolveSteps(!!windowId, mergeWorktree);
  onUpdate?.(cloneSteps(steps));

  const wt = buildWorktreeArgs(dir, cardName, worktreePath);
  const branch = wt.args[wt.args.length - 1];
  const mergeArgs = buildWorktreeMergeArgs(dir, branch);
  const removeArgs = buildWorktreeRemoveArgs(dir, wt.worktreePath);

  if (mergeWorktree) {
    updateStep(steps, "check-clean", "running", undefined, onUpdate);
    try {
      const { stdout } = await execGit(["-C", wt.worktreePath, "status", "--porcelain"]);
      if (stdout?.trim()) {
        if (!force) {
          updateStep(
            steps,
            "check-clean",
            "failed",
            "Worktree has uncommitted changes. Commit or stash first, or resolve without merge.",
            onUpdate,
          );
          throw new Error("Worktree has uncommitted changes. Commit or stash first, or resolve without merge.");
        }
        updateStep(steps, "check-clean", "completed", "Uncommitted changes present; continuing because force was enabled.", onUpdate);
      } else {
        updateStep(steps, "check-clean", "completed", undefined, onUpdate);
      }
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("Worktree has uncommitted changes.")) {
        throw error;
      }
      updateStep(steps, "check-clean", "skipped", "Could not inspect worktree state; continuing.", onUpdate);
    }
  }

  if (windowId && killWindow) {
    updateStep(steps, "kill-window", "running", undefined, onUpdate);
    try {
      await killWindow();
      updateStep(steps, "kill-window", "completed", undefined, onUpdate);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      updateStep(steps, "kill-window", "failed", `Could not close tmux window: ${detail}`, onUpdate);
    }
  }

  if (mergeWorktree) {
    updateStep(steps, "merge-branch", "running", undefined, onUpdate);
    try {
      await execGit(mergeArgs[0]);
      updateStep(steps, "merge-branch", "completed", undefined, onUpdate);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      updateStep(steps, "merge-branch", "failed", detail, onUpdate);
      throw error;
    }

    updateStep(steps, "delete-branch", "running", undefined, onUpdate);
    try {
      await execGit(mergeArgs[1]);
      updateStep(steps, "delete-branch", "completed", undefined, onUpdate);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      updateStep(steps, "delete-branch", "failed", detail, onUpdate);
      throw error;
    }

    updateStep(steps, "remove-worktree", "running", undefined, onUpdate);
    try {
      await execGit(removeArgs);
      updateStep(steps, "remove-worktree", "completed", undefined, onUpdate);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      updateStep(steps, "remove-worktree", "failed", detail, onUpdate);
      throw error;
    }
  }

  updateStep(steps, "resolve-card", "running", undefined, onUpdate);
  try {
    await finalize();
    updateStep(steps, "resolve-card", "completed", undefined, onUpdate);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    updateStep(steps, "resolve-card", "failed", detail, onUpdate);
    throw error;
  }

  return cloneSteps(steps);
}
