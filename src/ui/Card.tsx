import { useState, useEffect } from "react";
import { Box, Text } from "ink";
import type { BoardCard } from "../board/types.js";

interface CardProps {
  card: BoardCard;
  selected: boolean;
  width: number;
}

function shortenPath(dir: string): string {
  const home = process.env.HOME;
  if (home && dir.startsWith(home)) {
    return "~" + dir.slice(home.length);
  }
  return dir;
}

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

function formatIdleTime(seconds: number): string {
  if (seconds < 60) return `idle ${seconds}s`;
  if (seconds < 3600) return `idle ${Math.floor(seconds / 60)}m`;
  return `idle ${Math.floor(seconds / 3600)}h`;
}

export function Card({ card, selected, width }: CardProps) {
  const [spinnerIndex, setSpinnerIndex] = useState(0);

  useEffect(() => {
    if (!card.spinning) return;
    const interval = setInterval(() => {
      setSpinnerIndex((i) => (i + 1) % SPINNER_FRAMES.length);
    }, 150);
    return () => clearInterval(interval);
  }, [card.spinning]);

  // Indicator precedence: ◇ closed → spinner → ◆ activity → ● active → ○ has window → blank (virtual)
  let indicator = "";
  let indicatorColor: string | undefined;
  if (card.closed) {
    indicator = "◇";
  } else if (card.spinning) {
    indicator = SPINNER_FRAMES[spinnerIndex];
    indicatorColor = "yellow";
  } else if (card.hasActivity) {
    indicator = "◆";
    indicatorColor = "green";
  } else if (card.active) {
    indicator = "●";
  } else if (card.started || card.uncategorized) {
    indicator = "○";
  }

  const command = card.command || "shell";
  const dir = card.workingDir ? shortenPath(card.workingDir) : "";

  // Show idle time for started cards that aren't spinning
  const showIdle = card.started && !card.spinning && card.idleTime != null;

  const selColor = card.started ? "cyan" : "yellow";

  return (
    <Box
      flexDirection="column"
      flexShrink={0}
      borderStyle={selected ? "bold" : "round"}
      borderColor={selected ? selColor : "gray"}
      width={width}
      paddingLeft={1}
      paddingRight={1}
    >
      <Box flexDirection="row">
        <Text bold={selected} color={selected ? selColor : undefined} wrap="truncate" inverse={selected}>
          {indicator ? (
            indicatorColor && !selected
              ? <><Text color={indicatorColor}>{indicator}</Text>{" "}</>
              : `${indicator} `
          ) : ""}{" "}{card.name}{" "}
        </Text>
        {selected ? (
          <Text inverse color={selColor}>{" ".repeat(Math.max(0, width - 4 - (indicator ? 2 : 0) - card.name.length - 2 - card.displayId.length - 2))}</Text>
        ) : (
          <Box flexGrow={1} />
        )}
        <Text dimColor={!selected} color={selected ? selColor : undefined} inverse={selected}>{" "}{card.displayId}</Text>
      </Box>
      {dir ? (
        <Text dimColor wrap="truncate">{dir}</Text>
      ) : null}
      <Text dimColor wrap="truncate">
        {command}{showIdle ? ` · ${formatIdleTime(card.idleTime!)}` : ""}
      </Text>
    </Box>
  );
}
