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

async function getSocketPath(serverName: string | undefined): Promise<string> {
  const args: string[] = [];
  if (serverName) args.push("-L", serverName);
  args.push("display-message", "-p", "#{socket_path}");
  const { stdout } = await execFileAsync("tmux", args);
  return stdout.trim();
}

export async function getTmuxState(serverName?: string): Promise<TmuxServer> {
  const [socketPath, sessionsRaw, windowsRaw, panesRaw] = await Promise.all([
    getSocketPath(serverName),
    tmux(serverName, "list-sessions", [
      "#{session_id}", "#{session_name}", "#{session_attached}",
    ]),
    tmux(serverName, "list-windows", [
      "#{session_id}", "#{window_id}", "#{window_index}",
      "#{window_name}", "#{window_active}",
    ], ["-a"]),
    tmux(serverName, "list-panes", [
      "#{window_id}", "#{pane_id}", "#{pane_index}",
      "#{pane_active}", "#{pane_current_command}", "#{pane_pid}",
      "#{pane_current_path}", "#{pane_width}", "#{pane_height}",
    ], ["-a"]),
  ]);

  const sessions = parseSessions(sessionsRaw);
  const windows = parseWindows(windowsRaw);
  const panes = parsePanes(panesRaw);

  return assembleServer(socketPath, sessions, windows, panes);
}
