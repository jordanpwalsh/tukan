import type { TmuxServer } from "./types.js";

export type SwitchResult =
  | { mode: "switch"; args: string[] }
  | { mode: "attach"; args: string[] };

interface SwitchTarget {
  sessionName: string;
  windowId: string;
}

interface SwitchEnv {
  TMUX?: string;
  [key: string]: string | undefined;
}

export function resolveSwitchArgs(
  target: SwitchTarget,
  server: TmuxServer,
  env: SwitchEnv,
): SwitchResult {
  const tmuxTarget = `${target.sessionName}:${target.windowId}`;
  const serverArgs = server.serverName ? ["-L", server.serverName] : [];

  if (env.TMUX && server.serverName) {
    // TMUX env var format: /path/to/socket,pid,session_index
    // The basename of the socket path is the server name
    const socketPath = env.TMUX.split(",")[0];
    const envServerName = socketPath.substring(socketPath.lastIndexOf("/") + 1);

    if (envServerName === server.serverName) {
      // Same server — switch the existing client
      return {
        mode: "switch",
        args: [...serverArgs, "switch-client", "-t", tmuxTarget],
      };
    }
  }

  // Outside tmux, or on a different server — attach
  return {
    mode: "attach",
    args: [...serverArgs, "attach-session", "-t", tmuxTarget],
  };
}
