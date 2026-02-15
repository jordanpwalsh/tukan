import { Box, Text } from "ink";

export function StatusBar() {
  return (
    <Box>
      <Text dimColor>
        ←→ navigate columns  ↑↓ navigate cards  h/l move card  q quit
      </Text>
    </Box>
  );
}
