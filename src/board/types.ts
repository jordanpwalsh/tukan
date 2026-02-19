export interface CommandDef {
  id: string;       // stable key, e.g. "shell", "claude"
  label: string;    // display name
  template: string; // shell command ("" = default shell)
}

export const DEFAULT_COMMANDS: CommandDef[] = [
  { id: "shell", label: "Shell", template: "" },
  { id: "claude", label: "Claude Code", template: "claude" },
];

export interface Card {
  id: string;                    // UUID, stable forever
  name: string;
  description: string;
  acceptanceCriteria: string;
  columnId: string;
  sessionName: string;
  dir: string;
  command: string;               // references CommandDef.id
  customCommand?: string;        // backward compat for old "custom" commands
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
  commands: CommandDef[];
  idleTimeoutMs?: number;       // idle threshold for --wait --json (default 3000)
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
  colScroll?: number;
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
    commands: DEFAULT_COMMANDS,
    idleTimeoutMs: 3000,
  };
}
