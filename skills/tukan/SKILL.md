---
name: tukan
description: Plan, track, and execute coding tasks across projects. Break work into cards, launch isolated tmux workspaces per task, and manage their lifecycle from todo to done.
metadata: {"openclaw":{"requires":{"bins":["tukan","tmux"]},"emoji":"🦜"}}
---

# Tukan — Execute Coding Tasks Across Projects

Use Tukan when you need to break coding work into discrete tasks, execute them in isolated environments, and track progress. Each card represents a coding task (bug fix, feature, refactor) scoped to a specific project directory. Starting a card launches a dedicated tmux workspace for that task — optionally with its own git worktree and branch.

**When to use this skill**: You have coding work to plan and execute — create cards for each task, start them to get isolated workspaces, and resolve them when done.

## Concepts

- **Card**: A coding task with a name, description, acceptance criteria, working directory, and lifecycle state.
- **Columns**: Todo → In Progress → Review → Done. Cards flow left to right as work progresses.
- **Lifecycle**: Cards start in Todo. `start` creates a tmux window pointed at the task's project directory and moves the card to In Progress. `resolve` moves it to Done and optionally merges the git branch.
- **Session**: Cards are scoped to a tmux session (auto-detected or passed with `-s`). Different sessions can track different project boards.
- **Worktree**: Cards can optionally create a git worktree + branch, giving each task an isolated checkout for parallel work on the same repo.
- **Pane preview**: When a card's window goes idle (5+ seconds), the TUI shows the last few lines of pane output on the card — useful for seeing prompts (like Claude Code permission requests) without switching windows. Use `tukan send` to respond.

## Commands

### List cards

```bash
tukan list                    # cards grouped by column (excludes Done)
tukan list -a                 # include Done column
tukan list --column todo      # filter to one column (unassigned|todo|in-progress|review|done)
tukan list -s my-session      # target a specific session
```

Output shows an indicator per card:
- (blank) — unstarted
- `○` — has live tmux window
- `◇` — closed (was started, window is gone)

Each line shows the card's 8-char ID prefix and name.

### Add a card

```bash
tukan add "Fix login bug"
tukan add "New feature" -d "Implement OAuth flow" --ac "Tests pass" --dir /path/to/repo
tukan add "Refactor auth" --command claude      # launch with claude instead of shell
tukan add "Branch work" --worktree              # auto-create git worktree on start
```

Options:
- `-d, --description <text>` — card description
- `--ac <text>` — acceptance criteria
- `--dir <path>` — working directory (defaults to session working dir)
- `--command <type>` — command ID: `shell` (default) or `claude`
- `--worktree` — enable git worktree creation on start
- `-s, --session <name>` — target session

### Start a card

```bash
tukan start a1b2c3d4          # use the 8-char ID prefix from add/list
```

Creates a tmux window, moves card to In Progress. If the card has `--worktree`, a git worktree and branch are created first.

### Stop a card

```bash
tukan stop a1b2c3d4
```

Kills the tmux window and marks the card as closed. The card stays in its current column.

### Resolve a card

```bash
tukan resolve a1b2c3d4
tukan resolve a1b2c3d4 --no-merge   # skip worktree merge
tukan resolve a1b2c3d4 -f           # force resolve with uncommitted changes
```

Moves card to Done. If the card has a live window, kills it. If worktree is enabled, merges the branch back and removes the worktree.

### Edit a card

```bash
tukan edit a1b2c3d4 --name "Fix login page bug"
tukan edit a1b2c3d4 -d "Updated description"
tukan edit a1b2c3d4 --ac "All tests green" --dir /new/path
```

Options: `--name`, `-d/--description`, `--ac`, `--dir`, `--command`.

### Peek at a card's screen

```bash
tukan peek a1b2c3d4             # print the full pane content to stdout
tukan peek a1b2c3d4 -n 10       # last 10 non-blank lines only
tukan peek a1b2c3d4 -n 3        # last 3 lines (like the TUI card preview)
```

Captures and prints the current terminal content of a card's tmux window. Useful for AI agents or scripts that need to read what a process is showing without switching to it.

Options:
- `-n, --tail <lines>` — only show the last N non-blank lines
- `-s, --session <name>` — target session

### Send keystrokes to a card

```bash
tukan send a1b2c3d4 y               # send "y" + Enter to the card's pane
tukan send a1b2c3d4 --no-enter n    # send "n" without pressing Enter
tukan send a1b2c3d4 some text here  # send "some text here" + Enter
```

Sends text to the active pane of a card's tmux window. Useful for responding to prompts (permission requests, input prompts) without switching windows. By default, appends Enter after the text.

Options:
- `--no-enter` — send the text without pressing Enter
- `-s, --session <name>` — target session

### Refresh board state

```bash
tukan refresh
```

Reconciles tmux window state with the board. Promotes idle In Progress cards to Review, demotes active Review cards back to In Progress.

### List tmux sessions

```bash
tukan sessions
```

## Workflow Examples

### Single task in a project

```bash
tukan add "Fix login bug" -d "Users get 401 on valid credentials" --ac "Login works, tests pass" --dir /projects/myapp
# Created card "Fix login bug" (a1b2c3d4)

tukan start a1b2c3d4             # opens tmux window in /projects/myapp
# ... do the work ...
tukan resolve a1b2c3d4
```

### Multiple tasks with isolated git branches

```bash
tukan add "Add OAuth" -d "Implement Google OAuth flow" --dir /projects/myapp --worktree
# Created card "Add OAuth" (e5f6a7b8)

tukan add "Refactor DB layer" -d "Switch from raw SQL to query builder" --dir /projects/myapp --worktree
# Created card "Refactor DB layer" (c9d0e1f2)

tukan start e5f6a7b8             # creates worktree + branch, opens workspace
tukan start c9d0e1f2             # separate worktree + branch, parallel work
# ... work on both independently ...
tukan resolve e5f6a7b8           # merges branch, removes worktree
tukan resolve c9d0e1f2
```

### Check what's in flight

```bash
tukan list                        # see all active cards across columns
tukan list --column in-progress   # just what's being worked on
```

### Respond to a prompt without switching windows

```bash
tukan list --column review        # find idle cards (auto-promoted from in-progress)
tukan peek e5f6a7b8 -n 5          # see what the card is waiting for
# Output: Allow Read(src/index.ts)? (y/n)
tukan send e5f6a7b8 y             # approve the prompt
```

## Tips

- **Always use card IDs** (the 8-char prefix printed by `add` and `list`) for `start`, `stop`, `resolve`, `edit`, and `send` commands. IDs are deterministic; name matching can be ambiguous.
- Use `tukan list` before other commands to see card IDs and current state.
- The `-s` flag on any command targets a specific session if auto-detection doesn't pick the right one.
- Use `--dir` to point each card at the right project directory — cards for different projects can coexist on the same board.
