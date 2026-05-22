import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { defaultConfig, COL_TODO } from "../board/types.js";
import type { Card } from "../board/types.js";
import { buildNewWindowArgs } from "../tmux/create.js";
import {
  buildAgentCommandTemplate,
  detectNewCodexSessionId,
  listCodexSessionIds,
  planAgentLaunch,
} from "../agent/conversation.js";

function makeCard(overrides: Partial<Card> & { id: string }): Card {
  return {
    id: overrides.id,
    name: overrides.name ?? overrides.id,
    description: overrides.description ?? "Do the work",
    acceptanceCriteria: overrides.acceptanceCriteria ?? "",
    columnId: overrides.columnId ?? COL_TODO,
    sessionName: overrides.sessionName ?? "main",
    dir: overrides.dir ?? "/tmp/project",
    command: overrides.command ?? "shell",
    worktree: overrides.worktree ?? false,
    createdAt: overrides.createdAt ?? Date.now(),
    ...overrides,
  };
}

function writeCodexSession(
  codexHome: string,
  sessionId: string,
  updatedAt: string,
  cwd: string,
  includeIndexEntry = false,
): void {
  const date = new Date(updatedAt);
  const sessionsDir = join(
    codexHome,
    "sessions",
    String(date.getUTCFullYear()),
    String(date.getUTCMonth() + 1).padStart(2, "0"),
    String(date.getUTCDate()).padStart(2, "0"),
  );
  mkdirSync(sessionsDir, { recursive: true });

  if (includeIndexEntry) {
    const indexPath = join(codexHome, "session_index.jsonl");
    const entries = existsSync(indexPath)
      ? readFileSync(indexPath, "utf-8").split("\n").filter((line) => line.trim().length > 0)
      : [];
    entries.push(JSON.stringify({ id: sessionId, updated_at: updatedAt }));
    writeFileSync(indexPath, entries.join("\n") + "\n");
  }

  writeFileSync(
    join(sessionsDir, `rollout-${sessionId}.jsonl`),
    JSON.stringify({
      timestamp: updatedAt,
      type: "session_meta",
      payload: { id: sessionId, cwd },
    }) + "\n",
  );
}

describe("agent session flows", () => {
  let codexHome: string;
  const originalCodexHome = process.env.CODEX_HOME;

  beforeEach(() => {
    codexHome = mkdtempSync(join(tmpdir(), "tukan-codex-home-"));
    process.env.CODEX_HOME = codexHome;
  });

  afterEach(() => {
    if (originalCodexHome === undefined) {
      delete process.env.CODEX_HOME;
    } else {
      process.env.CODEX_HOME = originalCodexHome;
    }
    rmSync(codexHome, { recursive: true, force: true });
  });

  it("preserves and resumes Claude conversations across restarts", () => {
    const card = makeCard({
      id: "claude-card",
      name: "Claude task",
      command: "claude",
      description: "Fix the bug",
      dir: "/tmp/claude-project",
    });

    const firstPlan = planAgentLaunch(card, "claude --model sonnet");
    expect(firstPlan).toEqual({
      cli: "claude",
      sessionId: expect.any(String),
      resume: false,
    });

    const firstArgs = buildNewWindowArgs(
      {
        sessionName: card.sessionName,
        name: "claude-task",
        dir: card.dir,
        commandTemplate: "claude --model sonnet",
        description: card.description,
        acceptanceCriteria: card.acceptanceCriteria,
        agentLaunchPlan: firstPlan,
      },
      "myserver",
    );
    expect(firstArgs).toContain('claude --session-id ' + firstPlan.sessionId + ' --model sonnet "$@"; exec "${SHELL:-sh}"');

    const persistedCard: Card = {
      ...card,
      agentSessionId: firstPlan.sessionId,
      startedAt: Date.now(),
    };

    const restartPlan = planAgentLaunch(persistedCard, "claude --model sonnet");
    expect(restartPlan).toEqual({
      cli: "claude",
      sessionId: firstPlan.sessionId,
      resume: true,
    });

    const resumedTemplate = buildAgentCommandTemplate("claude --model sonnet", restartPlan);
    expect(resumedTemplate).toBe(`claude --resume ${firstPlan.sessionId} --model sonnet`);
  });

  it("discovers and resumes Codex conversations across restarts", async () => {
    const config = defaultConfig();
    config.commands = [{ id: "codex", label: "Codex", template: "codex --search" }];

    const card = makeCard({
      id: "codex-card",
      name: "Codex task",
      command: "codex",
      description: "Refactor auth flow",
      dir: "/tmp/codex-project",
    });
    config.cards[card.id] = card;

    const knownIds = await listCodexSessionIds();
    expect(knownIds.size).toBe(0);

    const firstPlan = planAgentLaunch(card, "codex --search");
    expect(firstPlan).toEqual({
      cli: "codex",
      sessionId: undefined,
      resume: false,
    });

    const firstArgs = buildNewWindowArgs(
      {
        sessionName: card.sessionName,
        name: "codex-task",
        dir: card.dir,
        commandTemplate: "codex --search",
        description: card.description,
        acceptanceCriteria: card.acceptanceCriteria,
        agentLaunchPlan: firstPlan,
      },
      "myserver",
    );
    expect(firstArgs).toContain('codex --search "$@"; exec "${SHELL:-sh}"');

    const updatedAt = "2026-05-09T20:00:00.000Z";
    writeCodexSession(codexHome, "codex-session-1", updatedAt, card.dir, false);

    const detectedSessionId = await detectNewCodexSessionId(
      card.dir,
      knownIds,
      Date.parse("2026-05-09T19:59:58.000Z"),
      50,
    );
    expect(detectedSessionId).toBe("codex-session-1");

    const persistedCard: Card = {
      ...card,
      agentSessionId: detectedSessionId,
      startedAt: Date.now(),
    };

    const restartPlan = planAgentLaunch(persistedCard, "codex --search");
    expect(restartPlan).toEqual({
      cli: "codex",
      sessionId: "codex-session-1",
      resume: true,
    });

    const resumedTemplate = buildAgentCommandTemplate("codex --search", restartPlan);
    expect(resumedTemplate).toBe("codex resume --search codex-session-1");
  });
});
