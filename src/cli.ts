import { Command } from "commander";
import { basename } from "node:path";
import { execFile, spawnSync } from "node:child_process";
import { promisify } from "node:util";
import { writeFileSync, readFileSync, unlinkSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getTmuxState, detectCurrentSession, execTmuxCommand, execTmuxCommandWithOutput } from "./tmux/client.js";
import { buildNewWindowArgs, buildNewSessionArgs, buildWorktreeArgs, buildSendKeysArgs, sanitizeBranchName, shouldCreateNewSession } from "./tmux/create.js";
import { readSessionState, writeSessionState, migrateConfig, readAllSessions, listSessionNames, registerSession } from "./state/store.js";
import { defaultConfig, DEFAULT_COMMANDS, COL_DONE, COL_IN_PROGRESS, COL_REVIEW } from "./board/types.js";
import { reconcileConfig } from "./board/derive.js";
import { hashContent } from "./board/activity.js";
import { detectServerName } from "./index.js";
import {
  createCard,
  addCardToConfig,
  getNewCardDefaults,
  removeCardFromConfig,
  resolveCard,
  resolveCardAcrossSessions,
  markCardStarted,
  markCardStopped,
  resolveCardInConfig,
  moveCardToColumn,
  editCardInConfig,
  updateNewCardDefaults,
  columnIdFromName,
  columnNameFromId,
  nextColumnId,
} from "./board/card-ops.js";
import { buildCardTemplate, parseCardTemplate } from "./board/card-template.js";
import { resolveSessionConnectArgs } from "./tmux/switch.js";
import type { BoardConfig, Card } from "./board/types.js";
import type { SessionState } from "./state/types.js";
import { buildResolveSteps, runResolveWorkflow, type ResolveStep } from "./worktree/resolve.js";
import { detectNewCodexSessionId, listCodexSessionIds, planAgentLaunch } from "./agent/conversation.js";

const execFileAsync = promisify(execFile);

function stepStatusPrefix(status: ResolveStep["status"]): string {
  switch (status) {
    case "running":
      return "[~]";
    case "completed":
      return "[x]";
    case "failed":
      return "[!]";
    case "skipped":
      return "[-]";
    default:
      return "[ ]";
  }
}

function printResolvePlan(steps: ResolveStep[]): void {
  console.log("Resolve steps:");
  for (const [index, step] of steps.entries()) {
    console.log(`  ${index + 1}. ${step.label}`);
  }
}

interface Context {
  serverName: string | undefined;
  sessionName: string;
  config: BoardConfig;
  workingDir: string;
}

async function loadContext(sessionFlag?: string): Promise<Context> {
  const serverName = detectServerName();
  const insideTmux = !!process.env.TMUX;
  const sessionName = sessionFlag
    ?? (insideTmux ? await detectCurrentSession(serverName) : null)
    ?? basename(process.cwd());

  const tmux = await getTmuxState(serverName, sessionName);
  const existingSession = await readSessionState(sessionName, process.cwd());
  const rawConfig = existingSession?.board
    ? migrateConfig(existingSession.board as unknown as Record<string, unknown>)
    : defaultConfig();
  const config = reconcileConfig(rawConfig, tmux);
  const workingDir = existingSession?.workingDir ?? process.cwd();

  // Auto-register session → project dir
  registerSession(sessionName, workingDir);

  return { serverName, sessionName, config, workingDir };
}

async function saveConfig(ctx: Context, config: BoardConfig): Promise<void> {
  writeSessionState(ctx.sessionName, { board: config, workingDir: ctx.workingDir });
}

/** Load all sessions' cards (migrated). */
async function loadAllSessionCards(): Promise<{
  sessions: Map<string, SessionState>;
  cardsBySession: Map<string, Record<string, Card>>;
}> {
  const sessions = await readAllSessions();
  const cardsBySession = new Map<string, Record<string, Card>>();
  for (const [name, state] of sessions) {
    const config = migrateConfig(state.board as unknown as Record<string, unknown>);
    cardsBySession.set(name, config.cards);
  }
  return { sessions, cardsBySession };
}

/** Resolve a card query, searching across sessions if needed. */
async function loadContextForCard(
  query: string,
  sessionFlag?: string,
): Promise<{ ctx: Context; id: string; card: Card } | null> {
  if (sessionFlag) {
    const ctx = await loadContext(sessionFlag);
    const result = resolveCard(ctx.config.cards, query);
    if (!result.ok) {
      console.error(result.error);
      process.exitCode = 1;
      return null;
    }
    return { ctx, id: result.id, card: result.card };
  }

  // Try auto-detected session first
  const ctx = await loadContext();
  const localResult = resolveCard(ctx.config.cards, query);
  if (localResult.ok) {
    return { ctx, id: localResult.id, card: localResult.card };
  }

  // Fall back to scanning all sessions
  const { cardsBySession } = await loadAllSessionCards();
  const result = resolveCardAcrossSessions(cardsBySession, query);
  if (!result.ok) {
    console.error(result.error);
    process.exitCode = 1;
    return null;
  }

  // Load full context for the matched session
  const matchCtx = await loadContext(result.sessionName);
  return { ctx: matchCtx, id: result.id, card: result.card };
}

/** Pure idle-check: returns idleMs if threshold exceeded, else null. */
export function checkIdle(
  lastChangeAt: number,
  now: number,
  idleTimeoutMs: number,
): number | null {
  const idleMs = now - lastChangeAt;
  return idleMs >= idleTimeoutMs ? idleMs : null;
}

function stripTrailingBlanks(raw: string): string {
  const lines = raw.split("\n");
  while (lines.length > 0 && lines[lines.length - 1].trim() === "") {
    lines.pop();
  }
  return lines.join("\n");
}

async function watchCardPane(
  serverName: string | undefined,
  windowId: string,
  cardId: string,
  cardName: string,
  json: boolean,
  idleTimeoutMs: number,
): Promise<void> {
  const POLL_MS = 500;
  let prevHash = "";
  let emittedSnapshot = false;
  let aborted = false;
  let lastChangeAt = Date.now();

  const onSignal = () => { aborted = true; };
  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);

  try {
    if (json) {
      console.log(JSON.stringify({
        type: "start",
        cardId,
        windowId,
        name: cardName,
        timestamp: Date.now(),
      }));
    }

    // Brief delay for window to initialize
    await new Promise((r) => setTimeout(r, 300));

    while (!aborted) {
      let raw: string;
      try {
        const args: string[] = [];
        if (serverName) args.push("-L", serverName);
        args.push("capture-pane", "-p", "-t", windowId);
        raw = (await execFileAsync("tmux", args)).stdout;
      } catch {
        // Window is gone
        if (json) {
          console.log(JSON.stringify({
            type: "closed",
            cardId,
            windowId,
            exitReason: "window_closed",
            timestamp: Date.now(),
          }));
        } else {
          console.log("--- closed ---");
        }
        return;
      }

      const hash = hashContent(raw);
      const now = Date.now();
      if (hash !== prevHash) {
        prevHash = hash;
        lastChangeAt = now;
        const content = stripTrailingBlanks(raw);
        if (json) {
          console.log(JSON.stringify({
            type: "snapshot",
            content,
            timestamp: now,
          }));
        } else {
          if (emittedSnapshot) console.log("---");
          console.log(content);
          emittedSnapshot = true;
        }
      } else if (json) {
        const idleMs = checkIdle(lastChangeAt, now, idleTimeoutMs);
        if (idleMs !== null) {
          console.log(JSON.stringify({
            type: "idle",
            cardId,
            windowId,
            idleMs,
            timestamp: now,
          }));
        }
      }

      await new Promise((r) => setTimeout(r, POLL_MS));
    }

    // Aborted by signal
    if (json) {
      console.log(JSON.stringify({
        type: "closed",
        cardId,
        windowId,
        exitReason: "interrupted",
        timestamp: Date.now(),
      }));
    }
  } finally {
    process.off("SIGINT", onSignal);
    process.off("SIGTERM", onSignal);
  }
}

export function createProgram(): Command {
  const program = new Command();
  program
    .name("tukan")
    .description("Kanban board for tmux windows")
    .version("0.0.1");

  program
    .command("tmux")
    .description("Connect to the tmux session for this project")
    .option("-s, --session <name>", "Session name")
    .option("--CC", "Launch tmux in control mode")
    .action(async (opts: { session?: string; CC?: boolean }) => {
      const ctx = await loadContext(opts.session);
      const tmux = await getTmuxState(ctx.serverName);
      const sessionExists = tmux.sessions.some((session) => session.name === ctx.sessionName);

      let args: string[];
      if (sessionExists) {
        const connect = resolveSessionConnectArgs(ctx.sessionName, tmux, process.env);
        args = connect.args;
      } else {
        // Create new session
        const serverArgs = ctx.serverName ? ["-L", ctx.serverName] : [];
        args = [...serverArgs, "new-session", "-s", ctx.sessionName, "-c", ctx.workingDir];
      }

      if (opts.CC) {
        args = ["-CC", ...args];
      }

      const result = spawnSync("tmux", args, { stdio: "inherit" });
      if (result.error) {
        console.error(result.error.message);
        process.exitCode = 1;
        return;
      }
      if (result.status !== 0) {
        process.exitCode = result.status ?? 1;
      }
    });

  program
    .command("add")
    .description("Create a new card in Todo")
    .argument("<name>", "Card name")
    .option("-d, --description <text>", "Card description")
    .option("--ac <text>", "Acceptance criteria")
    .option("--dir <path>", "Working directory")
    .option("--command <type>", "Command ID (e.g. shell, claude, or a custom command ID)")
    .option("--worktree", "Enable git worktree")
    .option("--worktree-path <path>", "Worktree path")
    .option("-s, --session <name>", "Session name")
    .action(async (name: string, opts: Record<string, string | boolean | undefined>) => {
      const ctx = await loadContext(opts.session as string | undefined);
      const defaults = getNewCardDefaults(ctx.config, ctx.workingDir);
      const dir = opts.dir as string | undefined ?? defaults.dir;
      const command = opts.command as string | undefined ?? defaults.command;
      const worktree = opts.worktree as boolean | undefined ?? defaults.worktree;
      const card = createCard({
        name,
        description: opts.description as string | undefined,
        acceptanceCriteria: opts.ac as string | undefined,
        dir,
        command,
        worktree,
        worktreePath: opts.worktreePath as string | undefined,
        sessionName: ctx.sessionName,
      });
      const newConfig = addCardToConfig(updateNewCardDefaults(ctx.config, { dir, command, worktree }), card);
      await saveConfig(ctx, newConfig);
      console.log(`Created card "${card.name}" (${card.id.slice(0, 8)})`);
    });

  program
    .command("start")
    .description("Start a card (create tmux window, move to In Progress)")
    .argument("<card>", "Card name or ID prefix")
    .option("-w, --wait", "Block and stream pane state changes until the window closes")
    .option("--json", "Output as JSON (NDJSON events with --wait)")
    .option("-s, --session <name>", "Session name")
    .action(async (query: string, opts: { session?: string; wait?: boolean; json?: boolean }) => {
      const resolved = await loadContextForCard(query, opts.session);
      if (!resolved) return;
      const { ctx, id, card } = resolved;

      if (card.windowId) {
        console.error(`Card "${card.name}" is already started (window ${card.windowId})`);
        process.exitCode = 1;
        return;
      }

      let dir = card.dir;
      if (card.worktree) {
        const wt = buildWorktreeArgs(card.dir, card.name, card.worktreePath);
        if (!existsSync(wt.worktreePath)) {
          try {
            await execFileAsync("git", wt.args);
          } catch {
            // Branch may already exist from a previous start — checkout existing branch
            const checkoutArgs = wt.args.filter((a) => a !== "-b");
            await execFileAsync("git", checkoutArgs);
          }
        }
        dir = wt.worktreePath;
      }

      // Look up command template
      const commands = ctx.config.commands ?? DEFAULT_COMMANDS;
      const cmdDef = commands.find((c) => c.id === card.command);
      const commandTemplate = cmdDef?.template ?? "";
      const agentLaunchPlan = planAgentLaunch(card, commandTemplate);
      const knownCodexSessionIds = agentLaunchPlan.cli === "codex" && !agentLaunchPlan.sessionId
        ? await listCodexSessionIds()
        : undefined;
      const launchStartedAt = Date.now();

      const windowOpts = {
        sessionName: card.sessionName || ctx.sessionName,
        name: sanitizeBranchName(card.name),
        dir,
        commandId: card.command,
        commandTemplate,
        description: card.description,
        acceptanceCriteria: card.acceptanceCriteria,
        agentLaunchPlan,
      };

      // Fetch unfiltered tmux state to check if target session exists
      const tmux = await getTmuxState(ctx.serverName);
      const args = shouldCreateNewSession(tmux, windowOpts.sessionName)
        ? buildNewSessionArgs(windowOpts, ctx.serverName ?? "")
        : buildNewWindowArgs(windowOpts, ctx.serverName ?? "");

      const newWindowId = await execTmuxCommandWithOutput(args);

      // Shell mode: send description lines into the new window
      if (!commandTemplate && card.description) {
        const sendKeysCommands = buildSendKeysArgs(newWindowId, card.description, ctx.serverName ?? "");
        for (const skArgs of sendKeysCommands) {
          await execTmuxCommand(skArgs);
        }
      }

      const startedConfig = markCardStarted(ctx.config, id, newWindowId);
      const agentSessionId = agentLaunchPlan.sessionId
        ?? (knownCodexSessionIds
          ? await detectNewCodexSessionId(dir, knownCodexSessionIds, launchStartedAt)
          : card.agentSessionId);
      const newConfig = agentSessionId
        ? {
            ...startedConfig,
            cards: {
              ...startedConfig.cards,
              [id]: { ...startedConfig.cards[id], agentSessionId },
            },
          }
        : startedConfig;
      await saveConfig(ctx, newConfig);

      // Output start confirmation (--wait --json defers to watchCardPane's start event)
      if (!opts.wait || !opts.json) {
        if (opts.json) {
          console.log(JSON.stringify({ cardId: id, windowId: newWindowId, name: card.name }));
        } else {
          console.log(`Started "${card.name}" → window ${newWindowId}`);
        }
      }

      if (opts.wait) {
        await watchCardPane(ctx.serverName, newWindowId, id, card.name, !!opts.json, ctx.config.idleTimeoutMs ?? 3000);
      }
    });

  program
    .command("stop")
    .description("Stop a card (kill tmux window, mark as closed)")
    .argument("<card>", "Card name or ID prefix")
    .option("-s, --session <name>", "Session name")
    .action(async (query: string, opts: { session?: string }) => {
      const resolved = await loadContextForCard(query, opts.session);
      if (!resolved) return;
      const { ctx, id, card } = resolved;

      if (card.windowId) {
        const killArgs = ctx.serverName ? ["-L", ctx.serverName] : [];
        killArgs.push("kill-window", "-t", card.windowId);
        await execTmuxCommand(killArgs).catch(() => {});
      }

      const newConfig = markCardStopped(ctx.config, id);
      await saveConfig(ctx, newConfig);
      console.log(`Stopped "${card.name}"`);
    });

  program
    .command("resolve")
    .description("Move a card to Done (kill window if live, merge worktree if enabled)")
    .argument("<card>", "Card name or ID prefix")
    .option("--no-merge", "Skip worktree merge and removal")
    .option("-f, --force", "Force resolve even with uncommitted worktree changes")
    .option("-s, --session <name>", "Session name")
    .action(async (query: string, opts: { session?: string; merge?: boolean; force?: boolean }) => {
      const resolved = await loadContextForCard(query, opts.session);
      if (!resolved) return;
      const { ctx, id, card } = resolved;
      const shouldMerge = opts.merge !== false && card.worktree;
      const plan = buildResolveSteps(!!card.windowId, shouldMerge);
      const previousStatuses = new Map<string, ResolveStep["status"]>();

      console.log(`Resolving "${card.name}"`);
      printResolvePlan(plan);

      try {
        await runResolveWorkflow({
          dir: card.dir,
          cardName: card.name,
          worktreePath: card.worktreePath,
          mergeWorktree: shouldMerge,
          windowId: card.windowId,
          force: opts.force,
          execGit: (args) => execFileAsync("git", args),
          killWindow: card.windowId
            ? async () => {
                const killArgs = ctx.serverName ? ["-L", ctx.serverName] : [];
                killArgs.push("kill-window", "-t", card.windowId!);
                await execTmuxCommand(killArgs);
              }
            : undefined,
          finalize: async () => {
            const newConfig = resolveCardInConfig(ctx.config, id);
            await saveConfig(ctx, newConfig);
          },
          onUpdate: (steps) => {
            for (const step of steps) {
              const prev = previousStatuses.get(step.id);
              if (prev === step.status) continue;
              previousStatuses.set(step.id, step.status);
              if (step.status === "pending") continue;
              const suffix = step.detail ? `: ${step.detail}` : "";
              console.log(`${stepStatusPrefix(step.status)} ${step.label}${suffix}`);
            }
          },
        });
        console.log(`Resolved "${card.name}" → Done`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`Resolve stopped: ${msg}`);
        process.exitCode = 1;
      }
    });

  program
    .command("edit")
    .description("Edit a card (opens $EDITOR if no flags given)")
    .argument("<card>", "Card name or ID prefix")
    .option("--name <name>", "New name")
    .option("-d, --description <text>", "New description")
    .option("--ac <text>", "New acceptance criteria")
    .option("--dir <path>", "New working directory")
    .option("--command <type>", "New command ID (e.g. shell, claude)")
    .option("-s, --session <name>", "Session name")
    .action(async (query: string, opts: Record<string, string | undefined>) => {
      const resolved = await loadContextForCard(query, opts.session);
      if (!resolved) return;
      const { ctx, id, card } = resolved;

      // Check if any edit flags were provided
      const editFlags = ["name", "description", "ac", "dir", "command"];
      const hasFlags = editFlags.some((f) => opts[f] !== undefined);

      if (!hasFlags) {
        // Open in $EDITOR
        const editor = process.env.EDITOR || "vim";
        const tmpFile = join(tmpdir(), `tukan-card-${Date.now()}.md`);
        const metaOnly = !!card.windowId;
        const templateValues = {
          name: card.name,
          description: card.description,
          acceptanceCriteria: card.acceptanceCriteria,
          dir: card.dir,
          worktree: card.worktree,
          worktreePath: card.worktreePath ?? "",
          command: card.command,
        };
        writeFileSync(tmpFile, buildCardTemplate(templateValues, metaOnly));
        const editorResult = spawnSync(editor, [tmpFile], { stdio: "inherit" });
        if (editorResult.status !== 0) {
          console.error("Editor exited with non-zero status, aborting.");
          process.exitCode = 1;
          return;
        }
        try {
          const content = readFileSync(tmpFile, "utf-8");
          unlinkSync(tmpFile);
          const parsed = parseCardTemplate(content, metaOnly);
          const newConfig = editCardInConfig(ctx.config, id, parsed);
          await saveConfig(ctx, newConfig);
          console.log(`Updated "${parsed.name ?? card.name}"`);
        } catch {
          console.error("Could not read edited file, aborting.");
          process.exitCode = 1;
        }
        return;
      }

      const fields: Record<string, string | undefined> = {};
      if (opts.name !== undefined) fields.name = opts.name;
      if (opts.description !== undefined) fields.description = opts.description;
      if (opts.ac !== undefined) fields.acceptanceCriteria = opts.ac;
      if (opts.dir !== undefined) fields.dir = opts.dir;
      if (opts.command !== undefined) fields.command = opts.command;

      const newConfig = editCardInConfig(ctx.config, id, fields);
      await saveConfig(ctx, newConfig);

      // Rename tmux window if live and name changed
      if (card.windowId && opts.name) {
        const renameArgs = ctx.serverName ? ["-L", ctx.serverName] : [];
        renameArgs.push("rename-window", "-t", card.windowId, opts.name);
        await execTmuxCommand(renameArgs).catch(() => {});
      }

      console.log(`Updated "${opts.name ?? card.name}"`);
    });

  program
    .command("move")
    .description("Move a card to another lane")
    .argument("<card>", "Card name or ID prefix")
    .option("--lane <name>", "Destination lane name")
    .option("-s, --session <name>", "Session name")
    .action(async (query: string, opts: { lane?: string; session?: string }) => {
      const resolved = await loadContextForCard(query, opts.session);
      if (!resolved) return;
      const { ctx, id, card } = resolved;

      const columnId = opts.lane ? columnIdFromName(opts.lane) : nextColumnId(ctx.config, card.columnId);
      if (!columnId) {
        if (opts.lane) {
          console.error(`Unknown lane "${opts.lane}". Use one of: Unassigned, Todo, In Progress, Review, Done.`);
        } else {
          console.error(`Card "${card.name}" is already in the last lane.`);
        }
        process.exitCode = 1;
        return;
      }

      if (card.columnId === columnId) {
        console.error(`Card is already in ${columnNameFromId(columnId)}.`);
        process.exitCode = 1;
        return;
      }

      const newConfig = moveCardToColumn(ctx.config, id, columnId);
      await saveConfig(ctx, newConfig);

      console.log(`Moved "${card.name}" → ${columnNameFromId(columnId)}`);
    });

  program
    .command("transfer")
    .description("Transfer a card to another session")
    .argument("<card>", "Card name or ID prefix")
    .argument("<target-session>", "Destination session name")
    .option("-s, --session <name>", "Source session name")
    .action(async (query: string, targetSession: string, opts: { session?: string }) => {
      const resolved = await loadContextForCard(query, opts.session);
      if (!resolved) return;
      const { ctx: srcCtx, id, card } = resolved;

      if (srcCtx.sessionName === targetSession) {
        console.error(`Card is already in session "${targetSession}".`);
        process.exitCode = 1;
        return;
      }

      if (card.windowId) {
        console.error(`Card "${card.name}" has a live window. Stop it first.`);
        process.exitCode = 1;
        return;
      }

      // Load the target session
      const targetState = await readSessionState(targetSession);
      if (!targetState) {
        console.error(`Session "${targetSession}" not found. Register it first with: tukan register -s ${targetSession} <path>`);
        process.exitCode = 1;
        return;
      }
      const targetConfig = migrateConfig(targetState.board as unknown as Record<string, unknown>);

      // Remove from source, add to target (update sessionName and dir)
      const movedCard: Card = { ...card, sessionName: targetSession, dir: targetState.workingDir };
      const newSrcConfig = removeCardFromConfig(srcCtx.config, id);
      const newTargetConfig = addCardToConfig(targetConfig, movedCard);

      await saveConfig(srcCtx, newSrcConfig);
      writeSessionState(targetSession, { ...targetState, board: newTargetConfig });

      console.log(`Transferred "${card.name}" → ${targetSession}`);
    });

  program
    .command("peek")
    .description("Show the current pane content of a card's tmux window")
    .argument("<card>", "Card name or ID prefix")
    .option("-n, --tail <lines>", "Show only the last N non-blank lines")
    .option("--json", "Output as JSON")
    .option("-s, --session <name>", "Session name")
    .action(async (query: string, opts: { session?: string; tail?: string; json?: boolean }) => {
      const resolved = await loadContextForCard(query, opts.session);
      if (!resolved) return;
      const { ctx, card } = resolved;

      if (!card.windowId) {
        console.error(`Card "${card.name}" has no live window. Start it first.`);
        process.exitCode = 1;
        return;
      }

      const args: string[] = [];
      if (ctx.serverName) args.push("-L", ctx.serverName);
      args.push("capture-pane", "-p", "-t", card.windowId);
      const raw = await execTmuxCommandWithOutput(args);

      let output: string;
      if (opts.tail) {
        const n = parseInt(opts.tail, 10);
        if (isNaN(n) || n <= 0) {
          console.error("--tail must be a positive number");
          process.exitCode = 1;
          return;
        }
        const lines = raw.split("\n").map((l) => l.trimEnd()).filter((l) => l.length > 0);
        output = lines.slice(-n).join("\n");
      } else {
        // Strip trailing blank lines
        const lines = raw.split("\n");
        while (lines.length > 0 && lines[lines.length - 1].trim() === "") {
          lines.pop();
        }
        output = lines.join("\n");
      }

      if (opts.json) {
        console.log(JSON.stringify({ cardId: card.id, windowId: card.windowId, content: output }, null, 2));
      } else {
        console.log(output);
      }
    });

  program
    .command("send")
    .description("Send keystrokes to a card's tmux pane")
    .argument("<card>", "Card name or ID prefix")
    .argument("<text...>", "Text to send (joined with spaces, Enter appended)")
    .option("-s, --session <name>", "Session name")
    .option("--no-enter", "Don't append Enter after the text")
    .action(async (query: string, textParts: string[], opts: { session?: string; enter?: boolean }) => {
      const resolved = await loadContextForCard(query, opts.session);
      if (!resolved) return;
      const { ctx, card } = resolved;

      if (!card.windowId) {
        console.error(`Card "${card.name}" has no live window. Start it first.`);
        process.exitCode = 1;
        return;
      }

      const text = textParts.join(" ");
      const serverArgs = ctx.serverName ? ["-L", ctx.serverName] : [];

      // Send text literally (-l) to avoid key name interpretation
      await execTmuxCommand([...serverArgs, "send-keys", "-t", card.windowId, "-l", text]);

      // Send Enter as a separate command so it's cleanly processed
      if (opts.enter !== false) {
        await execTmuxCommand([...serverArgs, "send-keys", "-t", card.windowId, "Enter"]);
      }

      console.log(`Sent to "${card.name}"`);
    });

  program
    .command("list")
    .description("List cards grouped by column")
    .option("--column <name>", "Filter to a specific column")
    .option("-a, --all", "Include Done column")
    .option("--json", "Output as JSON")
    .option("-s, --session <name>", "Session name")
    .action(async (opts: { column?: string; all?: boolean; json?: boolean; session?: string }) => {
      // Build column filter
      let filterColId: string | null = null;
      if (opts.column) {
        filterColId = columnIdFromName(opts.column);
        if (filterColId === null) {
          console.error(`Unknown column "${opts.column}". Valid: unassigned, todo, in-progress, review, done`);
          process.exitCode = 1;
          return;
        }
      }

      // Collect cards: single session (with -s) or all sessions
      type AnnotatedCard = Card & { _sessionName: string };
      const allCards: AnnotatedCard[] = [];
      let multiSession = false;
      const columns = defaultConfig().columns;

      if (opts.session) {
        const ctx = await loadContext(opts.session);
        for (const card of Object.values(ctx.config.cards)) {
          allCards.push({ ...card, _sessionName: ctx.sessionName });
        }
      } else {
        const { cardsBySession } = await loadAllSessionCards();
        multiSession = cardsBySession.size > 1;
        for (const [sessionName, cards] of cardsBySession) {
          for (const card of Object.values(cards)) {
            allCards.push({ ...card, _sessionName: sessionName });
          }
        }
      }

      // Get tmux state for live window status (all windows on the server)
      const serverName = detectServerName();
      const tmux = await getTmuxState(serverName);
      const liveWindowIds = new Set<string>();
      for (const session of tmux.sessions) {
        for (const win of session.windows) {
          liveWindowIds.add(win.id);
        }
      }

      // Group cards by column
      const columnCards = new Map<string, AnnotatedCard[]>();
      for (const col of columns) {
        columnCards.set(col.id, []);
      }

      for (const card of allCards) {
        const bucket = columnCards.get(card.columnId);
        if (bucket) bucket.push(card);
      }

      if (opts.json) {
        const result: Array<{ id: string; title: string; cards: Array<Card & { live: boolean; sessionName: string }> }> = [];
        for (const col of columns) {
          if (filterColId !== null && col.id !== filterColId) continue;
          if (col.id === COL_DONE && !opts.all && filterColId !== COL_DONE) continue;
          const cards = columnCards.get(col.id) ?? [];
          result.push({
            id: col.id,
            title: col.title,
            cards: cards.map((card) => {
              const { _sessionName, ...rest } = card;
              return {
                ...rest,
                sessionName: _sessionName,
                live: !!(card.windowId && liveWindowIds.has(card.windowId)),
              };
            }),
          });
        }
        console.log(JSON.stringify(result, null, 2));
        return;
      }

      let hasOutput = false;
      for (const col of columns) {
        if (filterColId !== null && col.id !== filterColId) continue;
        if (col.id === COL_DONE && !opts.all && filterColId !== COL_DONE) continue;
        const cards = columnCards.get(col.id) ?? [];
        if (cards.length === 0 && filterColId === null) continue;

        if (hasOutput) console.log();
        console.log(`${col.title}:`);
        hasOutput = true;

        if (cards.length === 0) {
          console.log("  (empty)");
          continue;
        }

        for (const card of cards) {
          let indicator = " ";
          if (card.windowId && liveWindowIds.has(card.windowId)) {
            indicator = "\u25CB"; // ○ — has live window
          } else if (card.startedAt && !card.windowId) {
            indicator = "\u25C7"; // ◇ — closed
          }
          const suffix = multiSession ? `  [${card._sessionName}]` : "";
          console.log(`  ${indicator} ${card.id.slice(0, 8)}  ${card.name}${suffix}`);
        }
      }

      if (!hasOutput) {
        console.log("No cards.");
      }
    });

  program
    .command("show")
    .description("Show details for a specific card")
    .argument("<card>", "Card name or ID prefix")
    .option("--json", "Output as JSON")
    .option("-s, --session <name>", "Session name")
    .action(async (query: string, opts: { json?: boolean; session?: string }) => {
      const resolved = await loadContextForCard(query, opts.session);
      if (!resolved) return;
      const { ctx, id, card } = resolved;

      // Check live status
      const tmux = await getTmuxState(ctx.serverName, ctx.sessionName);
      const liveWindowIds = new Set<string>();
      for (const session of tmux.sessions) {
        for (const win of session.windows) liveWindowIds.add(win.id);
      }
      const live = !!(card.windowId && liveWindowIds.has(card.windowId));

      const column = columnNameFromId(card.columnId);
      const commandDef = ctx.config.commands.find((c) => c.id === card.command);

      if (opts.json) {
        console.log(JSON.stringify({ ...card, column, live }, null, 2));
        return;
      }

      console.log(`Name:        ${card.name}`);
      console.log(`ID:          ${id}`);
      console.log(`Column:      ${column}`);
      console.log(`Status:      ${live ? "live" : card.startedAt && !card.windowId ? "closed" : card.startedAt ? "started" : "unstarted"}`);
      if (card.description) console.log(`Description: ${card.description}`);
      if (card.acceptanceCriteria) console.log(`AC:          ${card.acceptanceCriteria}`);
      console.log(`Dir:         ${card.dir}`);
      console.log(`Command:     ${commandDef?.label ?? card.command}${card.customCommand ? ` (${card.customCommand})` : ""}`);
      if (card.worktree) console.log(`Worktree:    ${card.worktreePath ?? "yes"}`);
      if (card.windowId) console.log(`Window ID:   ${card.windowId}`);
      console.log(`Created:     ${new Date(card.createdAt).toLocaleString()}`);
      if (card.startedAt) console.log(`Started:     ${new Date(card.startedAt).toLocaleString()}`);
      if (card.closedAt) console.log(`Closed:      ${new Date(card.closedAt).toLocaleString()}`);
    });

  program
    .command("sessions")
    .description("List tukan sessions (tmux + state files)")
    .action(async () => {
      const serverName = detectServerName();

      // Get live tmux sessions
      const tmuxSessions = new Map<string, { windows: string; attached: boolean }>();
      try {
        const args: string[] = [];
        if (serverName) args.push("-L", serverName);
        args.push("list-sessions", "-F", "#{session_name}\t#{session_windows}\t#{session_attached}");
        const { stdout } = await execFileAsync("tmux", args);
        for (const line of stdout.trim().split("\n").filter(Boolean)) {
          const [name, windows, attached] = line.split("\t");
          tmuxSessions.set(name, { windows, attached: attached === "1" });
        }
      } catch {
        // No tmux server running
      }

      // Get state file sessions with card counts
      const stateNames = await listSessionNames();
      const cardCounts = new Map<string, number>();
      for (const name of stateNames) {
        const state = await readSessionState(name);
        if (state?.board) {
          const config = migrateConfig(state.board as unknown as Record<string, unknown>);
          cardCounts.set(name, Object.keys(config.cards).length);
        }
      }

      // Merge: all session names from both sources
      const allNames = new Set([...tmuxSessions.keys(), ...stateNames]);
      if (allNames.size === 0) {
        console.log("No sessions found.");
        return;
      }

      for (const name of [...allNames].sort()) {
        const tmux = tmuxSessions.get(name);
        const cards = cardCounts.get(name) ?? 0;
        const parts: string[] = [];
        if (tmux) {
          parts.push(`${tmux.windows} window${tmux.windows === "1" ? "" : "s"}`);
          if (tmux.attached) parts.push("attached");
        } else {
          parts.push("no tmux session");
        }
        parts.push(`${cards} card${cards === 1 ? "" : "s"}`);
        console.log(`  ${name}  ${parts.join(", ")}`);
      }
    });

  program
    .command("register")
    .description("Register a project directory with a session name")
    .argument("[path]", "Project directory (defaults to cwd)")
    .option("-s, --session <name>", "Session name (defaults to directory basename)")
    .action(async (pathArg?: string, opts?: { session?: string }) => {
      const { resolve } = await import("node:path");
      const projectDir = pathArg ? resolve(pathArg) : process.cwd();
      const sessionName = opts?.session ?? basename(projectDir);
      registerSession(sessionName, projectDir);
      console.log(`Registered "${sessionName}" → ${projectDir}`);
    });

  return program;
}
