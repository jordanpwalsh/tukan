import type { TmuxServer } from "../tmux/types.js";

export interface TukanState {
  version: 1;
  timestamp: string;
  tmux: TmuxServer;
}
