import { useState } from "react";
import { Box, Text, useInput, useStdin } from "ink";
import { TextInput } from "./TextInput.js";
import { SelectInput } from "./SelectInput.js";
import { basename, join } from "node:path";
import { sanitizeBranchName } from "../tmux/create.js";
import { spawnSync } from "node:child_process";
import { writeFileSync, readFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { buildCardTemplate, parseCardTemplate } from "../board/card-template.js";
import type { CommandDef } from "../board/types.js";

interface NewCardModalProps {
  mode: "create" | "start" | "edit";
  initialValues?: { name?: string; description?: string; acceptanceCriteria?: string; dir?: string; worktree?: boolean; worktreePath?: string; command?: string; customCommand?: string; windowId?: string };
  commands: CommandDef[];
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
  command: string;
  worktree: boolean;
  worktreePath: string;
}

const WORKTREE_OPTIONS = [
  { label: "No", value: "no" },
  { label: "Yes", value: "yes" },
];

export function NewCardModal({
  mode,
  initialValues,
  commands,
  onSubmit,
  onSubmitAndStart,
  onCancel,
  width: modalWidth,
}: NewCardModalProps) {
  const commandOptions = commands.map((c) => ({ label: c.label, value: c.id }));

  // Resolve initial command: if it's "custom" (old format), use first command
  const resolveInitialCommand = () => {
    const ic = initialValues?.command;
    if (!ic || ic === "custom") return commands[0]?.id ?? "shell";
    if (commands.some((c) => c.id === ic)) return ic;
    return commands[0]?.id ?? "shell";
  };

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
  const [command, setCommand] = useState(resolveInitialCommand);
  const [worktreePath, setWorktreePath] = useState(
    initialValues?.worktreePath ?? "",
  );
  const [focusIdx, setFocusIdx] = useState(0);
  const { setRawMode } = useStdin();

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
            worktree,
            worktreePath,
          });
        } else {
          submit();
        }
        return;
      }

      // Ctrl+G to edit in vim
      if (input === "g" && key.ctrl) {
        const tmpFile = join(tmpdir(), `tukan-card-${Date.now()}.md`);
        const currentValues = {
          name, description, acceptanceCriteria, dir,
          worktree, worktreePath, command,
        };
        writeFileSync(tmpFile, buildCardTemplate(currentValues, metaOnly));

        setRawMode(false);
        spawnSync("vim", [tmpFile], { stdio: "inherit" });
        setRawMode(true);

        try {
          const content = readFileSync(tmpFile, "utf-8");
          unlinkSync(tmpFile);
          const parsed = parseCardTemplate(content, metaOnly);

          if (parsed.name !== undefined) setName(parsed.name);
          if (parsed.description !== undefined) setDescription(parsed.description);
          if (parsed.acceptanceCriteria !== undefined) setAcceptanceCriteria(parsed.acceptanceCriteria);
          if (!metaOnly) {
            if (parsed.dir !== undefined) setDir(parsed.dir);
            if (parsed.worktree !== undefined) setWorktree(parsed.worktree);
            if (parsed.worktreePath !== undefined) setWorktreePath(parsed.worktreePath);
            if (parsed.command !== undefined) setCommand(parsed.command);
          }
        } catch {
          // File was deleted or unreadable — keep current values
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
        <Box key={field.id} flexDirection="column">
          <Text bold={focusedField === field.id} color={focusedField === field.id ? "cyan" : "yellow"}>
            {field.label}:
          </Text>
          <Box marginLeft={2}>
            {renderField(field.id, focusedField === field.id)}
          </Box>
        </Box>
      ))}

      <Box marginTop={1}>
        <Text dimColor>
          Tab/↓ next · Shift-Tab/↑ prev · Enter {mode === "create" ? "create" : "save"}{onSubmitAndStart ? " · Ctrl+S create & start" : ""} · Ctrl+G vim · Esc cancel
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
        return <SelectInput options={commandOptions} value={command} onChange={(v) => setCommand(v)} focus={focused} />;
      default:
        return null;
    }
  }
}
