import type { TmuxPane, TmuxWindow, TmuxSession } from "./types.js";

const FIELD_SEP = "\t";

export function parseSessions(output: string): TmuxSession[] {
  if (!output.trim()) return [];
  return output.trim().split("\n").map(parseSessionLine);
}

// Format: $id\tname\tattached
function parseSessionLine(line: string): TmuxSession {
  const [id, name, attached] = line.split(FIELD_SEP);
  return {
    id,
    name,
    attached: attached === "1",
    windows: [],
  };
}

export function parseWindows(output: string): (TmuxWindow & { sessionId: string })[] {
  if (!output.trim()) return [];
  return output.trim().split("\n").map(parseWindowLine);
}

// Format: sessionId\t@id\tindex\tname\tactive
function parseWindowLine(line: string): TmuxWindow & { sessionId: string } {
  const [sessionId, id, index, name, active] = line.split(FIELD_SEP);
  return {
    sessionId,
    id,
    index: Number(index),
    name,
    active: active === "1",
    panes: [],
  };
}

export function parsePanes(output: string): (TmuxPane & { windowId: string })[] {
  if (!output.trim()) return [];
  return output.trim().split("\n").map(parsePaneLine);
}

// Format: windowId\t%id\tindex\tactive\tcommand\tpid\tworkingDir\twidth\theight
function parsePaneLine(line: string): TmuxPane & { windowId: string } {
  const [windowId, id, index, active, command, pid, workingDir, width, height] =
    line.split(FIELD_SEP);
  return {
    windowId,
    id,
    index: Number(index),
    active: active === "1",
    command,
    pid: Number(pid),
    workingDir,
    width: Number(width),
    height: Number(height),
  };
}

export function assembleServer(
  socketPath: string,
  sessions: TmuxSession[],
  windows: (TmuxWindow & { sessionId: string })[],
  panes: (TmuxPane & { windowId: string })[],
) {
  const panesByWindow = new Map<string, TmuxPane[]>();
  for (const { windowId, ...pane } of panes) {
    const list = panesByWindow.get(windowId) ?? [];
    list.push(pane);
    panesByWindow.set(windowId, list);
  }

  const windowsBySession = new Map<string, TmuxWindow[]>();
  for (const { sessionId, ...window } of windows) {
    const win: TmuxWindow = { ...window, panes: panesByWindow.get(window.id) ?? [] };
    const list = windowsBySession.get(sessionId) ?? [];
    list.push(win);
    windowsBySession.set(sessionId, list);
  }

  for (const session of sessions) {
    session.windows = windowsBySession.get(session.id) ?? [];
  }

  return { socketPath, sessions };
}
