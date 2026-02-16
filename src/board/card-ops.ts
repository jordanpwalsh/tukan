import { randomUUID } from "node:crypto";
import type { BoardConfig, Card } from "./types.js";
import { COL_UNASSIGNED, COL_TODO, COL_IN_PROGRESS, COL_REVIEW, COL_DONE } from "./types.js";

export interface CardMatch {
  id: string;
  card: Card;
}

export type ResolveResult =
  | { ok: true; id: string; card: Card }
  | { ok: false; error: string };

/** Find cards matching a query (UUID, UUID prefix, or name). */
export function findCards(cards: Record<string, Card>, query: string): CardMatch[] {
  // Exact UUID match
  if (cards[query]) {
    return [{ id: query, card: cards[query] }];
  }

  // UUID prefix match
  const prefixMatches: CardMatch[] = [];
  for (const [id, card] of Object.entries(cards)) {
    if (id.startsWith(query) && query.length >= 4) {
      prefixMatches.push({ id, card });
    }
  }
  if (prefixMatches.length > 0) return prefixMatches;

  // Name match: exact case-insensitive first, then partial
  const lower = query.toLowerCase();
  const exactName: CardMatch[] = [];
  const partialName: CardMatch[] = [];
  for (const [id, card] of Object.entries(cards)) {
    if (card.name.toLowerCase() === lower) {
      exactName.push({ id, card });
    } else if (card.name.toLowerCase().includes(lower)) {
      partialName.push({ id, card });
    }
  }

  if (exactName.length > 0) return exactName;
  if (partialName.length > 0) return partialName;

  return [];
}

/** Resolve a query to exactly one card, or return an error. */
export function resolveCard(cards: Record<string, Card>, query: string): ResolveResult {
  const matches = findCards(cards, query);
  if (matches.length === 0) {
    return { ok: false, error: `No card found matching "${query}"` };
  }
  if (matches.length > 1) {
    const names = matches.map((m) => `  ${m.id.slice(0, 8)} ${m.card.name}`).join("\n");
    return { ok: false, error: `Ambiguous match for "${query}" — multiple cards found:\n${names}` };
  }
  return { ok: true, id: matches[0].id, card: matches[0].card };
}

export interface AddCardOpts {
  name: string;
  description?: string;
  acceptanceCriteria?: string;
  dir?: string;
  command?: string;
  customCommand?: string;
  worktree?: boolean;
  worktreePath?: string;
  sessionName: string;
}

/** Create a new Card record (does not add to config). */
export function createCard(opts: AddCardOpts): Card {
  return {
    id: randomUUID(),
    name: opts.name,
    description: opts.description ?? "",
    acceptanceCriteria: opts.acceptanceCriteria ?? "",
    columnId: COL_TODO,
    sessionName: opts.sessionName,
    dir: opts.dir ?? process.cwd(),
    command: opts.command ?? "shell",
    customCommand: opts.customCommand,
    worktree: opts.worktree ?? false,
    worktreePath: opts.worktree ? opts.worktreePath : undefined,
    createdAt: Date.now(),
  };
}

/** Add a card to a config, returning a new config. */
export function addCardToConfig(config: BoardConfig, card: Card): BoardConfig {
  return { ...config, cards: { ...config.cards, [card.id]: card } };
}

/** Mark a card as started (set windowId, startedAt, move to in-progress). */
export function markCardStarted(config: BoardConfig, cardId: string, windowId: string): BoardConfig {
  const card = config.cards[cardId];
  if (!card) return config;
  return {
    ...config,
    cards: {
      ...config.cards,
      [cardId]: { ...card, windowId, startedAt: Date.now(), columnId: COL_IN_PROGRESS, closedAt: undefined },
    },
  };
}

/** Mark a card as stopped (clear windowId, set closedAt). */
export function markCardStopped(config: BoardConfig, cardId: string): BoardConfig {
  const card = config.cards[cardId];
  if (!card) return config;
  return {
    ...config,
    cards: {
      ...config.cards,
      [cardId]: { ...card, windowId: undefined, closedAt: Date.now() },
    },
  };
}

/** Move a card to Done, clear windowId, set closedAt. */
export function resolveCardInConfig(config: BoardConfig, cardId: string): BoardConfig {
  const card = config.cards[cardId];
  if (!card) return config;
  return {
    ...config,
    cards: {
      ...config.cards,
      [cardId]: { ...card, columnId: COL_DONE, windowId: undefined, closedAt: Date.now() },
    },
  };
}

export interface EditCardFields {
  name?: string;
  description?: string;
  acceptanceCriteria?: string;
  dir?: string;
  command?: string;
  customCommand?: string;
  worktree?: boolean;
  worktreePath?: string;
}

/** Edit card fields, returning a new config. */
export function editCardInConfig(config: BoardConfig, cardId: string, fields: EditCardFields): BoardConfig {
  const card = config.cards[cardId];
  if (!card) return config;
  const updated: Card = { ...card };
  if (fields.name !== undefined) updated.name = fields.name;
  if (fields.description !== undefined) updated.description = fields.description;
  if (fields.acceptanceCriteria !== undefined) updated.acceptanceCriteria = fields.acceptanceCriteria;
  if (fields.dir !== undefined) updated.dir = fields.dir;
  if (fields.command !== undefined) {
    updated.command = fields.command;
    updated.customCommand = fields.customCommand;
  }
  if (fields.worktree !== undefined) {
    updated.worktree = fields.worktree;
    updated.worktreePath = fields.worktree ? fields.worktreePath : undefined;
  }
  return { ...config, cards: { ...config.cards, [cardId]: updated } };
}

const COLUMN_NAME_MAP: Record<string, string> = {
  unassigned: COL_UNASSIGNED,
  todo: COL_TODO,
  "in progress": COL_IN_PROGRESS,
  "in-progress": COL_IN_PROGRESS,
  inprogress: COL_IN_PROGRESS,
  review: COL_REVIEW,
  done: COL_DONE,
};

/** Resolve a column name (case-insensitive) to its ID. */
export function columnIdFromName(name: string): string | null {
  return COLUMN_NAME_MAP[name.toLowerCase()] ?? null;
}

const COLUMN_ID_MAP: Record<string, string> = {
  [COL_UNASSIGNED]: "Unassigned",
  [COL_TODO]: "Todo",
  [COL_IN_PROGRESS]: "In Progress",
  [COL_REVIEW]: "Review",
  [COL_DONE]: "Done",
};

/** Get display name from column ID. */
export function columnNameFromId(id: string): string {
  return COLUMN_ID_MAP[id] ?? "Unknown";
}
