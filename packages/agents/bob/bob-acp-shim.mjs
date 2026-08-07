#!/usr/bin/env node
// ACP bridge for Bob Shell 2.x.
//
// Bob 2.0 removed the `--experimental-acp` mode this shim used to translate;
// the headless surface is now `bob run --format stream-json` plus a native
// `--resume <task-id>`. The shim is therefore a small ACP *agent* on
// stdin/stdout: agent-runtime speaks ACP to it, and each prompt turn spawns
// one `bob run` whose stream-json events are translated to session/update
// frames.
//
// ──────────────────────────────────────────────────────────────────────────
// Translation table (bob run stream-json → ACP session/update)
//
//   message role=user                  → DROP. Echo of the submitted prompt
//                                        (and, on --resume, a replay of the
//                                        task's history — see replay gate).
//   message role=assistant isReasoning → agent_thought_chunk
//   message role=assistant             → agent_message_chunk
//   tool_use                           → tool_call (in_progress, kind mapped
//                                        from the tool name)
//   tool_result                        → tool_call_update (completed/failed)
//   result                             → records stats.task_id as the
//                                        session's bob task id; resolves the
//                                        prompt with stopReason end_turn.
//   error                              → surfaced as agent_message_chunk
//                                        (budget/turn caps land here).
//
// Replay gate: on --resume bob re-emits the task's stored messages before the
// new turn. Everything is dropped until the user-message echo matching the
// submitted prompt (first assistant stream chunk as fallback).
//
// ──────────────────────────────────────────────────────────────────────────
// Session history (list / load / resume)
//
// Bob 2.0 persists tasks in SQLite (`~/.bob/db/bob.db`, tables tasks +
// messages) on the PVC. The shim serves ACP history straight from it:
//   session/list → SELECT from tasks, one session per task.
//   session/load → replay the task's messages as user/agent chunks.
//   session/prompt → `bob run --resume <taskId>` — native continuation, no
//     transcript re-injection.
// ACP session ids issued by session/new are shim-generated; the sessionId ↔
// taskId mapping is persisted to `~/.bob/platform-shim-sessions.json` so a
// pod restart keeps loaded sessions resumable.
//
// Settings: `bob run` has no yolo/auto-approve flag — approvals ride
// `~/.bob/settings/settings.json`. ensureSettings() merge-writes the platform
// posture (license consent, all permission groups approved, wildcard command
// allowlist, model/mode/cost from the BOB_* env). The trust boundary is the
// platform's Envoy gateway + K8s isolation, not Bob's approval layer.
//
// Set BOB_SHIM_TRACE=1 to log every inbound and outbound frame to stderr.
// ──────────────────────────────────────────────────────────────────────────
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve, sep } from "node:path";
import readline from "node:readline";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

const TRACE = process.env.BOB_SHIM_TRACE === "1";
const BOB_HOME = process.env.HOME || "/home/agent";
const BOB_DB_PATH = join(BOB_HOME, ".bob", "db", "bob.db");
const SETTINGS_PATH = join(BOB_HOME, ".bob", "settings", "settings.json");
const SESSION_MAP_PATH = join(BOB_HOME, ".bob", "platform-shim-sessions.json");
const UPLOADS_ROOT = resolve(BOB_HOME, ".uploads");

const AVAILABLE_MODES = [
  { id: "agent", name: "Agent" },
  { id: "plan", name: "Plan" },
  { id: "ask", name: "Ask" },
];

// BOB_CHAT_MODE may still carry a 1.x value pinned on an existing provider
// secret; 2.0 merged code+advanced into agent.
function normalizeMode(mode) {
  if (mode === "code" || mode === "advanced") return "agent";
  return AVAILABLE_MODES.some((m) => m.id === mode) ? mode : null;
}
let currentModeId = normalizeMode(process.env.BOB_CHAT_MODE) ?? "agent";

function isNonNullObject(v) {
  return typeof v === "object" && v !== null;
}

function trace(dir, line) {
  if (TRACE) process.stderr.write(`[${dir}] ${line}\n`);
}

// ── settings bootstrap ──────────────────────────────────────────────────────
// Also runnable standalone (`--settings-only`) so harness-terminal can share it.

export function ensureSettings() {
  let existing = {};
  try {
    existing = JSON.parse(readFileSync(SETTINGS_PATH, "utf8"));
  } catch {
    /* first boot */
  }
  const maxCost = Number(process.env.BOB_MAX_COINS ?? process.env.BOB_MAX_COST);
  const settings = {
    ...existing,
    licenseConsent: true,
    session: {
      ...(isNonNullObject(existing.session) ? existing.session : {}),
      defaultMode: currentModeId,
      ...(process.env.BOB_SHELL_MODEL ? { model: process.env.BOB_SHELL_MODEL } : {}),
      ...(Number.isFinite(maxCost) && maxCost > 0 ? { maxCost } : {}),
    },
    approval: {
      ...(isNonNullObject(existing.approval) ? existing.approval : {}),
      autoApprovalEnabled: true,
      outsideWorkspaceAllowed: true,
      allowed_permissions: ["read", "edit", "execute", "browser", "mcp"],
      allowedExecutors: [
        { toolId: "execute_command", approvedCommands: ["*"], deniedCommands: [] },
      ],
    },
  };
  mkdirSync(dirname(SETTINGS_PATH), { recursive: true });
  writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2) + "\n");
}

// ── sessionId ↔ taskId mapping ──────────────────────────────────────────────

const sessionToTask = new Map();
(() => {
  try {
    const stored = JSON.parse(readFileSync(SESSION_MAP_PATH, "utf8"));
    for (const [sid, tid] of Object.entries(stored)) sessionToTask.set(sid, tid);
  } catch {
    /* no mapping yet */
  }
})();

function bindTask(sessionId, taskId) {
  if (!taskId || sessionToTask.get(sessionId) === taskId) return;
  sessionToTask.set(sessionId, taskId);
  try {
    writeFileSync(
      SESSION_MAP_PATH,
      JSON.stringify(Object.fromEntries(sessionToTask), null, 2) + "\n",
    );
  } catch (err) {
    process.stderr.write(`[bob-acp-shim] session map write failed: ${err.message}\n`);
  }
}

function taskIdFor(sessionId) {
  return sessionToTask.get(sessionId) ?? null;
}

function sessionIdFor(taskId) {
  for (const [sid, tid] of sessionToTask) if (tid === taskId) return sid;
  return taskId;
}

// ── task store (bob.db, read-only) ──────────────────────────────────────────

function withDb(fn) {
  let db;
  try {
    db = new DatabaseSync(BOB_DB_PATH, { readOnly: true });
    return fn(db);
  } catch (err) {
    trace("db", `read failed: ${err.message}`);
    return null;
  } finally {
    try {
      db?.close();
    } catch {}
  }
}

function listTasks() {
  return (
    withDb((db) =>
      db
        .prepare(
          `SELECT id, title, first_message, directory, updated_at
             FROM tasks
            WHERE task_type = 'normal' AND time_archived IS NULL
            ORDER BY updated_at DESC`,
        )
        .all(),
    ) ?? []
  );
}

function taskMessages(taskId) {
  return (
    withDb((db) =>
      db
        .prepare(
          `SELECT role, data FROM messages WHERE task_id = ? ORDER BY created_at ASC`,
        )
        .all(taskId),
    ) ?? []
  );
}

function taskTitle(task) {
  const raw = String(task.title || task.first_message || "")
    .replace(/\s+/g, " ")
    .trim();
  if (!raw) return "Untitled session";
  return raw.length > 120 ? raw.slice(0, 119) + "…" : raw;
}

// messages.data is Bob's serialized message JSON; content is a string (or
// block list on some tool messages). Extract user-facing text, or "".
function messageText(data) {
  let m;
  try {
    m = JSON.parse(data);
  } catch {
    return "";
  }
  if (typeof m?.content === "string") return m.content;
  if (Array.isArray(m?.content)) {
    return m.content
      .map((b) => (typeof b?.text === "string" ? b.text : ""))
      .filter(Boolean)
      .join("");
  }
  return "";
}

function messageRole(data) {
  try {
    return JSON.parse(data)?.role;
  } catch {
    return undefined;
  }
}

// ── ACP plumbing ────────────────────────────────────────────────────────────

function emitToClient(frame) {
  const line = JSON.stringify(frame);
  trace("shim→client", line);
  process.stdout.write(line + "\n");
}

function update(sessionId, update) {
  emitToClient({ jsonrpc: "2.0", method: "session/update", params: { sessionId, update } });
}

function emitAgentMessage(sessionId, text) {
  update(sessionId, { sessionUpdate: "agent_message_chunk", content: { type: "text", text } });
}

function emitThoughtChunk(sessionId, text) {
  update(sessionId, { sessionUpdate: "agent_thought_chunk", content: { type: "text", text } });
}

function respond(id, result) {
  emitToClient({ jsonrpc: "2.0", id, result });
}

function respondError(id, code, message) {
  emitToClient({ jsonrpc: "2.0", id, error: { code, message } });
}

// ── session state ───────────────────────────────────────────────────────────

// sessionId → { cwd, running: Promise (turn serialization), child, cancelled }
const sessions = new Map();

function sessionState(sessionId) {
  let s = sessions.get(sessionId);
  if (!s) {
    s = { cwd: process.cwd(), running: Promise.resolve(), child: null, cancelled: false };
    sessions.set(sessionId, s);
  }
  return s;
}

// ── attachments ─────────────────────────────────────────────────────────────
// Chat uploads land under ~/.uploads; copy them into the workspace so Bob's
// read guard can see them, and hand Bob a text pointer (it takes no
// resource_link blocks).

function stageAttachment(block, cwd) {
  let src = typeof block.uri === "string" ? block.uri : "";
  const name = typeof block.name === "string" && block.name ? ` "${block.name}"` : "";
  const mime = block.mimeType ? ` (${block.mimeType})` : "";
  if (src.startsWith("file://")) {
    try {
      src = fileURLToPath(src);
    } catch {
      /* keep the raw uri */
    }
  } else if (/^[a-z][a-z0-9+.-]*:/i.test(src)) {
    return `[Attached link${name}${mime}: ${src}]`;
  }
  // Resolve before the containment check so `..` can't escape UPLOADS_ROOT.
  src = resolve(src);
  if (src === UPLOADS_ROOT || src.startsWith(UPLOADS_ROOT + sep)) {
    try {
      const destDir = join(cwd, ".attachments");
      mkdirSync(destDir, { recursive: true });
      const dest = join(destDir, basename(src));
      copyFileSync(src, dest);
      src = dest;
    } catch (err) {
      trace("bob-acp-shim", `stage failed: ${err.message}`);
    }
  }
  return `[Attached file${name}${mime}: ${src}]`;
}

function promptToText(promptBlocks, cwd) {
  const parts = [];
  for (const b of promptBlocks ?? []) {
    if (b?.type === "text" && typeof b.text === "string") parts.push(b.text);
    else if (b?.type === "resource_link") parts.push(stageAttachment(b, cwd));
  }
  return parts.join("\n\n");
}

// ── tool kind mapping (bob tool name → ACP tool_call kind) ─────────────────

function toolKind(name) {
  const n = String(name ?? "");
  if (n.includes("command") || n.includes("execute")) return "execute";
  if (n.includes("read")) return "read";
  if (n.includes("write") || n.includes("diff") || n.includes("edit")) return "edit";
  if (n.includes("search") || n.includes("list")) return "search";
  if (n.includes("browser") || n.includes("fetch") || n.includes("url")) return "fetch";
  return "other";
}

// ── prompt turn: spawn bob run and translate its stream ─────────────────────

function buildRunArgs(state, taskId, promptText) {
  const args = [
    "run",
    "--format",
    "stream-json",
    "--accept-license",
    "--trust",
    "-w",
    state.cwd,
    "--mode",
    currentModeId,
  ];
  if (process.env.BOB_TEAM_ID) args.push("--team-id", process.env.BOB_TEAM_ID);
  const maxCost = Number(process.env.BOB_MAX_COINS ?? process.env.BOB_MAX_COST);
  if (Number.isFinite(maxCost) && maxCost > 0) args.push("--max-cost", String(maxCost));
  if (taskId) args.push("--resume", taskId);
  // Positional prompt; `--` keeps a leading-dash prompt out of option parsing.
  args.push("--", promptText);
  return args;
}

function runTurn(sessionId, requestId, promptText) {
  const state = sessionState(sessionId);
  const taskId = taskIdFor(sessionId);
  const args = buildRunArgs(state, taskId, promptText);
  state.cancelled = false;

  return new Promise((resolveTurn) => {
    trace("shim→bob", `bob ${args.join(" ")}`);
    const child = spawn("bob", args, {
      stdio: ["ignore", "pipe", "inherit"],
      cwd: state.cwd,
      env: process.env,
    });
    state.child = child;

    // Replay gate: drop history bob re-emits on --resume until the echo of
    // this turn's prompt (or the first live stream chunk).
    let replayDone = !taskId;
    let sawResult = false;
    let lastError = null;
    let buf = "";

    const handleEvent = (ev) => {
      switch (ev.type) {
        case "message": {
          if (ev.role === "user") {
            if (!replayDone && ev.content === promptText) replayDone = true;
            return; // echo — the client already renders its own prompt
          }
          if (ev.role !== "assistant" || typeof ev.content !== "string") return;
          replayDone = true;
          if (ev.isReasoning) emitThoughtChunk(sessionId, ev.content);
          else emitAgentMessage(sessionId, ev.content);
          return;
        }
        case "tool_use": {
          if (!replayDone) return;
          update(sessionId, {
            sessionUpdate: "tool_call",
            toolCallId: String(ev.tool_id ?? randomUUID()),
            status: "in_progress",
            title: String(ev.tool_name ?? "tool"),
            kind: toolKind(ev.tool_name),
            rawInput: ev.parameters,
            content: [],
            locations: [],
          });
          return;
        }
        case "tool_result": {
          if (!replayDone) return;
          const failed = ev.status === "error";
          const text = failed ? ev.error?.message : ev.output;
          update(sessionId, {
            sessionUpdate: "tool_call_update",
            toolCallId: String(ev.tool_id ?? ""),
            status: failed ? "failed" : "completed",
            content:
              typeof text === "string" && text.length > 0
                ? [{ type: "content", content: { type: "text", text } }]
                : [],
          });
          return;
        }
        case "result": {
          sawResult = true;
          const tid = ev.stats?.task_id;
          if (typeof tid === "string" && tid) bindTask(sessionId, tid);
          return;
        }
        case "error": {
          lastError = String(ev.message ?? "unknown error");
          if (replayDone) emitAgentMessage(sessionId, `\n${lastError}\n`);
          return;
        }
        default:
          return;
      }
    };

    child.stdout.on("data", (chunk) => {
      buf += chunk.toString();
      const lines = buf.split("\n");
      buf = lines.pop();
      for (const line of lines) {
        if (!line.trim()) continue;
        trace("bob→shim", line);
        try {
          handleEvent(JSON.parse(line));
        } catch {
          process.stderr.write(`[bob] ${line}\n`);
        }
      }
    });

    child.on("error", (err) => {
      state.child = null;
      respondError(requestId, -32603, `bob spawn failed: ${err.message}`);
      resolveTurn();
    });

    child.on("exit", (code) => {
      state.child = null;
      if (state.cancelled) respond(requestId, { stopReason: "cancelled" });
      else if (sawResult) respond(requestId, { stopReason: "end_turn" });
      else respondError(requestId, -32603, lastError ?? `bob run exited with code ${code}`);
      resolveTurn();
    });
  });
}

// ── ACP request handlers ────────────────────────────────────────────────────

function handleInitialize(f) {
  respond(f.id, {
    protocolVersion: 1,
    agentCapabilities: {
      loadSession: true,
      sessionCapabilities: { list: {}, close: {} },
      promptCapabilities: { image: false, audio: false, embeddedContext: false },
    },
    authMethods: [],
  });
}

function handleSessionNew(f) {
  const sessionId = `bob-${randomUUID()}`;
  const state = sessionState(sessionId);
  if (typeof f.params?.cwd === "string") state.cwd = f.params.cwd;
  respond(f.id, {
    sessionId,
    modes: { availableModes: AVAILABLE_MODES.map((m) => ({ ...m })), currentModeId },
  });
}

function handleSessionList(f) {
  const sessions = listTasks().map((t) => ({
    sessionId: sessionIdFor(t.id),
    cwd: t.directory,
    title: taskTitle(t),
    updatedAt: Number.isFinite(t.updated_at) ? new Date(t.updated_at).toISOString() : null,
    // Tag as chat so agent-runtime's list enrichment doesn't decode a
    // store-less session as terminal.
    _meta: { platform: { mode: "chat" } },
  }));
  respond(f.id, { sessions });
}

function handleSessionLoad(f) {
  const sid = f.params?.sessionId;
  const taskId = typeof sid === "string" ? taskIdFor(sid) ?? sid : null;
  const rows = taskId ? taskMessages(taskId) : [];
  if (rows.length === 0) {
    respondError(f.id, -32602, `Unknown session: ${sid}`);
    return;
  }
  bindTask(sid, taskId);
  const state = sessionState(sid);
  const dir = withDb((db) =>
    db.prepare(`SELECT directory FROM tasks WHERE id = ?`).get(taskId),
  );
  if (typeof dir?.directory === "string" && dir.directory) state.cwd = dir.directory;
  for (const row of rows) {
    const role = row.role || messageRole(row.data);
    const text = messageText(row.data);
    if (!text) continue;
    if (role === "user") {
      update(sid, {
        sessionUpdate: "user_message_chunk",
        content: { type: "text", text },
      });
    } else if (role === "assistant") {
      emitAgentMessage(sid, text);
    }
  }
  respond(f.id, {
    modes: { availableModes: AVAILABLE_MODES.map((m) => ({ ...m })), currentModeId },
  });
}

function handleSessionSetMode(f) {
  const modeId = normalizeMode(f.params?.modeId);
  const sessionId = f.params?.sessionId;
  if (modeId && modeId !== currentModeId) {
    currentModeId = modeId;
    if (sessionId) {
      update(sessionId, { sessionUpdate: "current_mode_update", currentModeId: modeId });
    }
  }
  respond(f.id, null);
}

function handleSessionPrompt(f) {
  const sessionId = f.params?.sessionId;
  if (typeof sessionId !== "string") {
    respondError(f.id, -32602, "sessionId is required");
    return;
  }
  const state = sessionState(sessionId);
  const promptText = promptToText(f.params?.prompt, state.cwd);
  if (!promptText.trim()) {
    respond(f.id, { stopReason: "end_turn" });
    return;
  }
  // Serialize turns per session; bob locks the task row while running.
  state.running = state.running.then(() => runTurn(sessionId, f.id, promptText));
}

function handleSessionCancel(f) {
  const sessionId = f.params?.sessionId;
  const state = typeof sessionId === "string" ? sessions.get(sessionId) : null;
  if (state?.child) {
    state.cancelled = true;
    state.child.kill("SIGINT");
  }
  if (f.id !== undefined) respond(f.id, null);
}

// The task lives in bob.db; only the in-memory turn state goes (the persisted
// sessionId↔taskId binding stays so the session remains loadable).
function handleSessionClose(f) {
  const sessionId = f.params?.sessionId;
  const state = typeof sessionId === "string" ? sessions.get(sessionId) : null;
  if (state) {
    state.child?.kill("SIGTERM");
    sessions.delete(sessionId);
  }
  if (f.id !== undefined) respond(f.id, null);
}

function handleClientLine(line) {
  let f;
  try {
    f = JSON.parse(line);
  } catch {
    return;
  }
  const isRequest = typeof f.method === "string";
  if (!isRequest) return;

  switch (f.method) {
    case "initialize":
      return handleInitialize(f);
    case "session/new":
      return handleSessionNew(f);
    case "session/list":
      return handleSessionList(f);
    case "session/load":
      return handleSessionLoad(f);
    case "session/set_mode":
      return handleSessionSetMode(f);
    case "session/prompt":
      return handleSessionPrompt(f);
    case "session/cancel":
      return handleSessionCancel(f);
    case "session/close":
      return handleSessionClose(f);
    default: {
      if (f.id !== undefined) respondError(f.id, -32601, `Method not found: ${f.method}`);
    }
  }
}

// ── main ────────────────────────────────────────────────────────────────────

const settingsOnly = process.argv.includes("--settings-only");
ensureSettings();
if (!settingsOnly) {
  const clientStdin = readline.createInterface({ input: process.stdin });
  clientStdin.on("line", (line) => {
    trace("client→shim", line);
    handleClientLine(line);
  });
  clientStdin.on("close", () => {
    for (const s of sessions.values()) s.child?.kill("SIGTERM");
    process.exit(0);
  });
  for (const sig of ["SIGTERM", "SIGINT", "SIGHUP"]) {
    process.on(sig, () => {
      for (const s of sessions.values()) s.child?.kill(sig);
      process.exit(0);
    });
  }
}
