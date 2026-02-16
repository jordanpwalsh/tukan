import { Text } from "ink";
import { useInput } from "ink";

interface SelectOption {
  label: string;
  value: string;
}

interface SelectInputProps {
  options: SelectOption[];
  value: string;
  onChange: (value: string) => void;
  focus: boolean;
}

export function SelectInput({ options, value, onChange, focus }: SelectInputProps) {
  useInput(
    (_input, key) => {
      const idx = options.findIndex((o) => o.value === value);
      if (key.leftArrow) {
        const prev = (idx - 1 + options.length) % options.length;
        onChange(options[prev].value);
      } else if (key.rightArrow) {
        const next = (idx + 1) % options.length;
        onChange(options[next].value);
      }
    },
    { isActive: focus },
  );

  const current = options.find((o) => o.value === value);
  const label = current?.label ?? value;

  if (focus) {
    return (
      <Text>
        <Text color="cyan">{"◂ "}</Text>
        <Text>{label}</Text>
        <Text color="cyan">{" ▸"}</Text>
      </Text>
    );
  }

  return <Text>{label}</Text>;
}
