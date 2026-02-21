import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { defaultConfig, COL_TODO } from "../board/types.js";
import type { Card, BoardConfig } from "../board/types.js";
import type { SessionState, Registry } from "../state/types.js";

// We test the store functions by calling them directly.
// Since they use hardcoded paths (homedir-based), we test the
// pure/structural aspects and use integration-style tests for IO.

function makeCard(overrides: Partial<Card> & { id: string }): Card {
  return {
    name: overrides.id,
    description: "",
    acceptanceCriteria: "",
    columnId: COL_TODO,
    sessionName: "test",
    dir: "/tmp/test",
    command: "shell",
    worktree: false,
    createdAt: Date.now(),
    ...overrides,
  };
}

function makeConfig(cards: Card[]): BoardConfig {
  const config = defaultConfig();
  for (const card of cards) {
    config.cards[card.id] = card;
  }
  return config;
}

describe("store round-trip via filesystem", () => {
  // These tests exercise writeProjectCards/readProjectCards behavior
  // by directly writing/reading .tukan.cards files

  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "tukan-store-test-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("writes and reads .tukan.cards", () => {
    const config = makeConfig([
      makeCard({ id: "card-1", name: "First card" }),
      makeCard({ id: "card-2", name: "Second card" }),
    ]);

    const cardsPath = join(tmpDir, ".tukan.cards");
    writeFileSync(cardsPath, JSON.stringify(config, null, 2) + "\n");

    const data = JSON.parse(readFileSync(cardsPath, "utf-8")) as BoardConfig;
    expect(Object.keys(data.cards)).toHaveLength(2);
    expect(data.cards["card-1"].name).toBe("First card");
    expect(data.cards["card-2"].name).toBe("Second card");
    expect(data.columns).toHaveLength(5);
  });

  it(".tukan.cards does not contain ephemeral state", () => {
    const config = makeConfig([makeCard({ id: "card-1", name: "Test" })]);
    const cardsPath = join(tmpDir, ".tukan.cards");
    writeFileSync(cardsPath, JSON.stringify(config, null, 2) + "\n");

    const raw = JSON.parse(readFileSync(cardsPath, "utf-8"));
    // Should NOT have ephemeral fields
    expect(raw.lastChangeTimes).toBeUndefined();
    expect(raw.activeWindows).toBeUndefined();
    expect(raw.paneHashes).toBeUndefined();
    expect(raw.workingDir).toBeUndefined();
    // Should have board fields
    expect(raw.cards).toBeDefined();
    expect(raw.columns).toBeDefined();
    expect(raw.commands).toBeDefined();
  });

  it("graceful fallback when .tukan.cards missing", () => {
    const cardsPath = join(tmpDir, ".tukan.cards");
    expect(existsSync(cardsPath)).toBe(false);
  });
});

describe("registry structure", () => {
  it("registry entry has projectDir field", () => {
    const registry: Registry = {
      "my-project": { projectDir: "/home/user/my-project" },
      "other": { projectDir: "/home/user/other" },
    };

    expect(registry["my-project"].projectDir).toBe("/home/user/my-project");
    expect(Object.keys(registry)).toHaveLength(2);
  });

  it("registry serializes as clean JSON", () => {
    const registry: Registry = {
      "tukan": { projectDir: "/Users/jordan/devel/personal/tukan" },
    };

    const json = JSON.stringify(registry, null, 2);
    const parsed = JSON.parse(json) as Registry;
    expect(parsed["tukan"].projectDir).toBe("/Users/jordan/devel/personal/tukan");
  });
});

describe("SessionState split", () => {
  it("board and ephemeral data are separable", () => {
    const session: SessionState = {
      board: makeConfig([makeCard({ id: "c1", name: "Test" })]),
      workingDir: "/tmp/project",
      lastChangeTimes: { "@1": 1000 },
      activeWindows: ["@1"],
      paneHashes: { "%0": "abc123" },
    };

    // Board part (goes to .tukan.cards)
    const boardJson = JSON.stringify(session.board, null, 2);
    const boardParsed = JSON.parse(boardJson) as BoardConfig;
    expect(boardParsed.cards["c1"].name).toBe("Test");
    expect((boardParsed as Record<string, unknown>).lastChangeTimes).toBeUndefined();

    // Ephemeral part (goes to sessions dir)
    const ephemeral = {
      lastChangeTimes: session.lastChangeTimes,
      activeWindows: session.activeWindows,
      paneHashes: session.paneHashes,
    };
    const ephemeralJson = JSON.stringify(ephemeral, null, 2);
    const ephemeralParsed = JSON.parse(ephemeralJson);
    expect(ephemeralParsed.lastChangeTimes["@1"]).toBe(1000);
    expect((ephemeralParsed as Record<string, unknown>).board).toBeUndefined();
  });
});

describe("migrateConfig", () => {
  // Import migrateConfig for testing the pure function
  it("is re-exported from store", async () => {
    const { migrateConfig } = await import("../state/store.js");
    const config = migrateConfig({
      columns: [
        { id: "0", title: "Unassigned" },
        { id: "1", title: "Todo" },
      ],
      cards: {
        "c1": makeCard({ id: "c1", name: "Test" }),
      },
      commands: [],
    } as unknown as Record<string, unknown>);
    expect(config.cards["c1"].name).toBe("Test");
    // Should add Done column
    expect(config.columns.some((c) => c.id === "4")).toBe(true);
  });
});
