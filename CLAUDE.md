# CLAUDE.md

<!-- Worktree test: verified editing works in worktree branch test-work-tree -->

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Tukan is a kanban-style task manager for tmux windows/sessions, built as a TUI. It lets users organize tmux windows as kanban cards, create task cards, and launch tmux windows from them.

## Runtime & Tools

- **Runtime**: Node.js + TypeScript (via tsx)
- **Package manager**: npm
- **Testing**: `npx vitest` (unit tests), `npx vitest run` (CI)
- **Run**: `npx tsx src/index.tsx [server-name]` (defaults to cwd basename)
- **TUI framework**: Ink (React for CLIs)

## Architecture

- **Functional core, imperative shell**: Pure business logic (board derivation, navigation, tmux arg building) stays separate from IO (tmux IPC, terminal rendering, state persistence)
- **tmux interaction**: Uses `tmux` CLI commands. Each tukan instance targets a tmux server by name (`-L`). Auto-creates the server if it doesn't exist.
- **TUI**: Built with Ink — React-based terminal UI framework

## Key Concepts

- **Unified Card model**: Every task is a `Card` record (`src/board/types.ts`) that persists through its full lifecycle. Cards are stored in `config.cards: Record<string, Card>` keyed by UUID.
- **Card lifecycle**: Unstarted (no `windowId`) → Started (`windowId` set, `startedAt` set) → Closed (window gone, `startedAt` present) → Restarted (new `windowId`). Cards are never deleted on start — they're updated in-place.
- **Uncategorized windows**: Tmux windows with no card record appear in the Unassigned column. Moving or editing them auto-creates a Card record.
- **BoardCard (view model)**: Derived from Card + tmux state. Key flags: `started` (has live window), `closed` (was started, window gone), `uncategorized` (tmux window with no card).
- **Pane interaction CLI**: `tukan peek` reads pane content (via `tmux capture-pane`), `tukan send` sends keystrokes (via `tmux send-keys`). Useful for AI agents or responding to prompts without switching windows.
- **Worktree support**: Cards can opt into git worktree creation — a sibling directory and branch are created when the card is started.

## Project Structure

- `src/board/` — Pure board logic (types, derive, navigation, activity, pane-preview)
- `src/tmux/` — Tmux interaction (client, parse, switch, create)
- `src/ui/` — Ink/React UI components (App, Board, Column, Card, NewCardModal, TextInput, SelectInput, StatusBar)
- `src/state/` — State persistence (JSON file store, migration from old format)
- `src/__tests__/` — Vitest unit tests

## State Management

- **Project-local card storage**: Cards are stored in `<projectDir>/.tukan.cards` (a JSON file containing `BoardConfig`). This file is git-committable and travels with the repo.
- **Registry**: `~/.config/tukan/registry.json` maps session names to project directories, so tukan can locate cards for any registered project from any cwd.
- **Ephemeral state**: Runtime data (activity timestamps, pane hashes) stays in `~/.config/tukan/sessions/{sessionName}.json`, separate from card data.
- **Auto-registration**: Sessions are automatically registered in the registry on first use. Explicit registration via `tukan register [path]`.
- **Lazy migration**: Old centralized session files are auto-migrated to project-local `.tukan.cards` on first access.
- `configRef` pattern: App.tsx uses `useRef(config)` updated each render so all callbacks read the latest config, avoiding stale closures across async operations and `useCallback` boundaries.
- `onSave` accepts a full `SessionState` (board config + activity times). App.tsx builds this from `configRef.current` + `activityRef.current`, eliminating stale closure bugs.
- `writeSessionState` splits the write: board config → `.tukan.cards`, ephemeral → sessions dir, registry upsert. The write is fire-and-forget (not awaited).
- `migrateConfig()` in `store.ts` converts the old format (`assignments` + `virtualCards` + `cardMeta`) to the unified `cards: Record` format at load time.

## Card Indicators

Indicators show window/activity status, not card existence. Virtual cards (unstarted, no tmux window) have no indicator. Cards with a live window get at least `○`, with more specific states taking precedence:

- (blank) — virtual/unstarted card (no window)
- `○` — has tmux window, idle
- `●` — active window
- `◆` (green) — has recent activity
- spinner — operation in progress
- `◇` — closed (was started, window gone)

## Keybindings

- `←→` navigate columns, `↑↓` navigate cards
- `h/l` move card between columns
- `s` start/restart card (creates tmux window, moves to in-progress, switches)
- `Enter` switch to window (live cards) / confirm start (unstarted/closed cards)
- `n` new card modal, `e` edit card, `r` resolve (move to Done)
- `q` quit

## CLI Commands

- `tukan add <name>` create card, `tukan start <card>` start card (`--wait` to block and stream pane changes, `--json` for NDJSON events), `tukan stop <card>` stop card
- `tukan resolve <card>` move to Done, `tukan edit <card>` edit card
- `tukan peek <card>` print a card's current pane content (`-n N` for last N non-blank lines)
- `tukan send <card> <text>` send keystrokes to a card's tmux pane (`--no-enter` to skip Enter)
- `tukan show <card>` print card details (name, description, AC, column, dir, status, timestamps); `--json` for structured output
- `tukan list` list cards, `tukan refresh` sync activity, `tukan sessions` list sessions
- `tukan register [path]` register a project directory (defaults to cwd); `-s` to set session name
- `tukan migrate` migrate all sessions from centralized to project-local storage (`--dry-run` to preview)
