#!/usr/bin/env node
import { getTmuxState } from "./tmux/client.js";
import { writeState } from "./state/store.js";
import type { TukanState } from "./state/types.js";

async function main() {
  const serverName = process.argv[2];

  const tmux = await getTmuxState(serverName);

  const state: TukanState = {
    version: 1,
    timestamp: new Date().toISOString(),
    tmux,
  };

  await writeState(state);

  const sessionCount = tmux.sessions.length;
  const windowCount = tmux.sessions.reduce((n, s) => n + s.windows.length, 0);
  const paneCount = tmux.sessions.reduce(
    (n, s) => n + s.windows.reduce((m, w) => m + w.panes.length, 0),
    0,
  );

  console.log(
    `Cached tmux state: ${sessionCount} session(s), ${windowCount} window(s), ${paneCount} pane(s)`,
  );
  console.log(`Socket: ${tmux.socketPath}`);
  console.log(`Written to .tukan.state.json`);
}

main().catch((err) => {
  console.error(err.message);
  process.exitCode = 1;
});
