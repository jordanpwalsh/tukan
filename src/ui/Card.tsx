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

/** Build a fixed-width title line: " indicator name   displayId " */
export function buildTitleLine(
  indicator: string,
  name: string,
  displayId: string,
  innerWidth: number,
): { prefix: string; paddedName: string; suffix: string } {
  const prefix = indicator ? `${indicator} ` : " ";
  const suffix = ` ${displayId}`;
  const available = Math.max(0, innerWidth - prefix.length - suffix.length);
  const truncated = name.length > available ? name.slice(0, available) : name;
  const paddedName = truncated + " ".repeat(available - truncated.length);
  return { prefix, paddedName, suffix };
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

  // Show idle time for started cards that aren't spinning or active
  const showIdle = card.started && !card.spinning && !card.active && card.idleTime != null;

  const selColor = card.started ? "cyan" : "yellow";

  // Build fixed-width title line so inverse highlight fills the entire row
  const innerWidth = width - 4; // border (2) + padding (2)
  const { prefix, paddedName, suffix } = buildTitleLine(indicator, card.name, card.displayId, innerWidth);

  const titleRow = selected ? (
    <Text bold color={selColor} inverse wrap="truncate">
      {prefix}{paddedName}{suffix}
    </Text>
  ) : (
    <Text wrap="truncate">
      {indicatorColor
        ? <Text color={indicatorColor}>{prefix}</Text>
        : prefix
      }{paddedName}<Text dimColor>{suffix}</Text>
    </Text>
  );

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
      <Box height={1}>{titleRow}</Box>
      {dir ? (
        <Text dimColor wrap="truncate">{dir}</Text>
      ) : null}
      <Text dimColor wrap="truncate">
        {command}{showIdle ? ` · ${formatIdleTime(card.idleTime!)}` : ""}
      </Text>
    </Box>
  );
}
