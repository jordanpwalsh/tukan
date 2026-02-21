import { readFile, readdir, mkdir } from "node:fs/promises";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { randomUUID } from "node:crypto";
import type { SessionState, EphemeralState, Registry } from "./types.js";
import type { BoardConfig, Card } from "../board/types.js";
import { COL_DONE, DEFAULT_COMMANDS } from "../board/types.js";

const STATE_DIR = join(homedir(), ".config", "tukan");
const SESSIONS_DIR = join(STATE_DIR, "sessions");
const REGISTRY_FILE = join(STATE_DIR, "registry.json");
const LEGACY_STATE_FILE = join(STATE_DIR, "state.json");
const PROJECT_CARDS_FILENAME = ".tukan.cards";

function sessionFile(sessionName: string): string {
  return join(SESSIONS_DIR, `${sessionName}.json`);
}

// ---------------------------------------------------------------------------
// Registry (session name → project directory)
// ---------------------------------------------------------------------------

export function readRegistry(): Registry {
  try {
    return JSON.parse(readFileSync(REGISTRY_FILE, "utf-8")) as Registry;
  } catch {
    return {};
  }
}

export function writeRegistry(registry: Registry): void {
  mkdirSync(STATE_DIR, { recursive: true });
  writeFileSync(REGISTRY_FILE, JSON.stringify(registry, null, 2) + "\n");
}

export function registerSession(sessionName: string, projectDir: string): void {
  const registry = readRegistry();
  if (registry[sessionName]?.projectDir === projectDir) return; // already current
  registry[sessionName] = { projectDir };
  writeRegistry(registry);
}

export function lookupProjectDir(sessionName: string): string | null {
  return readRegistry()[sessionName]?.projectDir ?? null;
}

export function listRegisteredSessions(): string[] {
  return Object.keys(readRegistry()).sort();
}

// ---------------------------------------------------------------------------
// Project-local cards (<projectDir>/.tukan.cards)
// ---------------------------------------------------------------------------

function projectCardsPath(projectDir: string): string {
  return join(projectDir, PROJECT_CARDS_FILENAME);
}

async function readProjectCards(projectDir: string): Promise<BoardConfig | null> {
  try {
    const data = await readFile(projectCardsPath(projectDir), "utf-8");
    const raw = JSON.parse(data);
    return migrateConfig(raw as Record<string, unknown>);
  } catch {
    return null;
  }
}

function writeProjectCards(projectDir: string, board: BoardConfig): void {
  writeFileSync(projectCardsPath(projectDir), JSON.stringify(board, null, 2) + "\n");
}

// ---------------------------------------------------------------------------
// Ephemeral state (~/.config/tukan/sessions/{name}.json — runtime only)
// ---------------------------------------------------------------------------

async function readEphemeralState(sessionName: string): Promise<EphemeralState> {
  try {
    const data = await readFile(sessionFile(sessionName), "utf-8");
    const parsed = JSON.parse(data);
    // Distinguish new ephemeral format (no 'board' key) from legacy
    if (parsed.board) return {};
    return parsed as EphemeralState;
  } catch {
    return {};
  }
}

function writeEphemeralState(sessionName: string, state: EphemeralState): void {
  mkdirSync(SESSIONS_DIR, { recursive: true });
  writeFileSync(sessionFile(sessionName), JSON.stringify(state, null, 2) + "\n");
}

// ---------------------------------------------------------------------------
// Legacy support
// ---------------------------------------------------------------------------

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

/** Read from old-format session file (has 'board' key). */
async function readLegacySessionState(sessionName: string): Promise<SessionState | null> {
  try {
    const data = await readFile(sessionFile(sessionName), "utf-8");
    const raw = JSON.parse(data);
    if (raw.board) return raw as SessionState;
    return null;
  } catch {
    // Try the ancient single state.json migration
    await migrateLegacyState();
    try {
      const data = await readFile(sessionFile(sessionName), "utf-8");
      const raw = JSON.parse(data);
      if (raw.board) return raw as SessionState;
      return null;
    } catch {
      return null;
    }
  }
}

/** Lazy-migrate a legacy session to project-local .tukan.cards. */
function lazyMigrate(sessionName: string, legacy: SessionState): SessionState {
  const board = migrateConfig(legacy.board as unknown as Record<string, unknown>);
  const projectDir = legacy.workingDir;

  // Write project-local cards
  if (projectDir && existsSync(projectDir)) {
    writeProjectCards(projectDir, board);
  }

  // Overwrite legacy session file with ephemeral-only state
  writeEphemeralState(sessionName, {
    lastChangeTimes: legacy.lastChangeTimes,
    activeWindows: legacy.activeWindows,
    paneHashes: legacy.paneHashes,
  });

  // Register in registry
  if (projectDir) {
    registerSession(sessionName, projectDir);
  }

  return {
    board,
    workingDir: projectDir,
    lastChangeTimes: legacy.lastChangeTimes,
    activeWindows: legacy.activeWindows,
    paneHashes: legacy.paneHashes,
  };
}

// ---------------------------------------------------------------------------
// Public API (signatures preserved for backward compat)
// ---------------------------------------------------------------------------

/**
 * Read session state from split storage.
 * Chain: registry → .tukan.cards → legacy fallback → lazy migrate.
 * Optional cwd enables "cloned repo" detection.
 */
export async function readSessionState(
  sessionName: string,
  cwd?: string,
): Promise<SessionState | null> {
  let projectDir = lookupProjectDir(sessionName);

  // If not in registry, check if cwd has .tukan.cards (cloned repo scenario)
  if (!projectDir && cwd) {
    const localCards = await readProjectCards(cwd);
    if (localCards) {
      registerSession(sessionName, cwd);
      const ephemeral = await readEphemeralState(sessionName);
      return { board: localCards, workingDir: cwd, ...ephemeral };
    }
  }

  // Try legacy session file for lazy migration
  if (!projectDir) {
    const legacy = await readLegacySessionState(sessionName);
    if (legacy) return lazyMigrate(sessionName, legacy);
    return null;
  }

  // Read project-local cards
  const board = await readProjectCards(projectDir);
  if (!board) {
    // Registry points here but no .tukan.cards — check legacy fallback
    const legacy = await readLegacySessionState(sessionName);
    if (legacy) return lazyMigrate(sessionName, legacy);
    return null;
  }

  const ephemeral = await readEphemeralState(sessionName);
  return { board, workingDir: projectDir, ...ephemeral };
}

/**
 * Write session state: board → .tukan.cards, ephemeral → sessions dir, upsert registry.
 */
export function writeSessionState(sessionName: string, session: SessionState): void {
  // Write project-local cards
  writeProjectCards(session.workingDir, session.board);

  // Write ephemeral state
  writeEphemeralState(sessionName, {
    lastChangeTimes: session.lastChangeTimes,
    activeWindows: session.activeWindows,
    paneHashes: session.paneHashes,
  });

  // Ensure registered
  registerSession(sessionName, session.workingDir);
}

// ---------------------------------------------------------------------------
// BoardConfig migration (pure function — unchanged)
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Session listing (merges registry + legacy)
// ---------------------------------------------------------------------------

/** List all session names (registry keys + any legacy session files). */
export async function listSessionNames(): Promise<string[]> {
  const registeredNames = listRegisteredSessions();

  // Also scan sessions dir for legacy files not yet migrated
  let legacyNames: string[] = [];
  try {
    const entries = await readdir(SESSIONS_DIR);
    legacyNames = entries
      .filter((f) => f.endsWith(".json"))
      .map((f) => f.slice(0, -5));
  } catch {}

  const all = new Set([...registeredNames, ...legacyNames]);
  return [...all].sort();
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
