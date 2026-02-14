# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Tukan is a kanban-style task manager for tmux windows/sessions, built as a TUI with plans for a webapp frontend. It lets users organize and visualize tmux windows as kanban cards.

## Runtime & Tools

- **Runtime**: Node.js + TypeScript (via tsx)
- **Package manager**: npm
- **Testing**: `npx vitest` (unit tests), `npx vitest run` (CI)
- **Run**: `npx tsx src/index.ts`
- **TUI framework**: OpenTUI (see `.agents/skills/opentui/` for full reference docs)

## Architecture

- **Functional core, imperative shell**: Pure business logic (kanban state, task models, column operations) stays separate from IO (tmux IPC, terminal rendering, webapp server)
- **tmux interaction**: Use `tmux` CLI commands for listing/managing windows and sessions
- **TUI**: Built with OpenTUI — reference docs and decision trees in `.agents/skills/opentui/SKILL.md`

## OpenTUI Key Rules

1. Always call `renderer.destroy()` before exiting — never bare `process.exit()`
2. Focus nested components directly — parents don't forward focus
3. Use `display: none` for visibility toggling, not element removal
4. Console.log is hidden during TUI — use F12 overlay or file logging
5. Avoid deep component nesting for layout performance
