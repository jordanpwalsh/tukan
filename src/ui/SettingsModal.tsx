import { useState } from "react";
import { Box, Text, useInput } from "ink";
import { TextInput } from "./TextInput.js";
import { randomUUID } from "node:crypto";
import type { CommandDef } from "../board/types.js";

interface SettingsModalProps {
  initialColumns: Array<{ id: string; title: string }>;
  initialCommands: CommandDef[];
  onSubmit: (columns: Array<{ id: string; title: string }>, commands: CommandDef[]) => void;
  onCancel: () => void;
  width: number;
}

export function SettingsModal({
  initialColumns,
  initialCommands,
  onSubmit,
  onCancel,
  width,
}: SettingsModalProps) {
  const [columns, setColumns] = useState(
    initialColumns.map((c) => ({ ...c })),
  );
  const [commands, setCommands] = useState(
    initialCommands.map((c) => ({ ...c })),
  );
  const [focusIdx, setFocusIdx] = useState(0);

  // Flat field list: column title inputs, then command label+template pairs, then "add" action
  // Column fields: one per column (title)
  // Command fields: two per command (label, template)
  // Plus one "add" action at the end
  const columnFieldCount = columns.length;
  const commandFieldCount = commands.length * 2;
  const totalFields = columnFieldCount + commandFieldCount + 1; // +1 for "add command"

  const clampedFocus = Math.min(focusIdx, totalFields - 1);

  const getFieldInfo = (idx: number) => {
    if (idx < columnFieldCount) {
      return { type: "column-title" as const, columnIdx: idx };
    }
    const cmdOffset = idx - columnFieldCount;
    if (cmdOffset < commandFieldCount) {
      const cmdIdx = Math.floor(cmdOffset / 2);
      const fieldInCmd = cmdOffset % 2;
      return { type: fieldInCmd === 0 ? "cmd-label" as const : "cmd-template" as const, cmdIdx };
    }
    return { type: "add-command" as const };
  };

  const currentField = getFieldInfo(clampedFocus);

  const addCommand = () => {
    const id = `cmd-${randomUUID().slice(0, 8)}`;
    setCommands((prev) => [...prev, { id, label: "", template: "" }]);
    // Focus the new command's label field
    setFocusIdx(columnFieldCount + commands.length * 2);
  };

  const deleteCommand = () => {
    if (currentField.type === "cmd-label" || currentField.type === "cmd-template") {
      const cmdIdx = currentField.cmdIdx;
      setCommands((prev) => prev.filter((_, i) => i !== cmdIdx));
      // Adjust focus
      setFocusIdx((f) => Math.max(0, f - 2));
    }
  };

  useInput(
    (input, key) => {
      if (key.escape) {
        onCancel();
        return;
      }

      if (key.return) {
        if (currentField.type === "add-command") {
          addCommand();
        } else {
          // Save
          const validCommands = commands.filter((c) => c.label.trim());
          onSubmit(columns, validCommands);
        }
        return;
      }

      // Ctrl+D to delete focused command
      if (input === "d" && key.ctrl) {
        deleteCommand();
        return;
      }

      if (key.tab && key.shift) {
        setFocusIdx((i) => (i - 1 + totalFields) % totalFields);
      } else if (key.tab) {
        setFocusIdx((i) => (i + 1) % totalFields);
      } else if (key.downArrow) {
        setFocusIdx((i) => Math.min(i + 1, totalFields - 1));
      } else if (key.upArrow) {
        setFocusIdx((i) => Math.max(i - 1, 0));
      }
    },
    { isActive: true },
  );

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="cyan" padding={1} width={width}>
      <Box justifyContent="center" marginBottom={1}>
        <Text bold color="cyan">Settings</Text>
      </Box>

      {/* Column titles */}
      <Text bold color="yellow">Columns</Text>
      {columns.map((col, i) => {
        const focused = clampedFocus === i;
        return (
          <Box key={col.id} marginLeft={2}>
            <Box width={16}>
              <Text bold={focused} color={focused ? "cyan" : undefined}>
                {initialColumns[i]?.title ?? col.id}:
              </Text>
            </Box>
            <TextInput
              value={col.title}
              onChange={(v) =>
                setColumns((prev) => prev.map((c, j) => (j === i ? { ...c, title: v } : c)))
              }
              placeholder={col.title}
              focus={focused}
            />
          </Box>
        );
      })}

      {/* Commands */}
      <Box marginTop={1}>
        <Text bold color="yellow">Commands</Text>
      </Box>
      {commands.map((cmd, i) => {
        const labelIdx = columnFieldCount + i * 2;
        const templateIdx = labelIdx + 1;
        const labelFocused = clampedFocus === labelIdx;
        const templateFocused = clampedFocus === templateIdx;
        return (
          <Box key={cmd.id} marginLeft={2}>
            <Box width={8}>
              <Text bold={labelFocused} color={labelFocused ? "cyan" : undefined}>Name: </Text>
            </Box>
            <Box width={16}>
              <TextInput
                value={cmd.label}
                onChange={(v) =>
                  setCommands((prev) => prev.map((c, j) => (j === i ? { ...c, label: v } : c)))
                }
                placeholder="Name"
                focus={labelFocused}
              />
            </Box>
            <Text> </Text>
            <Box width={7}>
              <Text bold={templateFocused} color={templateFocused ? "cyan" : undefined}>Cmd: </Text>
            </Box>
            <TextInput
              value={cmd.template}
              onChange={(v) =>
                setCommands((prev) => prev.map((c, j) => (j === i ? { ...c, template: v } : c)))
              }
              placeholder="(default shell)"
              focus={templateFocused}
            />
          </Box>
        );
      })}

      {/* Add command action */}
      <Box marginLeft={2}>
        <Text
          bold={clampedFocus === totalFields - 1}
          color={clampedFocus === totalFields - 1 ? "green" : "dimColor"}
        >
          + Add command
        </Text>
      </Box>

      <Box marginTop={1}>
        <Text dimColor>
          Tab/↓ next · ↑ prev · Enter save · Esc cancel · Ctrl+D delete command
        </Text>
      </Box>
    </Box>
  );
}
