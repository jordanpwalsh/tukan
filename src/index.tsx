#!/usr/bin/env node
import { render } from "ink";
import { getTmuxState } from "./tmux/client.js";
import { readState, writeState } from "./state/store.js";
import { defaultConfig } from "./board/types.js";
import { reconcileConfig } from "./board/derive.js";
import { App } from "./ui/App.js";
import type { TukanState } from "./state/types.js";
import type { BoardConfig } from "./board/types.js";

async function main() {
  const serverName = process.argv[2];

  const tmux = await getTmuxState(serverName);

  // Load or create board config
  const existingState = await readState();
  const rawConfig = existingState?.board ?? defaultConfig();
  const config = reconcileConfig(rawConfig, tmux);

  const saveConfig = (newConfig: BoardConfig) => {
    const state: TukanState = {
      version: 1,
      timestamp: new Date().toISOString(),
      tmux,
      board: newConfig,
    };
    writeState(state);
  };

  const { waitUntilExit } = render(
    <App tmux={tmux} initialConfig={config} onSave={saveConfig} />,
  );

  await waitUntilExit();
}

main().catch((err) => {
  console.error(err.message);
  process.exitCode = 1;
});
