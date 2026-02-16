import { useState } from "react";
import { Box, Text, useInput } from "ink";
import { TextInput } from "./TextInput.js";

interface QuickShellModalProps {
  onSubmit: (name: string) => void;
  onCancel: () => void;
  width: number;
}

export function QuickShellModal({ onSubmit, onCancel, width }: QuickShellModalProps) {
  const [name, setName] = useState("");

  useInput((_input, key) => {
    if (key.escape) {
      onCancel();
    } else if (key.return && name.trim()) {
      onSubmit(name.trim());
    }
  });

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="cyan" padding={1} width={width}>
      <Text bold color="cyan">New Shell</Text>
      <Box marginTop={1}>
        <Text>Name: </Text>
        <TextInput value={name} onChange={setName} placeholder="window name" focus={true} />
      </Box>
      <Box marginTop={1}>
        <Text dimColor>Enter confirm · Esc cancel</Text>
      </Box>
    </Box>
  );
}
