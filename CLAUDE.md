# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Tukan is a kanban-style task manager for tmux windows/sessions, built as a TUI with plans for a webapp frontend. It lets users organize and visualize tmux windows as kanban cards.

## Runtime & Tools

- **Runtime**: Node.js + TypeScript (via tsx)
- **Package manager**: npm
- **Testing**: `npx vitest` (unit tests), `npx vitest run` (CI)
- **Run**: `npx tsx src/index.tsx`
- **TUI framework**: Ink (React for CLIs)

## Architecture

- **Functional core, imperative shell**: Pure business logic (kanban state, task models, column operations) stays separate from IO (tmux IPC, terminal rendering, webapp server)
- **tmux interaction**: Use `tmux` CLI commands for listing/managing windows and sessions
- **TUI**: Built with Ink — React-based terminal UI framework
