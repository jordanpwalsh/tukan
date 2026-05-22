import { access, readFile, readdir } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { randomUUID } from "node:crypto";
import type { Card } from "../board/types.js";

export type AgentCli = "claude" | "codex";

export interface AgentLaunchPlan {
  cli: AgentCli | null;
  sessionId?: string;
  resume: boolean;
}

interface CodexSessionIndexEntry {
  id: string;
  updatedAt: number;
}

interface CodexSessionMeta {
  id?: string;
  timestamp?: string;
  cwd?: string;
}

interface CodexSessionCandidate {
  id: string;
  startedAt: number;
}

function getCodexHome(): string {
  return process.env.CODEX_HOME ?? join(homedir(), ".codex");
}

function getCodexSessionIndexPath(): string {
  return join(getCodexHome(), "session_index.jsonl");
}

function getCodexSessionsDir(): string {
  return join(getCodexHome(), "sessions");
}

function splitCommandTemplate(commandTemplate: string): { executable: string | null; rest: string } {
  const trimmed = commandTemplate.trim();
  if (!trimmed) {
    return { executable: null, rest: "" };
  }

  const match = trimmed.match(/^(\S+)(?:\s+(.*))?$/);
  if (!match) {
    return { executable: null, rest: "" };
  }

  return {
    executable: basename(match[1]),
    rest: match[2]?.trim() ?? "",
  };
}

export function detectAgentCli(commandTemplate: string, commandId?: string): AgentCli | null {
  if (commandId === "claude" || commandId === "codex") {
    return commandId;
  }

  const { executable } = splitCommandTemplate(commandTemplate);
  if (executable === "claude" || executable === "codex") {
    return executable;
  }

  return null;
}

export function planAgentLaunch(card: Card, commandTemplate: string): AgentLaunchPlan {
  const cli = detectAgentCli(commandTemplate, card.command);
  if (cli === "claude") {
    return {
      cli,
      sessionId: card.agentSessionId ?? randomUUID(),
      resume: !!card.startedAt && !!card.agentSessionId,
    };
  }

  if (cli === "codex") {
    return {
      cli,
      sessionId: card.agentSessionId,
      resume: !!card.startedAt && !!card.agentSessionId,
    };
  }

  return { cli: null, resume: false };
}

export function buildAgentCommandTemplate(
  commandTemplate: string,
  plan: AgentLaunchPlan,
): string {
  const { executable, rest } = splitCommandTemplate(commandTemplate);
  if (!executable || !plan.cli) {
    return commandTemplate;
  }

  if (plan.cli === "claude") {
    const parts = [
      executable,
      ...(plan.resume && plan.sessionId ? ["--resume", plan.sessionId] : []),
      ...(!plan.resume && plan.sessionId ? ["--session-id", plan.sessionId] : []),
      ...(rest ? [rest] : []),
    ];
    return parts.join(" ");
  }

  if (plan.cli === "codex" && plan.resume && plan.sessionId) {
    const parts = [
      executable,
      "resume",
      ...(rest ? [rest] : []),
      plan.sessionId,
    ];
    return parts.join(" ");
  }

  return commandTemplate;
}

export async function listCodexSessionIds(): Promise<Set<string>> {
  const entries = await readCodexSessionIndex();
  return new Set(entries.map((entry) => entry.id));
}

export async function detectNewCodexSessionId(
  cwd: string,
  knownIds: Set<string>,
  startedAt: number,
  timeoutMs = 5000,
): Promise<string | undefined> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() <= deadline) {
    const directMatch = await findCodexSessionFromFiles(cwd, knownIds, startedAt);
    if (directMatch) {
      return directMatch;
    }

    const entries = await readCodexSessionIndex();
    for (const entry of [...entries].reverse()) {
      if (knownIds.has(entry.id) || entry.updatedAt < startedAt - 1000) {
        continue;
      }

      const meta = await readCodexSessionMetaFromIndex(entry);
      if (meta?.cwd === cwd) {
        return entry.id;
      }
    }

    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  return undefined;
}

async function readCodexSessionIndex(): Promise<CodexSessionIndexEntry[]> {
  try {
    const raw = await readFile(getCodexSessionIndexPath(), "utf-8");
    return raw
      .split("\n")
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line) as { id: string; updated_at?: string })
      .filter((entry) => typeof entry.id === "string")
      .map((entry) => ({
        id: entry.id,
        updatedAt: entry.updated_at ? Date.parse(entry.updated_at) : 0,
      }));
  } catch {
    return [];
  }
}

async function readCodexSessionMetaFromIndex(entry: CodexSessionIndexEntry): Promise<CodexSessionMeta | null> {
  if (!entry.updatedAt || Number.isNaN(entry.updatedAt)) {
    return null;
  }

  const date = new Date(entry.updatedAt);
  const dir = join(
    getCodexSessionsDir(),
    String(date.getUTCFullYear()),
    String(date.getUTCMonth() + 1).padStart(2, "0"),
    String(date.getUTCDate()).padStart(2, "0"),
  );

  try {
    await access(dir, fsConstants.R_OK);
    const files = await readdir(dir);
    const fileName = files.find((candidate) => candidate.endsWith(`${entry.id}.jsonl`));
    if (!fileName) {
      return null;
    }

    return readCodexSessionMetaFile(join(dir, fileName));
  } catch {
    return null;
  }
}

async function findCodexSessionFromFiles(
  cwd: string,
  knownIds: Set<string>,
  startedAt: number,
): Promise<string | undefined> {
  const candidates: CodexSessionCandidate[] = [];

  for (const dir of buildRecentCodexSessionDirs(startedAt)) {
    try {
      await access(dir, fsConstants.R_OK);
      const files = await readdir(dir);
      for (const fileName of files) {
        if (!fileName.endsWith(".jsonl")) continue;

        const meta = await readCodexSessionMetaFile(join(dir, fileName));
        if (!meta?.id || !meta.cwd || meta.cwd !== cwd) continue;
        if (knownIds.has(meta.id)) continue;

        const candidateStartedAt = meta.timestamp ? Date.parse(meta.timestamp) : Number.NaN;
        if (Number.isNaN(candidateStartedAt) || candidateStartedAt < startedAt - 1000) continue;

        candidates.push({ id: meta.id, startedAt: candidateStartedAt });
      }
    } catch {
      continue;
    }
  }

  candidates.sort((a, b) => b.startedAt - a.startedAt);
  return candidates[0]?.id;
}

function buildRecentCodexSessionDirs(startedAt: number): string[] {
  const timestamps = [
    startedAt - 24 * 60 * 60 * 1000,
    startedAt,
    startedAt + 24 * 60 * 60 * 1000,
  ];
  const unique = new Set<string>();

  for (const timestamp of timestamps) {
    const date = new Date(timestamp);
    unique.add(join(
      getCodexSessionsDir(),
      String(date.getUTCFullYear()),
      String(date.getUTCMonth() + 1).padStart(2, "0"),
      String(date.getUTCDate()).padStart(2, "0"),
    ));
  }

  return [...unique];
}

async function readCodexSessionMetaFile(path: string): Promise<CodexSessionMeta | null> {
  try {
    const raw = await readFile(path, "utf-8");
    const firstLine = raw.split("\n").find((line) => line.trim().length > 0);
    if (!firstLine) {
      return null;
    }

    const parsed = JSON.parse(firstLine) as { timestamp?: string; payload?: CodexSessionMeta };
    if (!parsed.payload) {
      return null;
    }

    return {
      ...parsed.payload,
      timestamp: parsed.payload.timestamp ?? parsed.timestamp,
    };
  } catch {
    return null;
  }
}
