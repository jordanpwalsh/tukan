import { useState, useMemo, useCallback } from "react";
import { Box, useApp, useInput } from "ink";
import { Board } from "./Board.js";
import { StatusBar } from "./StatusBar.js";
import { useTerminalSize } from "./hooks/useTerminalSize.js";
import { deriveBoard } from "../board/derive.js";
import { moveLeft, moveRight, moveUp, moveDown, moveCard } from "../board/navigation.js";
import type { TmuxServer } from "../tmux/types.js";
import type { BoardConfig, Cursor } from "../board/types.js";

interface AppProps {
  tmux: TmuxServer;
  initialConfig: BoardConfig;
  onSave: (config: BoardConfig) => void;
}

export function App({ tmux, initialConfig, onSave }: AppProps) {
  const { exit } = useApp();
  const { width, height } = useTerminalSize();
  const [config, setConfig] = useState(initialConfig);
  const [cursor, setCursor] = useState<Cursor>({ col: 0, row: 0 });

  const columns = useMemo(() => deriveBoard(tmux, config), [tmux, config]);

  const updateConfig = useCallback(
    (newConfig: BoardConfig) => {
      setConfig(newConfig);
      onSave(newConfig);
    },
    [onSave],
  );

  useInput((input, key) => {
    if (input === "q") {
      exit();
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
      const result = moveCard(config, columns, cursor, "left");
      if (result) {
        updateConfig(result.config);
        setCursor(result.cursor);
      }
    } else if (input === "l") {
      const result = moveCard(config, columns, cursor, "right");
      if (result) {
        updateConfig(result.config);
        setCursor(result.cursor);
      }
    }
  });

  return (
    <Box flexDirection="column" width={width} height={height}>
      <Board columns={columns} cursor={cursor} width={width} height={height} />
      <StatusBar />
    </Box>
  );
}
