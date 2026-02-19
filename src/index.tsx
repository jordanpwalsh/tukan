#!/usr/bin/env node
import { render } from "ink";
import { spawnSync } from "node:child_process";
import { basename } from "node:path";
import { getTmuxState, detectCurrentSession, captureAllPaneContents } from "./tmux/client.js";
import { readSessionState, writeSessionState, migrateConfig } from "./state/store.js";
import { defaultConfig } from "./board/types.js";
import { computePaneHashes } from "./board/activity.js";
import { reconcileConfig } from "./board/derive.js";
import { App } from "./ui/App.js";
import { createProgram } from "./cli.js";
import type { Cursor } from "./board/types.js";
import type { SessionState } from "./state/types.js";

export function detectServerName(): string | undefined {
  const tmuxEnv = process.env.TMUX;
  if (tmuxEnv) {
    // Inside tmux — use the current server
    const socketPath = tmuxEnv.split(",")[0];
    return socketPath.substring(socketPath.lastIndexOf("/") + 1);
  }
  // Outside tmux — use default server (no -L flag)
  return undefined;
}

const KNOWN_SUBCOMMANDS = new Set(["add", "start", "stop", "resolve", "edit", "list", "show", "sessions", "refresh", "send", "peek", "help"]);

async function launchTui(sessionArg?: string) {
  const insideTmux = !!process.env.TMUX;
  const serverName = detectServerName();
  const sessionName = sessionArg
    ?? (insideTmux ? await detectCurrentSession(serverName) : null)
    ?? basename(process.cwd());

  if (!sessionName) {
    console.error("Could not detect tmux session. Pass session name explicitly: tukan <session>");
    process.exitCode = 1;
    return;
  }

  let lastCursor: Cursor | undefined;

  while (true) {
    const tmux = await getTmuxState(serverName, sessionName ?? undefined);

    // Load or create board config (with migration from old format)
    const existingSession = await readSessionState(sessionName);
    const rawConfig = existingSession?.board
      ? migrateConfig(existingSession.board as unknown as Record<string, unknown>)
      : defaultConfig();
    const config = reconcileConfig(rawConfig, tmux);
    const workingDir = existingSession?.workingDir ?? process.cwd();

    let attachArgs: string[] | null = null;
    const lastChangeTimes = existingSession?.lastChangeTimes ?? {};
    const activeWindows = existingSession?.activeWindows ?? [];

    // Compare current pane hashes with persisted ones to decide which
    // timestamps to keep. If a pane's content hasn't changed, the card
    // was truly idle — keep the real timestamp. If it changed (or we have
    // no prior hash), reset to now so we don't spuriously promote.
    const savedHashes = existingSession?.paneHashes ?? {};
    const now = Date.now();
    const allPaneIds: string[] = [];
    const paneToWindow = new Map<string, string>();
    for (const session of tmux.sessions) {
      for (const win of session.windows) {
        for (const pane of win.panes) {
          allPaneIds.push(pane.id);
          paneToWindow.set(pane.id, win.id);
        }
      }
    }

    let initialPaneHashes: Record<string, string> | undefined;

    if (allPaneIds.length > 0 && Object.keys(savedHashes).length > 0) {
      const freshContents = await captureAllPaneContents(serverName, allPaneIds);
      const freshHashes = computePaneHashes(freshContents);

      // Find which windows had pane changes since last save
      const changedWindows = new Set<string>();
      for (const [paneId, hash] of freshHashes) {
        const savedHash = savedHashes[paneId];
        if (savedHash !== undefined && savedHash !== hash) {
          const windowId = paneToWindow.get(paneId);
          if (windowId) changedWindows.add(windowId);
        }
      }

      // Reset timestamps for ALL windows whose panes changed (not just cards)
      for (const [windowId, _time] of Object.entries(lastChangeTimes)) {
        if (changedWindows.has(windowId)) {
          lastChangeTimes[windowId] = now;
        }
      }

      // Pass fresh hashes to App so the first poll can detect changes
      initialPaneHashes = {};
      for (const [paneId, hash] of freshHashes) {
        initialPaneHashes[paneId] = hash;
      }
    } else {
      // No saved hashes — reset all timestamps (first launch)
      for (const windowId of Object.keys(lastChangeTimes)) {
        lastChangeTimes[windowId] = now;
      }
    }

    const handleSave = (session: SessionState) => {
      writeSessionState(sessionName, session);
    };

    const { waitUntilExit } = render(
      <App
        initialTmux={tmux}
        initialConfig={config}
        initialCursor={lastCursor}
        initialLastChangeTimes={lastChangeTimes}
        initialActiveWindows={activeWindows}
        initialPaneHashes={initialPaneHashes}
        onSave={handleSave}
        onAttach={(args) => {
          attachArgs = args;
        }}
        onCursorChange={(c) => {
          lastCursor = c;
        }}
        serverName={serverName}
        sessionName={sessionName ?? undefined}
        workingDir={workingDir}
      />,
    );

    await waitUntilExit();

    if (!attachArgs) break; // normal quit

    spawnSync("tmux", attachArgs, { stdio: "inherit" });
    // Loop back — re-fetch tmux state and re-render
  }
}

async function main() {
  const args = process.argv.slice(2);

  // Route to commander for known subcommands and flags
  if (args.length > 0 && (KNOWN_SUBCOMMANDS.has(args[0]) || args[0].startsWith("-"))) {
    const program = createProgram();
    await program.parseAsync(process.argv);
    return;
  }

  // Default: launch TUI (with optional session argument)
  await launchTui(args[0]);
}

main().catch((err) => {
  console.error(err.message);
  process.exitCode = 1;
});
