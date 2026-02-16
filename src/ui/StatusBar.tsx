import { createRequire } from "node:module";
import { Box, Text } from "ink";

const require = createRequire(import.meta.url);
const { version } = require("../../package.json") as { version: string };

interface Binding {
  key: string;
  label: string;
}

// Ordered by display priority for the status bar
const BINDINGS: Binding[] = [
  { key: "n", label: "new" },
  { key: "s", label: "start" },
  { key: "\u21B5", label: "switch" },
  { key: "e", label: "edit" },
  { key: "r", label: "resolve" },
  { key: "h/l", label: "move" },
  { key: "q", label: "quit" },
  { key: "←→", label: "cols" },
  { key: "↑↓", label: "cards" },
  { key: "C", label: "shell" },
  { key: ",", label: "settings" },
];

function bindingWidth(b: Binding): number {
  // "key label  " — key + space + label + double-space separator
  return b.key.length + 1 + b.label.length + 2;
}

interface StatusBarProps {
  width: number;
}

export function StatusBar({ width }: StatusBarProps) {
  const brandWidth = 2 + " Tukan".length + ` v${version}`.length;
  const helpWidth = "? help  ".length;
  const available = width - brandWidth - helpWidth;

  const visible: Binding[] = [];
  let used = 0;
  for (const b of BINDINGS) {
    const w = bindingWidth(b);
    if (used + w <= available) {
      visible.push(b);
      used += w;
    }
  }

  return (
    <Box justifyContent="space-between">
      <Text>
        <Text color="magenta">{"?"}</Text>
        <Text dimColor>{" help  "}</Text>
        {visible.map((b) => (
          <Text key={b.key}>
            <Text color="magenta">{b.key}</Text>
            <Text dimColor>{` ${b.label}  `}</Text>
          </Text>
        ))}
      </Text>
      <Text>
        <Text bold color="green">{"\u25D6"}</Text>
        <Text bold color="yellow">{"\u25B6"}</Text>
        <Text bold color="cyan">{" Tukan"}</Text>
        <Text dimColor>{` v${version}`}</Text>
      </Text>
    </Box>
  );
}
