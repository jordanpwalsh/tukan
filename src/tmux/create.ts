import path from "node:path";

export function sanitizeBranchName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9._/-]/g, "")
    .replace(/\.{2,}/g, ".")
    .replace(/^[-./]+|[-./]+$/g, "")
    || "worktree";
}

export function buildWorktreeArgs(dir: string, name: string, relativePath?: string): { args: string[]; worktreePath: string } {
  const branch = sanitizeBranchName(name);
  const repoName = path.basename(dir);
  const dirName = `${repoName}-${branch}`;
  const worktreePath = relativePath
    ? path.resolve(dir, relativePath)
    : path.resolve(dir, "..", dirName);
  return {
    args: ["-C", dir, "worktree", "add", worktreePath, "-b", branch],
    worktreePath,
  };
}

export interface NewWindowOpts {
  sessionName: string;
  name: string;
  dir: string;
  commandTemplate: string;
  description?: string;
  acceptanceCriteria?: string;
}

function buildPrompt(description?: string, acceptanceCriteria?: string): string {
  const parts: string[] = [];
  if (description) parts.push(description);
  if (acceptanceCriteria) parts.push(`Acceptance criteria: ${acceptanceCriteria}`);
  return parts.join("\n\n");
}

export function buildNewSessionArgs(opts: NewWindowOpts, serverName: string): string[] {
  const args = [
    ...(serverName ? ["-L", serverName] : []),
    "new-session",
    "-d",
    "-P", "-F", "#{window_id}",
    "-s", opts.sessionName,
    "-n", opts.name,
    "-c", opts.dir,
  ];

  appendCommand(args, opts);
  return args;
}

export function buildNewWindowArgs(opts: NewWindowOpts, serverName: string): string[] {
  const args = [
    ...(serverName ? ["-L", serverName] : []),
    "new-window",
    "-P", "-F", "#{window_id}",
    "-t", opts.sessionName,
    "-n", opts.name,
    "-c", opts.dir,
  ];

  appendCommand(args, opts);
  return args;
}

function appendEnvVars(args: string[], opts: NewWindowOpts): void {
  args.push("-e", `TUKAN_CARD_NAME=${opts.name}`);
  args.push("-e", `TUKAN_CARD_DESCRIPTION=${opts.description ?? ""}`);
  args.push("-e", `TUKAN_CARD_AC=${opts.acceptanceCriteria ?? ""}`);
}

function appendCommand(args: string[], opts: NewWindowOpts): void {
  appendEnvVars(args, opts);
  if (opts.commandTemplate) {
    if (opts.commandTemplate === "claude") {
      // Special handling: append prompt from description
      const prompt = buildPrompt(opts.description, opts.acceptanceCriteria);
      args.push("claude", ...(prompt ? [prompt] : []));
    } else {
      args.push(opts.commandTemplate);
    }
  }
  // empty template = default shell (no command appended)
}
