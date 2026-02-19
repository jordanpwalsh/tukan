import { Command } from "commander";
import { basename } from "node:path";
import { execFile, spawnSync } from "node:child_process";
import { promisify } from "node:util";
import { writeFileSync, readFileSync, unlinkSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getTmuxState, detectCurrentSession, execTmuxCommand, execTmuxCommandWithOutput } from "./tmux/client.js";
import { buildNewWindowArgs, buildNewSessionArgs, buildWorktreeArgs, buildWorktreeMergeArgs, buildWorktreeRemoveArgs, buildSendKeysArgs, sanitizeBranchName } from "./tmux/create.js";
import { readSessionState, writeSessionState, migrateConfig } from "./state/store.js";
import { defaultConfig, DEFAULT_COMMANDS, COL_DONE, COL_IN_PROGRESS, COL_REVIEW } from "./board/types.js";
import { reconcileConfig } from "./board/derive.js";
import { getIdlePromotions, getReviewDemotionsByTime, IDLE_PROMOTE_MS } from "./board/activity.js";
import { detectServerName } from "./index.js";
import {
  createCard,
  addCardToConfig,
  resolveCard,
  markCardStarted,
  markCardStopped,
  resolveCardInConfig,
  editCardInConfig,
  columnIdFromName,
} from "./board/card-ops.js";
import { buildCardTemplate, parseCardTemplate } from "./board/card-template.js";
import type { BoardConfig, Card } from "./board/types.js";

const execFileAsync = promisify(execFile);

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
  const existingSession = await readSessionState(sessionName);
  const rawConfig = existingSession?.board
    ? migrateConfig(existingSession.board as unknown as Record<string, unknown>)
    : defaultConfig();
  const config = reconcileConfig(rawConfig, tmux);
  const workingDir = existingSession?.workingDir ?? process.cwd();

  return { serverName, sessionName, config, workingDir };
}

async function saveConfig(ctx: Context, config: BoardConfig): Promise<void> {
  writeSessionState(ctx.sessionName, { board: config, workingDir: ctx.workingDir });
}

export function createProgram(): Command {
  const program = new Command();
  program
    .name("tukan")
    .description("Kanban board for tmux windows")
    .version("0.0.1");

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
      const card = createCard({
        name,
        description: opts.description as string | undefined,
        acceptanceCriteria: opts.ac as string | undefined,
        dir: opts.dir as string | undefined ?? ctx.workingDir,
        command: opts.command as string | undefined,
        worktree: opts.worktree as boolean | undefined,
        worktreePath: opts.worktreePath as string | undefined,
        sessionName: ctx.sessionName,
      });
      const newConfig = addCardToConfig(ctx.config, card);
      await saveConfig(ctx, newConfig);
      console.log(`Created card "${card.name}" (${card.id.slice(0, 8)})`);
    });

  program
    .command("start")
    .description("Start a card (create tmux window, move to In Progress)")
    .argument("<card>", "Card name or ID prefix")
    .option("-s, --session <name>", "Session name")
    .action(async (query: string, opts: { session?: string }) => {
      const ctx = await loadContext(opts.session);
      const result = resolveCard(ctx.config.cards, query);
      if (!result.ok) {
        console.error(result.error);
        process.exitCode = 1;
        return;
      }
      const { id, card } = result;

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

      const windowOpts = {
        sessionName: card.sessionName || ctx.sessionName,
        name: sanitizeBranchName(card.name),
        dir,
        commandTemplate,
        description: card.description,
        acceptanceCriteria: card.acceptanceCriteria,
      };

      const tmux = await getTmuxState(ctx.serverName, ctx.sessionName);
      const hasServer = tmux.sessions.length > 0;
      const args = hasServer
        ? buildNewWindowArgs(windowOpts, ctx.serverName ?? "")
        : buildNewSessionArgs(windowOpts, ctx.serverName ?? "");

      const newWindowId = await execTmuxCommandWithOutput(args);

      // Shell mode: send description lines into the new window
      if (!commandTemplate && card.description) {
        const sendKeysCommands = buildSendKeysArgs(newWindowId, card.description, ctx.serverName ?? "");
        for (const skArgs of sendKeysCommands) {
          await execTmuxCommand(skArgs);
        }
      }

      const newConfig = markCardStarted(ctx.config, id, newWindowId);
      await saveConfig(ctx, newConfig);
      console.log(`Started "${card.name}" → window ${newWindowId}`);
    });

  program
    .command("stop")
    .description("Stop a card (kill tmux window, mark as closed)")
    .argument("<card>", "Card name or ID prefix")
    .option("-s, --session <name>", "Session name")
    .action(async (query: string, opts: { session?: string }) => {
      const ctx = await loadContext(opts.session);
      const result = resolveCard(ctx.config.cards, query);
      if (!result.ok) {
        console.error(result.error);
        process.exitCode = 1;
        return;
      }
      const { id, card } = result;

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
      const ctx = await loadContext(opts.session);
      const result = resolveCard(ctx.config.cards, query);
      if (!result.ok) {
        console.error(result.error);
        process.exitCode = 1;
        return;
      }
      const { id, card } = result;
      const shouldMerge = opts.merge !== false && card.worktree;

      // Check for uncommitted changes in the worktree
      if (shouldMerge) {
        const wt = buildWorktreeArgs(card.dir, card.name, card.worktreePath);
        try {
          const { stdout } = await execFileAsync("git", ["-C", wt.worktreePath, "status", "--porcelain"]);
          if (stdout.trim()) {
            if (!opts.force) {
              console.error(`Worktree has uncommitted changes. Commit or stash first, or use --force to resolve anyway.`);
              process.exitCode = 1;
              return;
            }
            console.warn(`Warning: resolving with uncommitted worktree changes (--force)`);
          }
        } catch {
          // Worktree path may not exist — skip check
        }
      }

      if (card.windowId) {
        const killArgs = ctx.serverName ? ["-L", ctx.serverName] : [];
        killArgs.push("kill-window", "-t", card.windowId);
        await execTmuxCommand(killArgs).catch(() => {});
      }

      // Merge worktree branch and remove worktree
      if (shouldMerge) {
        try {
          const branch = sanitizeBranchName(card.name);
          const wt = buildWorktreeArgs(card.dir, card.name, card.worktreePath);
          const removeArgs = buildWorktreeRemoveArgs(card.dir, wt.worktreePath);
          await execFileAsync("git", removeArgs);
          const mergeSteps = buildWorktreeMergeArgs(card.dir, branch);
          for (const step of mergeSteps) {
            await execFileAsync("git", step);
          }
          console.log(`Merged branch "${branch}" and removed worktree`);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.warn(`Warning: worktree cleanup failed: ${msg}`);
        }
      }

      const newConfig = resolveCardInConfig(ctx.config, id);
      await saveConfig(ctx, newConfig);
      console.log(`Resolved "${card.name}" → Done`);
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
      const ctx = await loadContext(opts.session);
      const result = resolveCard(ctx.config.cards, query);
      if (!result.ok) {
        console.error(result.error);
        process.exitCode = 1;
        return;
      }
      const { id, card } = result;

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
    .command("peek")
    .description("Show the current pane content of a card's tmux window")
    .argument("<card>", "Card name or ID prefix")
    .option("-n, --tail <lines>", "Show only the last N non-blank lines")
    .option("--json", "Output as JSON")
    .option("-s, --session <name>", "Session name")
    .action(async (query: string, opts: { session?: string; tail?: string; json?: boolean }) => {
      const ctx = await loadContext(opts.session);
      const result = resolveCard(ctx.config.cards, query);
      if (!result.ok) {
        console.error(result.error);
        process.exitCode = 1;
        return;
      }
      const { card } = result;

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
      const ctx = await loadContext(opts.session);
      const result = resolveCard(ctx.config.cards, query);
      if (!result.ok) {
        console.error(result.error);
        process.exitCode = 1;
        return;
      }
      const { card } = result;

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
      const ctx = await loadContext(opts.session);
      const { config } = ctx;

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

      // Get tmux state for live window status
      const tmux = await getTmuxState(ctx.serverName, ctx.sessionName);
      const liveWindowIds = new Set<string>();
      for (const session of tmux.sessions) {
        for (const win of session.windows) {
          liveWindowIds.add(win.id);
        }
      }

      // Group cards by column
      const columnCards = new Map<string, Card[]>();
      for (const col of config.columns) {
        columnCards.set(col.id, []);
      }

      for (const card of Object.values(config.cards)) {
        const colId = card.columnId;
        const bucket = columnCards.get(colId);
        if (bucket) bucket.push(card);
      }

      if (opts.json) {
        const result: Array<{ id: string; title: string; cards: Array<Card & { live: boolean }> }> = [];
        for (const col of config.columns) {
          if (filterColId !== null && col.id !== filterColId) continue;
          if (col.id === COL_DONE && !opts.all && filterColId !== COL_DONE) continue;
          const cards = columnCards.get(col.id) ?? [];
          result.push({
            id: col.id,
            title: col.title,
            cards: cards.map((card) => ({
              ...card,
              live: !!(card.windowId && liveWindowIds.has(card.windowId)),
            })),
          });
        }
        console.log(JSON.stringify(result, null, 2));
        return;
      }

      let hasOutput = false;
      for (const col of config.columns) {
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
          console.log(`  ${indicator} ${card.id.slice(0, 8)}  ${card.name}`);
        }
      }

      if (!hasOutput) {
        console.log("No cards.");
      }
    });

  program
    .command("refresh")
    .description("Update board state (reconcile windows, promote idle cards) and exit")
    .option("-s, --session <name>", "Session name")
    .action(async (opts: { session?: string }) => {
      const ctx = await loadContext(opts.session);
      const existingSession = await readSessionState(ctx.sessionName);
      const lastChangeTimes = existingSession?.lastChangeTimes ?? {};

      const now = Date.now();

      // Promote idle in-progress cards to review
      const idlePromotions = getIdlePromotions(ctx.config.cards, lastChangeTimes, now, IDLE_PROMOTE_MS);
      // Demote active review cards back to in-progress
      const reviewDemotions = getReviewDemotionsByTime(ctx.config.cards, lastChangeTimes, now, IDLE_PROMOTE_MS);

      if (idlePromotions.length > 0 || reviewDemotions.length > 0) {
        const newCards = { ...ctx.config.cards };
        for (const cardId of idlePromotions) {
          newCards[cardId] = { ...newCards[cardId], columnId: COL_REVIEW };
        }
        for (const cardId of reviewDemotions) {
          newCards[cardId] = { ...newCards[cardId], columnId: COL_IN_PROGRESS };
        }
        ctx.config = { ...ctx.config, cards: newCards };
      }

      await saveConfig(ctx, ctx.config);

      // Report what happened
      const reconciled = Object.values(ctx.config.cards).filter((c) => c.closedAt && !c.windowId);
      if (idlePromotions.length === 0 && reviewDemotions.length === 0 && reconciled.length === 0) {
        console.log("Board is up to date.");
      } else {
        for (const cardId of idlePromotions) {
          console.log(`Promoted "${ctx.config.cards[cardId].name}" → Review (idle)`);
        }
        for (const cardId of reviewDemotions) {
          console.log(`Demoted "${ctx.config.cards[cardId].name}" → In Progress (active)`);
        }
      }
    });

  program
    .command("sessions")
    .description("List tmux sessions")
    .action(async () => {
      const serverName = detectServerName();
      try {
        const args: string[] = [];
        if (serverName) args.push("-L", serverName);
        args.push("list-sessions", "-F", "#{session_name}\t#{session_windows}\t#{session_attached}");
        const { stdout } = await execFileAsync("tmux", args);
        const lines = stdout.trim().split("\n").filter(Boolean);
        if (lines.length === 0) {
          console.log("No tmux sessions found.");
          return;
        }
        console.log("tmux sessions:");
        for (const line of lines) {
          const [name, windows, attached] = line.split("\t");
          const attachedLabel = attached === "1" ? " (attached)" : "";
          console.log(`  ${name}  ${windows} window${windows === "1" ? "" : "s"}${attachedLabel}`);
        }
      } catch {
        console.log("No tmux server running.");
      }
    });

  return program;
}
