import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import { randomUUID } from "node:crypto";
import type { TukanState, SessionState } from "./types.js";
import type { BoardConfig, Card } from "../board/types.js";
import { COL_DONE, DEFAULT_COMMANDS } from "../board/types.js";

const STATE_DIR = join(homedir(), ".config", "tukan");
const STATE_FILE = join(STATE_DIR, "state.json");

async function readFullState(): Promise<TukanState> {
  try {
    const data = await readFile(STATE_FILE, "utf-8");
    return JSON.parse(data) as TukanState;
  } catch {
    return { version: 1, sessions: {} };
  }
}

async function writeFullState(state: TukanState): Promise<void> {
  await mkdir(STATE_DIR, { recursive: true });
  await writeFile(STATE_FILE, JSON.stringify(state, null, 2) + "\n");
}

export async function readSessionState(sessionName: string): Promise<SessionState | null> {
  const state = await readFullState();
  return state.sessions[sessionName] ?? null;
}

export async function writeSessionState(sessionName: string, session: SessionState): Promise<void> {
  const state = await readFullState();
  state.sessions[sessionName] = session;
  await writeFullState(state);
}

/**
 * Migrate old BoardConfig format (assignments + virtualCards + cardMeta)
 * to the new unified Card format (cards: Record<string, Card>).
 */
export function migrateConfig(raw: Record<string, unknown>): BoardConfig {
  // Already migrated
  if (raw.cards && typeof raw.cards === "object" && !Array.isArray(raw.cards) && !raw.assignments) {
    const config = raw as unknown as Omit<BoardConfig, "commands"> & { commands?: BoardConfig["commands"] };
    return ensureCommands(ensureDoneColumn({ ...config, commands: config.commands ?? DEFAULT_COMMANDS }));
  }

  const columns = (raw.columns ?? []) as BoardConfig["columns"];
  const cards: Record<string, Card> = {};

  // Migrate virtualCards
  const virtualCards = (raw.virtualCards ?? []) as Array<{
    id: string;
    columnId: string;
    name: string;
    description: string;
    acceptanceCriteria: string;
    sessionName: string;
    dir: string;
    command: "shell" | "claude" | "custom";
    customCommand?: string;
    worktree: boolean;
    worktreePath?: string;
  }>;

  for (const vc of virtualCards) {
    cards[vc.id] = {
      id: vc.id,
      name: vc.name,
      description: vc.description,
      acceptanceCriteria: vc.acceptanceCriteria,
      columnId: vc.columnId,
      sessionName: vc.sessionName,
      dir: vc.dir,
      command: vc.command,
      customCommand: vc.customCommand,
      worktree: vc.worktree,
      worktreePath: vc.worktreePath,
      createdAt: Date.now(),
    };
  }

  // Migrate assignments + cardMeta for real (started) windows
  const assignments = (raw.assignments ?? {}) as Record<string, string>;
  const cardMeta = (raw.cardMeta ?? {}) as Record<string, { description: string; acceptanceCriteria: string }>;

  for (const [windowId, columnId] of Object.entries(assignments)) {
    const meta = cardMeta[windowId];
    const id = randomUUID();
    cards[id] = {
      id,
      name: windowId, // best we have; tmux will supply the real name at runtime
      description: meta?.description ?? "",
      acceptanceCriteria: meta?.acceptanceCriteria ?? "",
      columnId,
      sessionName: "",
      dir: "",
      command: "shell",
      worktree: false,
      windowId,
      createdAt: Date.now(),
      startedAt: Date.now(),
    };
  }

  return ensureCommands(ensureDoneColumn({ columns, cards, commands: DEFAULT_COMMANDS }));
}

/** Ensure the Done column exists (for configs created before it was added). */
function ensureDoneColumn(config: BoardConfig): BoardConfig {
  if (config.columns.some((c) => c.id === COL_DONE)) return config;
  return {
    ...config,
    columns: [...config.columns, { id: COL_DONE, title: "Done" }],
  };
}

/** Ensure commands array exists and migrate old "custom" cards. */
function ensureCommands(config: BoardConfig): BoardConfig {
  let commands = config.commands;
  if (!commands || commands.length === 0) {
    commands = [...DEFAULT_COMMANDS];
  }

  let cards = config.cards;
  let changed = false;

  for (const [cardId, card] of Object.entries(cards)) {
    if (card.command === "custom" && card.customCommand) {
      // Find or create a CommandDef for this custom command
      const existing = commands.find((c) => c.template === card.customCommand);
      if (existing) {
        if (!changed) { cards = { ...cards }; changed = true; }
        cards[cardId] = { ...card, command: existing.id, customCommand: undefined };
      } else {
        const id = `cmd-${card.customCommand.replace(/[^a-z0-9]/gi, "-").toLowerCase().slice(0, 16)}`;
        if (!commands.find((c) => c.id === id)) {
          commands = [...commands, { id, label: card.customCommand, template: card.customCommand }];
        }
        if (!changed) { cards = { ...cards }; changed = true; }
        cards[cardId] = { ...card, command: id, customCommand: undefined };
      }
    }
  }

  if (commands !== config.commands || changed) {
    return { ...config, commands, cards };
  }
  return config;
}
