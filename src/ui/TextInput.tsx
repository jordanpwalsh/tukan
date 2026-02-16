import { Box, Text } from "ink";
import { useInput } from "ink";

interface TextInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  focus: boolean;
  multiline?: boolean;
  minHeight?: number;
}

export function TextInput({ value, onChange, placeholder, focus, multiline, minHeight }: TextInputProps) {
  useInput(
    (input, key) => {
      if (key.backspace || key.delete) {
        onChange(value.slice(0, -1));
      } else if (multiline && key.return) {
        onChange(value + "\n");
      } else if (
        !key.ctrl &&
        !key.meta &&
        !key.escape &&
        !key.return &&
        !key.tab &&
        !key.upArrow &&
        !key.downArrow &&
        !key.leftArrow &&
        !key.rightArrow &&
        input &&
        // Filter out control characters (e.g. DEL \x7f)
        input >= " "
      ) {
        onChange(value + input);
      }
    },
    { isActive: focus },
  );

  if (multiline) {
    const showPlaceholder = !value && !focus && placeholder;
    const lines = showPlaceholder ? [placeholder] : (value || "").split("\n");
    const padCount = Math.max(0, (minHeight ?? 1) - lines.length);
    return (
      <Box flexDirection="column" minHeight={minHeight}>
        {lines.map((line, i) => (
          <Text key={i} dimColor={!!showPlaceholder}>
            {line}
            {focus && i === lines.length - 1 && <Text color="cyan">{"▏"}</Text>}
          </Text>
        ))}
        {padCount > 0 && Array.from({ length: padCount }, (_, i) => (
          <Text key={`pad-${i}`}>{" "}</Text>
        ))}
      </Box>
    );
  }

  if (!value && !focus && placeholder) {
    return <Text dimColor>{placeholder}</Text>;
  }

  return (
    <Text>
      {value}
      {focus && <Text color="cyan">{"▏"}</Text>}
    </Text>
  );
}
