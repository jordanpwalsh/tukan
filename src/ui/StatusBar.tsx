import { createRequire } from "node:module";
import { Box, Text } from "ink";

const require = createRequire(import.meta.url);
const { version } = require("../../package.json") as { version: string };

export function StatusBar() {
  return (
    <Box justifyContent="space-between">
      <Text>
        <Text color="magenta">{"←→"}</Text>
        <Text dimColor>{" columns  "}</Text>
        <Text color="magenta">{"↑↓"}</Text>
        <Text dimColor>{" cards  "}</Text>
        <Text color="magenta">{"h/l"}</Text>
        <Text dimColor>{" move card  "}</Text>
        <Text color="magenta">{"s"}</Text>
        <Text dimColor>{" start  "}</Text>
        <Text color="magenta">{"\u21B5"}</Text>
        <Text dimColor>{" switch  "}</Text>
        <Text color="magenta">{"n"}</Text>
        <Text dimColor>{" new  "}</Text>
        <Text color="magenta">{"C"}</Text>
        <Text dimColor>{" shell  "}</Text>
        <Text color="magenta">{"e"}</Text>
        <Text dimColor>{" edit  "}</Text>
        <Text color="magenta">{"r"}</Text>
        <Text dimColor>{" resolve  "}</Text>
        <Text color="magenta">{"q"}</Text>
        <Text dimColor>{" quit"}</Text>
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
