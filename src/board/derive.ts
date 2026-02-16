import type { TmuxServer } from "../tmux/types.js";
import type { BoardConfig, BoardCard, BoardColumn, Card } from "./types.js";
import { COL_UNASSIGNED } from "./types.js";
import type { ActivityMap } from "./activity.js";

export function deriveBoard(
  server: TmuxServer,
  config: BoardConfig,
  selfPaneId?: string,
  activityMap?: ActivityMap,
): BoardColumn[] {
  // Build windowId → Card index
  const windowToCard = new Map<string, Card>();
  for (const card of Object.values(config.cards)) {
    if (card.windowId) {
      windowToCard.set(card.windowId, card);
    }
  }

  const boardCards: BoardCard[] = [];
  const seenCardIds = new Set<string>();

  // Process live tmux windows
  for (const session of server.sessions) {
    for (const win of session.windows) {
      // Skip the window tukan is running in
      if (selfPaneId && win.panes.some((p) => p.id === selfPaneId)) continue;

      const firstPane = win.panes[0];
      const activity = activityMap?.get(win.id);
      const now = Date.now();

      const card = windowToCard.get(win.id);
      if (card) {
        // Window owned by a card — use card data
        seenCardIds.add(card.id);
        boardCards.push({
          cardId: card.id,
          windowId: win.id,
          displayId: card.id.slice(0, 8) + " " + win.id.replace("@", "#"),
          sessionName: session.name,
          name: card.name,
          command: card.command,
          workingDir: firstPane?.workingDir ?? card.dir,
          active: win.active,
          started: true,
          closed: false,
          uncategorized: false,
          hasActivity: activity?.hasActivity ?? false,
          spinning: activity?.spinning ?? false,
          idleTime: activity?.lastChangeTime != null ? Math.floor((now - activity.lastChangeTime) / 1000) : null,
        });
      } else {
        // Uncategorized window — no card record
        boardCards.push({
          cardId: win.id, // use windowId as temporary cardId for uncategorized
          windowId: win.id,
          displayId: win.id.replace("@", "#"),
          sessionName: session.name,
          name: win.name,
          command: firstPane?.command ?? "",
          workingDir: firstPane?.workingDir ?? "",
          active: win.active,
          started: false,
          closed: false,
          uncategorized: true,
          hasActivity: activity?.hasActivity ?? false,
          spinning: activity?.spinning ?? false,
          idleTime: activity?.lastChangeTime != null ? Math.floor((now - activity.lastChangeTime) / 1000) : null,
        });
      }
    }
  }

  // Add unstarted and closed cards from config
  for (const card of Object.values(config.cards)) {
    if (seenCardIds.has(card.id)) continue;
    boardCards.push({
      cardId: card.id,
      windowId: null,
      displayId: card.id.slice(0, 8),
      sessionName: card.sessionName,
      name: card.name,
      command: card.command,
      workingDir: card.dir,
      active: false,
      started: false,
      closed: !!card.startedAt,
      uncategorized: false,
      hasActivity: false,
      spinning: false,
      idleTime: null,
    });
  }

  // Distribute cards into columns
  const defaultColumnId = config.columns[0]?.id;

  const columnMap = new Map<string, BoardCard[]>();
  for (const col of config.columns) {
    columnMap.set(col.id, []);
  }

  for (const bc of boardCards) {
    let colId: string;
    if (bc.uncategorized) {
      colId = COL_UNASSIGNED;
    } else {
      const card = config.cards[bc.cardId];
      colId = card?.columnId ?? defaultColumnId;
    }

    const bucket = columnMap.get(colId);
    if (bucket) {
      bucket.push(bc);
    } else {
      columnMap.get(defaultColumnId)?.push(bc);
    }
  }

  return config.columns.map((col) => ({
    id: col.id,
    title: col.title,
    cards: (columnMap.get(col.id) ?? []).reverse(),
  }));
}

export function reconcileConfig(
  config: BoardConfig,
  server: TmuxServer,
): BoardConfig {
  const windowNames = new Map<string, string>();
  for (const session of server.sessions) {
    for (const win of session.windows) {
      windowNames.set(win.id, win.name);
    }
  }

  let changed = false;
  const cards = { ...config.cards };

  for (const [cardId, card] of Object.entries(cards)) {
    if (card.windowId) {
      if (!windowNames.has(card.windowId)) {
        // Window gone — mark as closed
        if (!card.closedAt) {
          cards[cardId] = { ...card, closedAt: Date.now() };
          changed = true;
        }
      } else {
        // Window reappeared — clear closedAt
        if (card.closedAt) {
          cards[cardId] = { ...card, closedAt: undefined };
          changed = true;
        }
        // Update name from tmux if card still has a placeholder windowId name
        const winName = windowNames.get(card.windowId)!;
        if (card.name.startsWith("@") && winName) {
          cards[cardId] = { ...(cards[cardId] ?? card), name: winName };
          changed = true;
        }
      }
    }
  }

  if (!changed) return config;

  return { ...config, cards };
}
