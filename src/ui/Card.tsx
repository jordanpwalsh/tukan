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

export function Card({ card, selected, width }: CardProps) {
  const borderColor = selected ? "cyan" : "gray";

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={borderColor}
      width={width}
      paddingLeft={1}
      paddingRight={1}
    >
      <Text bold color={selected ? "cyan" : undefined} wrap="truncate">
        {card.name}
      </Text>
      <Text dimColor wrap="truncate">
        {card.command} · {shortenPath(card.workingDir)}
      </Text>
      <Text dimColor wrap="truncate">
        [{card.sessionName}]{card.active ? " ●" : ""}
      </Text>
    </Box>
  );
}
