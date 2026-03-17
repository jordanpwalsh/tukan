import { Box, Text } from "ink";
import { useInput } from "ink";

interface TextInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  focus: boolean;
  multiline?: boolean;
  minHeight?: number;
  width?: number;
}

export function TextInput({ value, onChange, placeholder, focus, multiline, minHeight, width }: TextInputProps) {
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
    const wrapWidth = width ?? 80;

    // Soft-wrap a single logical line into visual lines at wrapWidth
    const wrapLine = (line: string, w: number): string[] => {
      if (line.length <= w) return [line];
      const wrapped: string[] = [];
      for (let pos = 0; pos < line.length; pos += w) {
        wrapped.push(line.slice(pos, pos + w));
      }
      return wrapped;
    };

    // Build visual lines from logical lines (split by \n), soft-wrapping each
    const logicalLines = showPlaceholder ? [placeholder] : (value || "").split("\n");
    const visualLines: { text: string; isLast: boolean }[] = [];
    for (let li = 0; li < logicalLines.length; li++) {
      const line = logicalLines[li]!;
      const isLastLogical = li === logicalLines.length - 1;
      // Reserve cursor space on the very last visual line
      const w = isLastLogical && focus ? wrapWidth - 1 : wrapWidth;
      const wrapped = wrapLine(line, Math.max(1, w));
      for (let wi = 0; wi < wrapped.length; wi++) {
        const isLastVisual = isLastLogical && wi === wrapped.length - 1;
        visualLines.push({ text: wrapped[wi]!, isLast: isLastVisual });
      }
    }

    // Show last maxLines visual lines so the cursor stays visible
    const startLine = Math.max(0, visualLines.length - maxLines);
    const visible = visualLines.slice(startLine, startLine + maxLines);
    const padCount = Math.max(0, maxLines - visible.length);

    return (
      <Box flexDirection="column" height={maxLines} width={width}>
        {visible.map((vl, i) => (
          <Text key={i} dimColor={!!showPlaceholder} wrap="truncate">
            {vl.text}
            {focus && vl.isLast && <Text color="cyan">{"▏"}</Text>}
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

  // For single-line inputs, show the tail of the value so the cursor stays visible
  const availWidth = width ? width - 1 : undefined; // 1 char for cursor
  const displayValue = availWidth && value.length > availWidth
    ? value.slice(value.length - availWidth)
    : value;

  return (
    <Text>
      {displayValue}
      {focus && <Text color="cyan">{"▏"}</Text>}
    </Text>
  );
}
