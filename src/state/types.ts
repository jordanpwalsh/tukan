import type { BoardConfig } from "../board/types.js";

export interface SessionState {
  board: BoardConfig;
  workingDir: string;
  lastChangeTimes?: Record<string, number>; // windowId → epoch ms
  activeWindows?: string[]; // windowIds with unseen activity
}

export interface TukanState {
  version: 1;
  sessions: Record<string, SessionState>;
}
