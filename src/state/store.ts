import { readFile, readdir, mkdir } from "node:fs/promises";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { randomUUID } from "node:crypto";
import type { SessionState } from "./types.js";
import type { BoardConfig, Card } from "../board/types.js";
import { COL_DONE, DEFAULT_COMMANDS } from "../board/types.js";

const STATE_DIR = join(homedir(), ".config", "tukan");
const SESSIONS_DIR = join(STATE_DIR, "sessions");
const LEGACY_STATE_FILE = join(STATE_DIR, "state.json");

function sessionFile(sessionName: string): string {
  return join(SESSIONS_DIR, `${sessionName}.json`);
}

/** Migrate from single state.json to per-session files (one-time). */
async function migrateLegacyState(): Promise<void> {
  try {
    const data = await readFile(LEGACY_STATE_FILE, "utf-8");
    const state = JSON.parse(data) as { sessions?: Record<string, SessionState> };
    if (!state.sessions) return;
    await mkdir(SESSIONS_DIR, { recursive: true });
    for (const [name, session] of Object.entries(state.sessions)) {
      const file = sessionFile(name);
      // Don't overwrite if per-session file already exists
      try { await readFile(file); continue; } catch {}
      writeFileSync(file, JSON.stringify(session, null, 2) + "\n");
    }
    // Remove legacy file after successful migration
    const { unlink } = await import("node:fs/promises");
    await unlink(LEGACY_STATE_FILE);
  } catch {}
}

export async function readSessionState(sessionName: string): Promise<SessionState | null> {
  try {
    const data = await readFile(sessionFile(sessionName), "utf-8");
    return JSON.parse(data) as SessionState;
  } catch {
    // Fall back to legacy state.json (triggers migration)
    await migrateLegacyState();
    try {
      const data = await readFile(sessionFile(sessionName), "utf-8");
      return JSON.parse(data) as SessionState;
    } catch {
      return null;
    }
  }
}

export function writeSessionState(sessionName: string, session: SessionState): void {
  mkdirSync(SESSIONS_DIR, { recursive: true });
  writeFileSync(sessionFile(sessionName), JSON.stringify(session, null, 2) + "\n");
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

/** List all session names from the sessions directory (sorted). */
export async function listSessionNames(): Promise<string[]> {
  try {
    const entries = await readdir(SESSIONS_DIR);
    return entries
      .filter((f) => f.endsWith(".json"))
      .map((f) => f.slice(0, -5))
      .sort();
  } catch {
    return [];
  }
}

/** Read all sessions in parallel. Returns Map<sessionName, SessionState>. */
export async function readAllSessions(): Promise<Map<string, SessionState>> {
  const names = await listSessionNames();
  const results = await Promise.all(
    names.map(async (name) => {
      const state = await readSessionState(name);
      return [name, state] as const;
    }),
  );
  const map = new Map<string, SessionState>();
  for (const [name, state] of results) {
    if (state) map.set(name, state);
  }
  return map;
}
