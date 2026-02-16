import { describe, it, expect } from "vitest";
import {
  findCards,
  resolveCard,
  createCard,
  addCardToConfig,
  markCardStarted,
  markCardStopped,
  resolveCardInConfig,
  editCardInConfig,
  columnIdFromName,
  columnNameFromId,
} from "../board/card-ops.js";
import { defaultConfig, COL_TODO, COL_IN_PROGRESS, COL_DONE } from "../board/types.js";
import type { Card, BoardConfig } from "../board/types.js";

function makeCard(overrides: Partial<Card> & { id: string }): Card {
  return {
    name: overrides.id,
    description: "",
    acceptanceCriteria: "",
    columnId: COL_TODO,
    sessionName: "main",
    dir: "/home/user",
    command: "shell",
    worktree: false,
    createdAt: Date.now(),
    ...overrides,
  };
}

function configWith(cards: Card[]): BoardConfig {
  const config = defaultConfig();
  for (const card of cards) {
    config.cards[card.id] = card;
  }
  return config;
}

describe("findCards", () => {
  const cards: Record<string, Card> = {
    "aaaa-bbbb-cccc-dddd": makeCard({ id: "aaaa-bbbb-cccc-dddd", name: "Setup CI" }),
    "eeee-ffff-1111-2222": makeCard({ id: "eeee-ffff-1111-2222", name: "Fix login bug" }),
    "eeee-ffff-3333-4444": makeCard({ id: "eeee-ffff-3333-4444", name: "Fix logout bug" }),
  };

  it("matches exact UUID", () => {
    const matches = findCards(cards, "aaaa-bbbb-cccc-dddd");
    expect(matches).toHaveLength(1);
    expect(matches[0].card.name).toBe("Setup CI");
  });

  it("matches UUID prefix", () => {
    const matches = findCards(cards, "aaaa");
    expect(matches).toHaveLength(1);
    expect(matches[0].card.name).toBe("Setup CI");
  });

  it("returns multiple UUID prefix matches when ambiguous", () => {
    const matches = findCards(cards, "eeee");
    expect(matches).toHaveLength(2);
  });

  it("matches exact name case-insensitively", () => {
    const matches = findCards(cards, "setup ci");
    expect(matches).toHaveLength(1);
    expect(matches[0].card.name).toBe("Setup CI");
  });

  it("matches partial name", () => {
    const matches = findCards(cards, "login");
    expect(matches).toHaveLength(1);
    expect(matches[0].card.name).toBe("Fix login bug");
  });

  it("returns empty for no match", () => {
    const matches = findCards(cards, "nonexistent");
    expect(matches).toHaveLength(0);
  });

  it("ignores short UUID prefixes (< 4 chars)", () => {
    const matches = findCards(cards, "aaa");
    expect(matches).toHaveLength(0);
  });

  it("prefers exact name over partial name", () => {
    const cardsWithOverlap: Record<string, Card> = {
      c1: makeCard({ id: "c1", name: "test" }),
      c2: makeCard({ id: "c2", name: "test runner" }),
    };
    const matches = findCards(cardsWithOverlap, "test");
    expect(matches).toHaveLength(1);
    expect(matches[0].card.name).toBe("test");
  });
});

describe("resolveCard", () => {
  const cards: Record<string, Card> = {
    "aaaa-bbbb": makeCard({ id: "aaaa-bbbb", name: "Setup CI" }),
    "cccc-dddd": makeCard({ id: "cccc-dddd", name: "Fix bug" }),
  };

  it("resolves a unique match", () => {
    const result = resolveCard(cards, "Setup CI");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.card.name).toBe("Setup CI");
  });

  it("errors on no match", () => {
    const result = resolveCard(cards, "nope");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("No card found");
  });

  it("errors on ambiguous match", () => {
    const ambiguousCards: Record<string, Card> = {
      c1: makeCard({ id: "c1", name: "Fix login" }),
      c2: makeCard({ id: "c2", name: "Fix logout" }),
    };
    const result = resolveCard(ambiguousCards, "Fix");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("Ambiguous");
  });
});

describe("createCard", () => {
  it("creates a card with defaults", () => {
    const card = createCard({ name: "Test card", sessionName: "main" });
    expect(card.name).toBe("Test card");
    expect(card.columnId).toBe(COL_TODO);
    expect(card.command).toBe("shell");
    expect(card.worktree).toBe(false);
    expect(card.id).toBeTruthy();
  });

  it("respects overrides", () => {
    const card = createCard({
      name: "Custom",
      sessionName: "dev",
      description: "desc",
      command: "claude",
      dir: "/tmp",
    });
    expect(card.description).toBe("desc");
    expect(card.command).toBe("claude");
    expect(card.dir).toBe("/tmp");
  });
});

describe("addCardToConfig", () => {
  it("adds card to config", () => {
    const config = defaultConfig();
    const card = makeCard({ id: "new-card", name: "New" });
    const updated = addCardToConfig(config, card);
    expect(updated.cards["new-card"]).toBeDefined();
    expect(updated.cards["new-card"].name).toBe("New");
    // Original unchanged
    expect(config.cards["new-card"]).toBeUndefined();
  });
});

describe("markCardStarted", () => {
  it("sets windowId, startedAt, and moves to in-progress", () => {
    const config = configWith([makeCard({ id: "c1", name: "Task", columnId: COL_TODO })]);
    const updated = markCardStarted(config, "c1", "@42");
    expect(updated.cards["c1"].windowId).toBe("@42");
    expect(updated.cards["c1"].startedAt).toBeDefined();
    expect(updated.cards["c1"].columnId).toBe(COL_IN_PROGRESS);
    expect(updated.cards["c1"].closedAt).toBeUndefined();
  });

  it("returns same config for missing card", () => {
    const config = defaultConfig();
    expect(markCardStarted(config, "nope", "@1")).toBe(config);
  });
});

describe("markCardStopped", () => {
  it("clears windowId and sets closedAt", () => {
    const config = configWith([
      makeCard({ id: "c1", windowId: "@42", columnId: COL_IN_PROGRESS, startedAt: Date.now() }),
    ]);
    const updated = markCardStopped(config, "c1");
    expect(updated.cards["c1"].windowId).toBeUndefined();
    expect(updated.cards["c1"].closedAt).toBeDefined();
  });
});

describe("resolveCardInConfig", () => {
  it("moves card to Done and clears window", () => {
    const config = configWith([
      makeCard({ id: "c1", windowId: "@42", columnId: COL_IN_PROGRESS }),
    ]);
    const updated = resolveCardInConfig(config, "c1");
    expect(updated.cards["c1"].columnId).toBe(COL_DONE);
    expect(updated.cards["c1"].windowId).toBeUndefined();
    expect(updated.cards["c1"].closedAt).toBeDefined();
  });
});

describe("editCardInConfig", () => {
  it("updates specified fields only", () => {
    const config = configWith([
      makeCard({ id: "c1", name: "Original", description: "old desc" }),
    ]);
    const updated = editCardInConfig(config, "c1", { name: "Renamed" });
    expect(updated.cards["c1"].name).toBe("Renamed");
    expect(updated.cards["c1"].description).toBe("old desc");
  });

  it("updates command and clears customCommand when not custom", () => {
    const config = configWith([
      makeCard({ id: "c1", command: "custom", customCommand: "vim ." }),
    ]);
    const updated = editCardInConfig(config, "c1", { command: "shell" });
    expect(updated.cards["c1"].command).toBe("shell");
    expect(updated.cards["c1"].customCommand).toBeUndefined();
  });
});

describe("columnIdFromName", () => {
  it("resolves known column names", () => {
    expect(columnIdFromName("todo")).toBe(COL_TODO);
    expect(columnIdFromName("Todo")).toBe(COL_TODO);
    expect(columnIdFromName("in progress")).toBe(COL_IN_PROGRESS);
    expect(columnIdFromName("in-progress")).toBe(COL_IN_PROGRESS);
    expect(columnIdFromName("done")).toBe(COL_DONE);
  });

  it("returns null for unknown names", () => {
    expect(columnIdFromName("unknown")).toBeNull();
  });
});

describe("columnNameFromId", () => {
  it("resolves known column IDs", () => {
    expect(columnNameFromId(COL_TODO)).toBe("Todo");
    expect(columnNameFromId(COL_IN_PROGRESS)).toBe("In Progress");
    expect(columnNameFromId(COL_DONE)).toBe("Done");
  });

  it("returns Unknown for invalid IDs", () => {
    expect(columnNameFromId("99")).toBe("Unknown");
  });
});
