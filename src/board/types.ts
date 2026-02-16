export interface Card {
  id: string;                    // UUID, stable forever
  name: string;
  description: string;
  acceptanceCriteria: string;
  columnId: string;
  sessionName: string;
  dir: string;
  command: "shell" | "claude" | "custom";
  customCommand?: string;
  worktree: boolean;
  worktreePath?: string;
  windowId?: string;             // set when tmux window is linked
  createdAt: number;
  startedAt?: number;
  closedAt?: number;
}

export interface BoardConfig {
  columns: Array<{ id: string; title: string }>;
  cards: Record<string, Card>;  // cardId → Card
}

export interface BoardCard {
  cardId: string;
  windowId: string | null;
  displayId: string;
  sessionName: string;
  name: string;
  command: string;
  workingDir: string;
  active: boolean;
  started: boolean;        // has windowId
  closed: boolean;         // had window, now gone
  uncategorized: boolean;  // tmux window with no card record
  hasActivity: boolean;
  spinning: boolean;
  idleTime: number | null;
}

export interface BoardColumn {
  id: string;
  title: string;
  cards: BoardCard[];
}

export interface Cursor {
  col: number;
  row: number;
}

// Stable column IDs (decoupled from display titles)
export const COL_UNASSIGNED = "0";
export const COL_TODO = "1";
export const COL_IN_PROGRESS = "2";
export const COL_REVIEW = "3";
export const COL_DONE = "4";

export function defaultConfig(): BoardConfig {
  return {
    columns: [
      { id: COL_UNASSIGNED, title: "Unassigned" },
      { id: COL_TODO, title: "Todo" },
      { id: COL_IN_PROGRESS, title: "In Progress" },
      { id: COL_REVIEW, title: "Review" },
      { id: COL_DONE, title: "Done" },
    ],
    cards: {},
  };
}
