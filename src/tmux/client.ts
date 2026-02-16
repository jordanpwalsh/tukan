import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { TmuxServer } from "./types.js";
import { parseSessions, parseWindows, parsePanes, assembleServer } from "./parse.js";

const execFileAsync = promisify(execFile);

function tmuxArgs(serverName: string | undefined, subcommand: string, formatFields: string[], extra: string[] = []): string[] {
  const format = formatFields.join("\t");
  const args: string[] = [];
  if (serverName) args.push("-L", serverName);
  args.push(subcommand, ...extra, "-F", format);
  return args;
}

async function tmux(serverName: string | undefined, subcommand: string, formatFields: string[], extra: string[] = []): Promise<string> {
  const args = tmuxArgs(serverName, subcommand, formatFields, extra);
  const { stdout } = await execFileAsync("tmux", args);
  return stdout;
}

export async function execTmuxCommand(args: string[]): Promise<void> {
  await execFileAsync("tmux", args);
}

export async function execTmuxCommandWithOutput(args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("tmux", args);
  return stdout.trim();
}

export async function detectCurrentSession(serverName?: string): Promise<string | null> {
  const paneId = process.env.TMUX_PANE;
  if (!paneId) return null;
  try {
    const args: string[] = [];
    if (serverName) args.push("-L", serverName);
    args.push("display-message", "-t", paneId, "-p", "#{session_name}");
    const { stdout } = await execFileAsync("tmux", args);
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

export async function captureAllPaneContents(
  serverName: string | undefined,
  paneIds: string[],
): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  const captures = paneIds.map(async (paneId) => {
    try {
      const args: string[] = [];
      if (serverName) args.push("-L", serverName);
      args.push("capture-pane", "-p", "-t", paneId);
      const { stdout } = await execFileAsync("tmux", args);
      result.set(paneId, stdout);
    } catch {
      // Pane may have been destroyed
    }
  });
  await Promise.all(captures);
  return result;
}

export async function getTmuxState(serverName?: string, sessionName?: string): Promise<TmuxServer> {
  try {
    // If scoped to a session, only list its windows/panes
    // list-panes needs -s (session mode) to get panes across all windows
    const windowTarget = sessionName ? ["-t", sessionName] : ["-a"];
    const paneTarget = sessionName ? ["-s", "-t", sessionName] : ["-a"];

    const [sessionsRaw, windowsRaw, panesRaw] = await Promise.all([
      tmux(serverName, "list-sessions", [
        "#{session_id}", "#{session_name}", "#{session_attached}",
      ]),
      tmux(serverName, "list-windows", [
        "#{session_id}", "#{window_id}", "#{window_index}",
        "#{window_name}", "#{window_active}",
      ], windowTarget),
      tmux(serverName, "list-panes", [
        "#{window_id}", "#{pane_id}", "#{pane_index}",
        "#{pane_active}", "#{pane_current_command}", "#{pane_pid}",
        "#{pane_current_path}", "#{pane_width}", "#{pane_height}",
      ], paneTarget),
    ]);

    const sessions = parseSessions(sessionsRaw);
    const windows = parseWindows(windowsRaw);
    const panes = parsePanes(panesRaw);

    const server = assembleServer(serverName ?? "", sessions, windows, panes);

    // Filter to just the target session if specified
    if (sessionName) {
      server.sessions = server.sessions.filter((s) => s.name === sessionName);
    }

    return server;
  } catch {
    return { serverName: serverName ?? "", sessions: [] };
  }
}
