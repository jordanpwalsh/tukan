import type { TmuxServer } from "../tmux/types.js";
import type { BoardConfig, BoardCard, BoardColumn } from "./types.js";

export function deriveBoard(
  server: TmuxServer,
  config: BoardConfig,
): BoardColumn[] {
  const cards: BoardCard[] = [];

  for (const session of server.sessions) {
    for (const win of session.windows) {
      const firstPane = win.panes[0];
      cards.push({
        windowId: win.id,
        sessionName: session.name,
        name: win.name,
        command: firstPane?.command ?? "",
        workingDir: firstPane?.workingDir ?? "",
        active: win.active,
      });
    }
  }

  const defaultColumnId = config.columns[0]?.id;

  const columnMap = new Map<string, BoardCard[]>();
  for (const col of config.columns) {
    columnMap.set(col.id, []);
  }

  for (const card of cards) {
    const assignedCol = config.assignments[card.windowId] ?? defaultColumnId;
    const bucket = columnMap.get(assignedCol);
    if (bucket) {
      bucket.push(card);
    } else {
      // Invalid assignment — fall back to first column
      columnMap.get(defaultColumnId)?.push(card);
    }
  }

  return config.columns.map((col) => ({
    id: col.id,
    title: col.title,
    cards: columnMap.get(col.id) ?? [],
  }));
}

export function reconcileConfig(
  config: BoardConfig,
  server: TmuxServer,
): BoardConfig {
  const existingWindowIds = new Set<string>();
  for (const session of server.sessions) {
    for (const win of session.windows) {
      existingWindowIds.add(win.id);
    }
  }

  const assignments: Record<string, string> = {};
  for (const [windowId, columnId] of Object.entries(config.assignments)) {
    if (existingWindowIds.has(windowId)) {
      assignments[windowId] = columnId;
    }
  }

  return { ...config, assignments };
}
