import type { TmuxServer } from "../tmux/types.js";
import type { BoardConfig } from "../board/types.js";

export interface TukanState {
  version: 1;
  timestamp: string;
  tmux: TmuxServer;
  board: BoardConfig;
}
