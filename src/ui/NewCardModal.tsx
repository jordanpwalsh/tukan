import { useState } from "react";
import { Box, Text, useInput } from "ink";
import { TextInput } from "./TextInput.js";
import { SelectInput } from "./SelectInput.js";
import { basename } from "node:path";
import { sanitizeBranchName } from "../tmux/create.js";

interface NewCardModalProps {
  mode: "create" | "start" | "edit";
  initialValues?: { name?: string; description?: string; acceptanceCriteria?: string; dir?: string; worktree?: boolean; worktreePath?: string; command?: "shell" | "claude" | "custom"; customCommand?: string; windowId?: string };
  onSubmit: (values: FormValues) => void;
  onSubmitAndStart?: (values: FormValues) => void;
  onCancel: () => void;
  width?: number;
}

export interface FormValues {
  name: string;
  description: string;
  acceptanceCriteria: string;
  dir: string;
  command: "shell" | "claude" | "custom";
  customCommand: string;
  worktree: boolean;
  worktreePath: string;
}

const WORKTREE_OPTIONS = [
  { label: "No", value: "no" },
  { label: "Yes", value: "yes" },
];

const COMMAND_OPTIONS = [
  { label: "Shell", value: "shell" },
  { label: "Claude Code", value: "claude" },
  { label: "Custom", value: "custom" },
];

export function NewCardModal({
  mode,
  initialValues,
  onSubmit,
  onSubmitAndStart,
  onCancel,
  width: modalWidth,
}: NewCardModalProps) {
  const [name, setName] = useState(initialValues?.name ?? "");
  const [description, setDescription] = useState(initialValues?.description ?? "");
  const [acceptanceCriteria, setAcceptanceCriteria] = useState(
    initialValues?.acceptanceCriteria ?? "",
  );
  const [dir, setDir] = useState(
    initialValues?.dir ?? process.cwd(),
  );
  const [worktree, setWorktree] = useState(
    initialValues?.worktree ?? false,
  );
  const [command, setCommand] = useState<"shell" | "claude" | "custom">(
    initialValues?.command ?? "shell",
  );
  const [customCommand, setCustomCommand] = useState(
    initialValues?.customCommand ?? "",
  );
  const [worktreePath, setWorktreePath] = useState(
    initialValues?.worktreePath ?? "",
  );
  const [focusIdx, setFocusIdx] = useState(0);

  const metaOnly = mode === "edit" && !!initialValues?.windowId;

  const fields: Array<{ label: string; id: string }> = metaOnly
    ? [
        { label: "Name", id: "name" },
        { label: "Description", id: "description" },
        { label: "Acceptance Criteria", id: "criteria" },
      ]
    : [
        { label: "Name", id: "name" },
        { label: "Description", id: "description" },
        { label: "Acceptance Criteria", id: "criteria" },
        { label: "Working Directory", id: "dir" },
        { label: "Worktree", id: "worktree" },
        ...(worktree ? [{ label: "Worktree Path", id: "worktreePath" }] : []),
        { label: "Command", id: "command" },
        ...(command === "custom" ? [{ label: "Custom Command", id: "customCommand" }] : []),
      ];

  const maxFields = fields.length;

  const submit = () => {
    if (!name.trim()) return;
    onSubmit({
      name: name.trim(),
      description,
      acceptanceCriteria,
      dir: dir || process.cwd(),
      command,
      customCommand,
      worktree,
      worktreePath,
    });
  };

  const multilineFields = new Set(["description", "criteria"]);
  const isMultiline = multilineFields.has(fields[focusIdx]?.id ?? "");

  useInput(
    (input, key) => {
      if (key.escape) {
        onCancel();
        return;
      }

      // Ctrl+S to submit and start (if available), otherwise just submit
      if (input === "s" && key.ctrl) {
        if (onSubmitAndStart) {
          if (!name.trim()) return;
          onSubmitAndStart({
            name: name.trim(),
            description,
            acceptanceCriteria,
            dir: dir || process.cwd(),
            command,
            customCommand,
            worktree,
            worktreePath,
          });
        } else {
          submit();
        }
        return;
      }

      // Enter submits only when not in a multiline field
      if (key.return && !isMultiline) {
        submit();
        return;
      }

      if (key.tab && key.shift) {
        setFocusIdx((i) => (i - 1 + maxFields) % maxFields);
      } else if (key.tab) {
        setFocusIdx((i) => (i + 1) % maxFields);
      } else if (!isMultiline && key.downArrow) {
        setFocusIdx((i) => Math.min(i + 1, maxFields - 1));
      } else if (!isMultiline && key.upArrow) {
        setFocusIdx((i) => Math.max(i - 1, 0));
      }
    },
    { isActive: true },
  );

  const focusedField = fields[focusIdx]?.id;

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="cyan" padding={1} width={modalWidth}>
      <Box justifyContent="center" marginBottom={1}>
        <Text bold color="cyan">
          {mode === "create" ? "New Card" : mode === "edit" ? "Edit Card" : "Start Card"}
        </Text>
      </Box>

      {fields.map((field) => (
        <Box key={field.id} flexDirection="row">
          <Box width={22}>
            <Text bold={focusedField === field.id} color={focusedField === field.id ? "cyan" : "yellow"}>
              {field.label}:
            </Text>
          </Box>
          <Box flexGrow={1}>
            {renderField(field.id, focusedField === field.id)}
          </Box>
        </Box>
      ))}

      <Box marginTop={1}>
        <Text dimColor>
          Tab/↓ next · Shift-Tab/↑ prev · Enter {mode === "create" ? "create" : "save"}{onSubmitAndStart ? " · Ctrl+S create & start" : ""} · Esc cancel
        </Text>
      </Box>
    </Box>
  );

  function renderField(id: string, focused: boolean) {
    switch (id) {
      case "name":
        return <TextInput value={name} onChange={setName} placeholder="Task name (required)" focus={focused} />;
      case "description":
        return <TextInput value={description} onChange={setDescription} placeholder="Description" focus={focused} multiline minHeight={5} />;
      case "criteria":
        return <TextInput value={acceptanceCriteria} onChange={setAcceptanceCriteria} placeholder="Acceptance criteria" focus={focused} multiline minHeight={5} />;
      case "dir":
        return <TextInput value={dir} onChange={setDir} placeholder={process.cwd()} focus={focused} />;
      case "worktree":
        return <SelectInput options={WORKTREE_OPTIONS} value={worktree ? "yes" : "no"} onChange={(v) => setWorktree(v === "yes")} focus={focused} />;
      case "worktreePath":
        return <TextInput value={worktreePath} onChange={setWorktreePath} placeholder={`../${basename(dir)}-${sanitizeBranchName(name || "branch-name")}`} focus={focused} />;
      case "command":
        return <SelectInput options={COMMAND_OPTIONS} value={command} onChange={(v) => setCommand(v as "shell" | "claude" | "custom")} focus={focused} />;
      case "customCommand":
        return <TextInput value={customCommand} onChange={setCustomCommand} placeholder="e.g. vim ." focus={focused} />;
      default:
        return null;
    }
  }
}
