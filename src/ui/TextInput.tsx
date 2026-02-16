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
    const maxLines = minHeight ?? 5;
    const showPlaceholder = !value && !focus && placeholder;
    const allLines = showPlaceholder ? [placeholder] : (value || "").split("\n");

    // Show last maxLines lines so the cursor (always at end) stays visible
    const startLine = Math.max(0, allLines.length - maxLines);
    const visibleLines = allLines.slice(startLine, startLine + maxLines);
    const padCount = Math.max(0, maxLines - visibleLines.length);

    return (
      <Box flexDirection="column" height={maxLines}>
        {visibleLines.map((line, i) => (
          <Text key={i} dimColor={!!showPlaceholder}>
            {line}
            {focus && startLine + i === allLines.length - 1 && <Text color="cyan">{"▏"}</Text>}
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
