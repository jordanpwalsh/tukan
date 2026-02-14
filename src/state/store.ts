import { readFile, writeFile } from "node:fs/promises";
import type { TukanState } from "./types.js";

const STATE_FILE = ".tukan.state.json";

export async function writeState(state: TukanState, path = STATE_FILE): Promise<void> {
  await writeFile(path, JSON.stringify(state, null, 2) + "\n");
}

export async function readState(path = STATE_FILE): Promise<TukanState | null> {
  try {
    const data = await readFile(path, "utf-8");
    return JSON.parse(data) as TukanState;
  } catch {
    return null;
  }
}
