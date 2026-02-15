export interface BoardConfig {
  columns: Array<{ id: string; title: string }>;
  assignments: Record<string, string>; // windowId → columnId
}

export interface BoardCard {
  windowId: string;
  sessionName: string;
  name: string;
  command: string;
  workingDir: string;
  active: boolean;
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

export function defaultConfig(): BoardConfig {
  return {
    columns: [
      { id: "new", title: "New" },
      { id: "todo", title: "Todo" },
      { id: "in-progress", title: "In Progress" },
      { id: "review", title: "Review" },
      { id: "done", title: "Done" },
    ],
    assignments: {},
  };
}
