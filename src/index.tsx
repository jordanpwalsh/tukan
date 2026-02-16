#!/usr/bin/env node
import { render } from "ink";
import { execFile, spawnSync } from "node:child_process";
import { basename } from "node:path";
import { promisify } from "node:util";
import { getTmuxState, detectCurrentSession } from "./tmux/client.js";
import { readSessionState, writeSessionState, migrateConfig } from "./state/store.js";
import { defaultConfig, COL_IN_PROGRESS } from "./board/types.js";
import { reconcileConfig } from "./board/derive.js";
import { App } from "./ui/App.js";
import type { Cursor } from "./board/types.js";
import type { SessionState } from "./state/types.js";

function detectServerName(): string | undefined {
  const tmuxEnv = process.env.TMUX;
  if (tmuxEnv) {
    // Inside tmux — use the current server
    const socketPath = tmuxEnv.split(",")[0];
    return socketPath.substring(socketPath.lastIndexOf("/") + 1);
  }
  // Outside tmux — use default server (no -L flag)
  return undefined;
}

function printUsage() {
  console.log(`tukan - kanban board for tmux windows

Usage: tukan [session]
       tukan ls

Commands:
  ls             list tmux sessions available to connect to

Arguments:
  session        tmux session name to manage (auto-detected if inside tmux)

Keybindings:
  ←→             navigate columns
  ↑↓             navigate cards
  h/l            move card between columns
  s              start card (create window, move to in-progress, switch)
  Enter          switch to window (real) / edit card (virtual)
  n              create new card
  e              edit card
  r              remove card / kill window
  q              quit`);
}

const execFileAsync = promisify(execFile);

async function listSessions(serverName: string | undefined): Promise<void> {
  try {
    const args: string[] = [];
    if (serverName) args.push("-L", serverName);
    args.push("list-sessions", "-F", "#{session_name}\t#{session_windows}\t#{session_attached}");
    const { stdout } = await execFileAsync("tmux", args);
    const lines = stdout.trim().split("\n").filter(Boolean);
    if (lines.length === 0) {
      console.log("No tmux sessions found.");
      return;
    }
    console.log("tmux sessions:");
    for (const line of lines) {
      const [name, windows, attached] = line.split("\t");
      const attachedLabel = attached === "1" ? " (attached)" : "";
      console.log(`  ${name}  ${windows} window${windows === "1" ? "" : "s"}${attachedLabel}`);
    }
  } catch {
    console.log("No tmux server running.");
  }
}

async function main() {
  const args = process.argv.slice(2);

  if (args.includes("--help") || args.includes("-h")) {
    printUsage();
    return;
  }

  if (args[0] === "ls") {
    const serverName = detectServerName();
    await listSessions(serverName);
    return;
  }

  const insideTmux = !!process.env.TMUX;
  const serverName = detectServerName();
  const sessionName = args[0]
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

    // Reset lastChangeTimes to now on re-entry so stale timestamps
    // from before the user left don't immediately trigger idle promotion
    const now = Date.now();
    for (const card of Object.values(config.cards)) {
      if (card.columnId === COL_IN_PROGRESS && card.windowId && lastChangeTimes[card.windowId] !== undefined) {
        lastChangeTimes[card.windowId] = now;
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

main().catch((err) => {
  console.error(err.message);
  process.exitCode = 1;
});
