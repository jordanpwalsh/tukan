import type { BoardConfig } from "../board/types.js";

/** Ephemeral runtime state stored in ~/.config/tukan/sessions/{sessionName}.json */
export interface EphemeralState {
  lastChangeTimes?: Record<string, number>; // windowId → epoch ms
  activeWindows?: string[]; // windowIds with unseen activity
  paneHashes?: Record<string, string>; // paneId → content hash
}

/** Registry entry mapping session name to project directory */
export interface RegistryEntry {
  projectDir: string;
}

/** Full registry: ~/.config/tukan/registry.json */
export type Registry = Record<string, RegistryEntry>;

/** Combined view used by callers (loadContext, handleSave). */
export interface SessionState {
  board: BoardConfig;
  workingDir: string;
  lastChangeTimes?: Record<string, number>; // windowId → epoch ms
  activeWindows?: string[]; // windowIds with unseen activity
  paneHashes?: Record<string, string>; // paneId → content hash
}

