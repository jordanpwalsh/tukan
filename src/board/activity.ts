import { createHash } from "node:crypto";
import { COL_IN_PROGRESS } from "./types.js";
import type { Card } from "./types.js";

export interface ActivityEntry {
  hasActivity: boolean;
  lastChangeTime: number;
  spinning: boolean;
}

export type ActivityMap = Map<string, ActivityEntry>;
export type PaneHashMap = Map<string, string>;

export function hashContent(content: string): string {
  return createHash("sha1").update(content).digest("hex");
}

export function computePaneHashes(paneContents: Map<string, string>): PaneHashMap {
  const result: PaneHashMap = new Map();
  for (const [paneId, content] of paneContents) {
    result.set(paneId, hashContent(content));
  }
  return result;
}

export function detectChangedPanes(prev: PaneHashMap, next: PaneHashMap): Set<string> {
  const changed = new Set<string>();
  for (const [paneId, hash] of next) {
    const prevHash = prev.get(paneId);
    if (prevHash !== undefined && prevHash !== hash) {
      changed.add(paneId);
    }
  }
  return changed;
}

/**
 * Build a per-window activity map from changed pane IDs.
 * @param changedPanes - pane IDs whose content changed this poll
 * @param paneToWindow - mapping from pane ID to window ID
 * @param activeWindowId - the window the user is currently viewing (activity cleared)
 * @param prevActivity - previous activity map
 * @param now - current timestamp (ms)
 */
export const IDLE_PROMOTE_MS = 2 * 60 * 1000;

/**
 * Return card IDs in "in-progress" whose windowId has a lastChangeTime
 * older than thresholdMs — these should be promoted to "review".
 */
export function getIdlePromotions(
  cards: Record<string, Card>,
  lastChangeTimes: Record<string, number>,
  now: number,
  thresholdMs: number,
): string[] {
  const result: string[] = [];
  for (const [cardId, card] of Object.entries(cards)) {
    if (card.columnId !== COL_IN_PROGRESS) continue;
    if (!card.windowId) continue;
    const lastChange = lastChangeTimes[card.windowId];
    if (lastChange !== undefined && now - lastChange >= thresholdMs) {
      result.push(cardId);
    }
  }
  return result;
}

export function buildActivityMap(
  changedPanes: Set<string>,
  paneToWindow: Map<string, string>,
  activeWindowId: string | null,
  prevActivity: ActivityMap,
  now: number,
): ActivityMap {
  // Collect which windows had pane changes
  const changedWindows = new Set<string>();
  for (const paneId of changedPanes) {
    const windowId = paneToWindow.get(paneId);
    if (windowId) changedWindows.add(windowId);
  }

  const result: ActivityMap = new Map();

  // Carry forward all previous entries
  for (const [windowId, entry] of prevActivity) {
    result.set(windowId, { ...entry, spinning: false });
  }

  // Initialize entries for newly observed windows (first poll baseline)
  const allWindows = new Set(paneToWindow.values());
  for (const windowId of allWindows) {
    if (!result.has(windowId)) {
      result.set(windowId, { hasActivity: false, lastChangeTime: now, spinning: false });
    }
  }

  // Update windows with changes
  for (const windowId of changedWindows) {
    result.set(windowId, {
      hasActivity: true,
      lastChangeTime: now,
      spinning: true,
    });
  }

  // Clear activity for the currently active window
  if (activeWindowId) {
    const entry = result.get(activeWindowId);
    if (entry) {
      result.set(activeWindowId, { ...entry, hasActivity: false, spinning: false });
    }
  }

  return result;
}
