export interface TmuxPane {
  id: string;
  index: number;
  active: boolean;
  command: string;
  pid: number;
  workingDir: string;
  width: number;
  height: number;
}

export interface TmuxWindow {
  id: string;
  index: number;
  name: string;
  active: boolean;
  panes: TmuxPane[];
}

export interface TmuxSession {
  id: string;
  name: string;
  attached: boolean;
  windows: TmuxWindow[];
}

export interface TmuxServer {
  serverName: string;
  sessions: TmuxSession[];
}
