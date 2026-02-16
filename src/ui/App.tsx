import { useState, useMemo, useCallback, useRef, useEffect } from "react";
import { Box, Text, useApp, useInput } from "ink";
import { Board } from "./Board.js";
import { StatusBar } from "./StatusBar.js";
import { NewCardModal } from "./NewCardModal.js";
import { QuickShellModal } from "./QuickShellModal.js";
import type { FormValues } from "./NewCardModal.js";
import { useTerminalSize } from "./hooks/useTerminalSize.js";
import { deriveBoard } from "../board/derive.js";
import { moveLeft, moveRight, moveUp, moveDown, moveCard } from "../board/navigation.js";
import { resolveSwitchArgs } from "../tmux/switch.js";
import { buildNewWindowArgs, buildNewSessionArgs, buildWorktreeArgs, sanitizeBranchName } from "../tmux/create.js";
import { execTmuxCommand, execTmuxCommandWithOutput, getTmuxState, captureAllPaneContents } from "../tmux/client.js";
import { computePaneHashes, detectChangedPanes, buildActivityMap, getIdlePromotions, IDLE_PROMOTE_MS } from "../board/activity.js";
import type { ActivityMap, PaneHashMap } from "../board/activity.js";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
import { randomUUID } from "node:crypto";
import type { TmuxServer } from "../tmux/types.js";
import type { SessionState } from "../state/types.js";
import { COL_UNASSIGNED, COL_TODO, COL_IN_PROGRESS, COL_REVIEW, COL_DONE, type BoardConfig, type BoardCard, type Card, type Cursor } from "../board/types.js";

type ModalState =
  | null
  | { mode: "create" }
  | { mode: "confirm-resolve"; card: BoardCard }
  | { mode: "confirm-start"; card: BoardCard }
  | { mode: "start"; card: BoardCard }
  | { mode: "edit"; card: BoardCard }
  | { mode: "quick-shell" };

interface AppProps {
  initialTmux: TmuxServer;
  initialConfig: BoardConfig;
  initialCursor?: Cursor;
  initialLastChangeTimes?: Record<string, number>;
  initialActiveWindows?: string[];
  onSave: (session: SessionState) => void;
  onAttach: (args: string[]) => void;
  onCursorChange?: (cursor: Cursor) => void;
  serverName?: string;
  sessionName?: string;
  workingDir: string;
}

export function App({ initialTmux, initialConfig, initialCursor, initialLastChangeTimes, initialActiveWindows, onSave, onAttach, onCursorChange, serverName, sessionName, workingDir }: AppProps) {
  const { exit } = useApp();
  const { width, height } = useTerminalSize();
  const [config, setConfig] = useState(initialConfig);
  const [cursor, rawSetCursor] = useState<Cursor>(initialCursor ?? { col: 0, row: 0 });

  const setCursor = useCallback((update: Cursor | ((prev: Cursor) => Cursor)) => {
    rawSetCursor((prev) => {
      const next = typeof update === "function" ? update(prev) : update;
      onCursorChange?.(next);
      return next;
    });
  }, [onCursorChange]);
  const [tmux, setTmux] = useState(initialTmux);
  const [modal, setModal] = useState<ModalState>(null);
  const [paneHashes, setPaneHashes] = useState<PaneHashMap>(new Map());
  const [activity, setActivity] = useState<ActivityMap>(() => {
    // Seed from persisted lastChangeTimes + activeWindows
    const map: ActivityMap = new Map();
    if (initialLastChangeTimes) {
      const activeWindowIds = new Set(initialActiveWindows ?? []);
      for (const [windowId, time] of Object.entries(initialLastChangeTimes)) {
        map.set(windowId, { hasActivity: activeWindowIds.has(windowId), lastChangeTime: time, spinning: false });
      }
    }
    return map;
  });

  // Keep a ref to always access latest config, avoiding stale closures
  const configRef = useRef(config);
  configRef.current = config;

  const selfPaneId = process.env.TMUX_PANE;

  // Activity detection: capture pane contents every 3s, hash & compare
  const paneHashesRef = useRef(paneHashes);
  paneHashesRef.current = paneHashes;
  const activityRef = useRef(activity);
  activityRef.current = activity;
  const tmuxRef = useRef(tmux);
  tmuxRef.current = tmux;

  /** Build full SessionState from current refs and save */
  const saveState = useCallback((cfg: BoardConfig) => {
    const times: Record<string, number> = {};
    const activeWins: string[] = [];
    for (const [windowId, entry] of activityRef.current) {
      times[windowId] = entry.lastChangeTime;
      if (entry.hasActivity) activeWins.push(windowId);
    }
    onSave({ board: cfg, workingDir, lastChangeTimes: times, activeWindows: activeWins });
  }, [onSave, workingDir]);

  // Poll tmux state every second
  useEffect(() => {
    const interval = setInterval(() => {
      getTmuxState(serverName, sessionName).then((t) => setTmux(t));
    }, 1000);
    return () => clearInterval(interval);
  }, [serverName, sessionName]);

  useEffect(() => {
    const poll = async () => {
      const currentTmux = tmuxRef.current;
      // Collect all pane IDs and build paneId→windowId map
      const paneIds: string[] = [];
      const paneToWindow = new Map<string, string>();

      // Find which session tukan is in, so we only clear activity
      // for the active window in tukan's session (not other sessions)
      let tukanSessionId: string | null = null;
      if (selfPaneId) {
        for (const session of currentTmux.sessions) {
          if (session.windows.some((w) => w.panes.some((p) => p.id === selfPaneId))) {
            tukanSessionId = session.id;
            break;
          }
        }
      }

      let activeWindowId: string | null = null;
      for (const session of currentTmux.sessions) {
        for (const win of session.windows) {
          if (selfPaneId && win.panes.some((p) => p.id === selfPaneId)) continue;
          // Only track the active window in tukan's own session
          if (win.active && session.id === tukanSessionId) activeWindowId = win.id;
          for (const pane of win.panes) {
            paneIds.push(pane.id);
            paneToWindow.set(pane.id, win.id);
          }
        }
      }
      if (paneIds.length === 0) return;

      const contents = await captureAllPaneContents(serverName, paneIds);
      const nextHashes = computePaneHashes(contents);
      const changed = detectChangedPanes(paneHashesRef.current, nextHashes);
      const nextActivity = buildActivityMap(
        changed, paneToWindow, activeWindowId, activityRef.current, Date.now(),
      );

      setPaneHashes(nextHashes);
      setActivity(nextActivity);

      // Persist on activity change
      if (changed.size > 0) {
        saveState(configRef.current);
      }

      // Auto-promote idle in-progress cards to review
      const changeTimes: Record<string, number> = {};
      for (const [windowId, entry] of nextActivity) {
        changeTimes[windowId] = entry.lastChangeTime;
      }
      const cfg = configRef.current;
      const idlePromotions = getIdlePromotions(cfg.cards, changeTimes, Date.now(), IDLE_PROMOTE_MS);
      if (idlePromotions.length > 0) {
        const newCards = { ...cfg.cards };
        for (const cardId of idlePromotions) {
          newCards[cardId] = { ...newCards[cardId], columnId: COL_REVIEW };
        }
        const newConfig: BoardConfig = { ...cfg, cards: newCards };
        setConfig(newConfig);
        saveState(newConfig);
      }
    };

    const interval = setInterval(poll, 3000);
    // Run once immediately
    poll();
    return () => clearInterval(interval);
  }, [serverName, selfPaneId, saveState]);

  const columns = useMemo(() => deriveBoard(tmux, config, selfPaneId, activity), [tmux, config, selfPaneId, activity]);

  const updateConfig = useCallback(
    (newConfig: BoardConfig) => {
      setConfig(newConfig);
      saveState(newConfig);
    },
    [saveState],
  );

  /** Find the Card record for a BoardCard, or null for uncategorized */
  const findCard = useCallback((bc: BoardCard): Card | null => {
    if (bc.uncategorized) return null;
    return configRef.current.cards[bc.cardId] ?? null;
  }, []);

  useInput(
    (input, key) => {
      if (input === "q") {
        exit();
        return;
      }

      if (input === "n") {
        setModal({ mode: "create" });
        return;
      }

      if (input === "C") {
        setModal({ mode: "quick-shell" });
        return;
      }

      if (input === "s") {
        const bc = columns[cursor.col]?.cards[cursor.row];
        if (!bc) return;

        if (!bc.windowId && !bc.uncategorized) {
          // Unstarted or closed card — (re)start it
          const card = findCard(bc);
          if (card) startCard(card);
          return;
        }

        if (bc.uncategorized || bc.windowId) {
          // Live window: move to in-progress + switch
          const cfg = configRef.current;
          let newConfig: BoardConfig;

          if (bc.uncategorized) {
            // Auto-create a Card record
            const id = randomUUID();
            const newCard: Card = {
              id,
              name: bc.name,
              description: "",
              acceptanceCriteria: "",
              columnId: COL_IN_PROGRESS,
              sessionName: bc.sessionName,
              dir: bc.workingDir,
              command: "shell",
              worktree: false,
              windowId: bc.windowId!,
              createdAt: Date.now(),
              startedAt: Date.now(),
            };
            newConfig = { ...cfg, cards: { ...cfg.cards, [id]: newCard } };
          } else {
            const card = cfg.cards[bc.cardId];
            newConfig = {
              ...cfg,
              cards: { ...cfg.cards, [bc.cardId]: { ...card, columnId: COL_IN_PROGRESS } },
            };
          }
          updateConfig(newConfig);

          const result = resolveSwitchArgs(
            { sessionName: bc.sessionName, windowId: bc.windowId! },
            tmux,
            process.env,
          );
          if (result.mode === "switch") {
            execTmuxCommand(result.args);
          } else if (result.mode === "attach") {
            onAttach(result.args);
            exit();
          }
        }
        return;
      }

      if (key.return) {
        const bc = columns[cursor.col]?.cards[cursor.row];
        if (!bc) return;

        if (!bc.windowId && !bc.uncategorized) {
          // Unstarted or closed card — confirm (re)start
          setModal({ mode: "confirm-start", card: bc });
        } else if (bc.windowId) {
          // Has a live window — switch to it
          const result = resolveSwitchArgs(
            { sessionName: bc.sessionName, windowId: bc.windowId },
            tmux,
            process.env,
          );
          if (result.mode === "switch") {
            execTmuxCommand(result.args);
          } else if (result.mode === "attach") {
            onAttach(result.args);
            exit();
          }
        }
        return;
      }

      if (key.leftArrow) {
        setCursor((c) => moveLeft(c, columns));
      } else if (key.rightArrow) {
        setCursor((c) => moveRight(c, columns));
      } else if (key.upArrow) {
        setCursor((c) => moveUp(c));
      } else if (key.downArrow) {
        setCursor((c) => moveDown(c, columns));
      } else if (input === "h") {
        const result = moveCard(configRef.current, columns, cursor, "left", randomUUID);
        if (result) {
          updateConfig(result.config);
          setCursor(result.cursor);
        }
      } else if (input === "l") {
        const result = moveCard(configRef.current, columns, cursor, "right", randomUUID);
        if (result) {
          updateConfig(result.config);
          setCursor(result.cursor);
        }
      } else if (input === "e") {
        const bc = columns[cursor.col]?.cards[cursor.row];
        if (!bc) return;

        if (bc.uncategorized) {
          // Auto-create card + open edit modal
          const cfg = configRef.current;
          const id = randomUUID();
          const newCard: Card = {
            id,
            name: bc.name,
            description: "",
            acceptanceCriteria: "",
            columnId: COL_UNASSIGNED,
            sessionName: bc.sessionName,
            dir: bc.workingDir,
            command: "shell",
            worktree: false,
            windowId: bc.windowId!,
            createdAt: Date.now(),
            startedAt: Date.now(),
          };
          const newConfig = { ...cfg, cards: { ...cfg.cards, [id]: newCard } };
          updateConfig(newConfig);
          // Create a new BoardCard view for the modal
          setModal({ mode: "edit", card: { ...bc, cardId: id, uncategorized: false, started: true } });
        } else {
          setModal({ mode: "edit", card: bc });
        }
      } else if (input === "r") {
        const bc = columns[cursor.col]?.cards[cursor.row];
        if (bc) {
          setModal({ mode: "confirm-resolve", card: bc });
        }
      }
    },
    { isActive: !modal },
  );

  const currentSessionName = sessionName ?? tmux.sessions.find((s) => s.attached)?.name ?? tmux.sessions[0]?.name ?? serverName ?? "";

  const buildCardFromValues = useCallback(
    (values: FormValues): Card => {
      const id = randomUUID();
      return {
        id,
        columnId: COL_TODO,
        name: values.name,
        description: values.description,
        acceptanceCriteria: values.acceptanceCriteria,
        sessionName: currentSessionName,
        dir: values.dir,
        command: values.command,
        customCommand: values.command === "custom" ? values.customCommand : undefined,
        worktree: values.worktree,
        worktreePath: values.worktree ? values.worktreePath : undefined,
        createdAt: Date.now(),
      };
    },
    [currentSessionName],
  );

  const handleCreate = useCallback(
    (values: FormValues) => {
      const cfg = configRef.current;
      const card = buildCardFromValues(values);
      const newConfig: BoardConfig = {
        ...cfg,
        cards: { ...cfg.cards, [card.id]: card },
      };
      updateConfig(newConfig);
      setModal(null);
    },
    [updateConfig, buildCardFromValues],
  );

  const handleEdit = useCallback(
    (values: FormValues) => {
      if (!modal || modal.mode !== "edit") return;
      const bc = modal.card;
      const cfg = configRef.current;
      const card = cfg.cards[bc.cardId];
      if (!card) return;

      const updatedCard: Card = {
        ...card,
        name: values.name,
        description: values.description,
        acceptanceCriteria: values.acceptanceCriteria,
        dir: values.dir,
        command: values.command,
        customCommand: values.command === "custom" ? values.customCommand : undefined,
        worktree: values.worktree,
        worktreePath: values.worktree ? values.worktreePath : undefined,
      };

      // Rename tmux window if live
      if (card.windowId) {
        const renameArgs = serverName ? ["-L", serverName] : [];
        renameArgs.push("rename-window", "-t", card.windowId, values.name);
        execTmuxCommand(renameArgs).catch(() => {});
      }

      const newConfig: BoardConfig = {
        ...cfg,
        cards: { ...cfg.cards, [bc.cardId]: updatedCard },
      };
      updateConfig(newConfig);
      if (card.windowId) {
        getTmuxState(serverName, sessionName).then((t) => setTmux(t));
      }
      setModal(null);
    },
    [modal, serverName, sessionName, updateConfig],
  );

  const startCard = useCallback(
    async (card: Card) => {
      let dir = card.dir;
      if (card.worktree) {
        const wt = buildWorktreeArgs(card.dir, card.name, card.worktreePath);
        await execFileAsync("git", wt.args);
        dir = wt.worktreePath;
      }

      const windowOpts = {
        sessionName: card.sessionName,
        name: sanitizeBranchName(card.name),
        dir,
        command: card.command,
        customCommand: card.command === "custom" ? card.customCommand : undefined,
        description: card.description,
        acceptanceCriteria: card.acceptanceCriteria,
      };

      // Use new-session if no server/sessions exist yet, new-window otherwise
      const hasServer = tmux.sessions.length > 0;
      const args = hasServer
        ? buildNewWindowArgs(windowOpts, serverName ?? "")
        : buildNewSessionArgs(windowOpts, serverName ?? "");

      const newWindowId = await execTmuxCommandWithOutput(args);

      // Update card in-place — set windowId, startedAt, move to in-progress
      const cfg = configRef.current;
      const updatedCard: Card = {
        ...card,
        windowId: newWindowId,
        startedAt: Date.now(),
        columnId: COL_IN_PROGRESS,
        closedAt: undefined,
      };
      const newConfig: BoardConfig = {
        ...cfg,
        cards: { ...cfg.cards, [card.id]: updatedCard },
      };

      updateConfig(newConfig);
      const newTmux = await getTmuxState(serverName, sessionName);
      setTmux(newTmux);
      setModal(null);

      // Switch to the new window
      const result = resolveSwitchArgs(
        { sessionName: card.sessionName, windowId: newWindowId },
        newTmux,
        process.env,
      );
      if (result.mode === "switch") {
        await execTmuxCommand(result.args);
      } else if (result.mode === "attach") {
        onAttach(result.args);
        exit();
      }
    },
    [tmux, serverName, sessionName, updateConfig, onAttach, exit],
  );

  const handleCreateAndStart = useCallback(
    async (values: FormValues) => {
      const cfg = configRef.current;
      const card = buildCardFromValues(values);
      const newConfig: BoardConfig = {
        ...cfg,
        cards: { ...cfg.cards, [card.id]: card },
      };
      setConfig(newConfig);
      configRef.current = newConfig;
      await startCard(card);
    },
    [buildCardFromValues, startCard],
  );

  const handleQuickShell = useCallback(
    async (name: string) => {
      const cfg = configRef.current;
      const id = randomUUID();
      const card: Card = {
        id,
        columnId: COL_IN_PROGRESS,
        name,
        description: "",
        acceptanceCriteria: "",
        sessionName: currentSessionName,
        dir: workingDir,
        command: "shell",
        worktree: false,
        createdAt: Date.now(),
      };
      const newConfig: BoardConfig = {
        ...cfg,
        cards: { ...cfg.cards, [id]: card },
      };
      setConfig(newConfig);
      configRef.current = newConfig;
      await startCard(card);
    },
    [currentSessionName, workingDir, startCard],
  );

  const handleStart = useCallback(
    async (values: FormValues) => {
      if (!modal || modal.mode !== "start") return;
      const bc = modal.card;
      const cfg = configRef.current;
      const card = cfg.cards[bc.cardId];
      if (!card) return;

      // Update card with form values before starting
      const updatedCard: Card = {
        ...card,
        name: values.name,
        description: values.description,
        acceptanceCriteria: values.acceptanceCriteria,
        dir: values.dir,
        command: values.command as "shell" | "claude" | "custom",
        customCommand: values.command === "custom" ? values.customCommand : undefined,
        worktree: values.worktree,
        worktreePath: values.worktree ? values.worktreePath : undefined,
      };
      // Save the updated card first, then start
      const newConfig: BoardConfig = {
        ...cfg,
        cards: { ...cfg.cards, [card.id]: updatedCard },
      };
      setConfig(newConfig);
      configRef.current = newConfig;
      await startCard(updatedCard);
    },
    [modal, startCard],
  );

  const confirmResolve = useCallback(() => {
    if (!modal || modal.mode !== "confirm-resolve") return;
    const bc = modal.card;
    const cfg = configRef.current;

    // Kill tmux window if live
    if (bc.windowId) {
      const killArgs = serverName ? ["-L", serverName] : [];
      killArgs.push("kill-window", "-t", bc.windowId);
      execTmuxCommand(killArgs).catch(() => {});
    }

    // Move card to Done column, clear windowId, set closedAt
    const card = cfg.cards[bc.cardId];
    if (card) {
      const resolvedCard: Card = {
        ...card,
        columnId: COL_DONE,
        windowId: undefined,
        closedAt: Date.now(),
      };
      const newConfig: BoardConfig = {
        ...cfg,
        cards: { ...cfg.cards, [bc.cardId]: resolvedCard },
      };
      updateConfig(newConfig);
    } else {
      // Uncategorized window with no card record — just kill the window (already done above)
    }

    if (bc.windowId) {
      getTmuxState(serverName, sessionName).then((t) => setTmux(t));
    }

    // Adjust cursor if it's now past the end
    const col = columns[cursor.col];
    const newMaxRow = Math.max(0, col.cards.length - 2);
    if (cursor.row > newMaxRow) {
      setCursor((c) => ({ ...c, row: newMaxRow }));
    }
    setModal(null);
  }, [modal, columns, cursor, serverName, sessionName, updateConfig, setCursor]);

  useInput(
    (input, key) => {
      if (input === "y" || key.return) {
        confirmResolve();
      } else if (input === "n" || key.escape) {
        setModal(null);
      }
    },
    { isActive: modal?.mode === "confirm-resolve" },
  );

  useInput(
    (input, key) => {
      if (input === "y" || key.return) {
        if (modal?.mode === "confirm-start") {
          const card = findCard(modal.card);
          if (card) startCard(card);
        }
      } else if (input === "n" || key.escape) {
        setModal(null);
      }
    },
    { isActive: modal?.mode === "confirm-start" },
  );

  const title = tmux.sessions.find((s) => s.attached)?.name ?? tmux.sessions[0]?.name ?? serverName ?? "tukan";

  const modalWidth = Math.min(80, width - 4);
  const boardHeight = height - 1; // title row

  const renderModal = () => {
    if (!modal) return null;
    if (modal.mode === "confirm-resolve") {
      const hasWindow = !!modal.card.windowId;
      return (
        <Box flexDirection="column" borderStyle="round" borderColor="green" padding={1} width={modalWidth}>
          <Text>
            Resolve <Text bold color="green">{modal.card.name}</Text>?
            {hasWindow && <Text dimColor> (will kill the tmux window)</Text>}
          </Text>
          <Box marginTop={1}>
            <Text dimColor>y/Enter confirm · n/Esc cancel</Text>
          </Box>
        </Box>
      );
    }
    if (modal.mode === "confirm-start") {
      return (
        <Box flexDirection="column" borderStyle="round" borderColor="green" padding={1} width={modalWidth}>
          <Text>
            Start <Text bold color="green">{modal.card.name}</Text>?
          </Text>
          <Box marginTop={1}>
            <Text dimColor>y/Enter confirm · n/Esc cancel</Text>
          </Box>
        </Box>
      );
    }
    if (modal.mode === "quick-shell") {
      return (
        <QuickShellModal
          onSubmit={handleQuickShell}
          onCancel={() => setModal(null)}
          width={modalWidth}
        />
      );
    }

    const modalMode = modal.mode === "edit" ? "edit" as const : modal.mode;

    // Get card data for initial values
    const card = modal.mode === "edit" || modal.mode === "start"
      ? configRef.current.cards[modal.card.cardId]
      : undefined;

    const initialValues = card ? {
      name: card.name,
      description: card.description,
      acceptanceCriteria: card.acceptanceCriteria,
      dir: card.dir,
      command: card.command,
      customCommand: card.customCommand,
      worktree: card.worktree,
      worktreePath: card.worktreePath,
      windowId: card.windowId,
    } : undefined;

    const onSubmit =
      modal.mode === "create" ? handleCreate
      : modal.mode === "start" ? handleStart
      : handleEdit;

    return (
      <NewCardModal
        mode={modalMode}
        initialValues={initialValues}
        onSubmit={onSubmit}
        onSubmitAndStart={modal.mode === "create" ? handleCreateAndStart : undefined}
        onCancel={() => setModal(null)}
        width={modalWidth}
      />
    );
  };

  return (
    <Box flexDirection="column" width={width} height={height}>
      <Box justifyContent="center">
        <Text bold color="cyan">{title}</Text>
      </Box>
      {modal ? (
        <Box alignItems="center" justifyContent="center" width={width} height={boardHeight}>
          {renderModal()}
        </Box>
      ) : (
        <>
          <Board columns={columns} cursor={cursor} width={width} height={boardHeight} />
          <StatusBar />
        </>
      )}
    </Box>
  );
}
