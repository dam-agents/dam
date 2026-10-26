import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";

const PATCHED_VERSION = "0.0.34";
const UPSTREAM_GAPS =
  "pi-acp keeps concurrent sessions apart (https://github.com/svkozak/pi-acp/issues/152), " +
  "can turn off its update notice (https://github.com/svkozak/pi-acp/issues/72), " +
  "reports a reply cut at the output limit as max_tokens, " +
  "fails a turn whose model request failed (https://github.com/svkozak/pi-acp/issues/135), " +
  "writes no retry notice into the reply " +
  "and hands each pi the session ref its session/new or session/load carries";
const HELPERS = `globalThis[Symbol.for("platform.pi-acp-patch")]`;
const SESSION_REF_HEADER = "x-platform-session-ref";
const endings = new WeakMap();
const sessionRefs = new Map();
const lastRepliesOfTurns = new WeakMap();

function dropOwnImport() {
  const rest = (process.env.NODE_OPTIONS ?? "")
    .replace(/--import=\S*pi-acp-patch\.mjs/, "")
    .trim();
  if (rest) process.env.NODE_OPTIONS = rest;
  else delete process.env.NODE_OPTIONS;
}

function exited(proc) {
  return proc.child.exitCode !== null || proc.child.signalCode !== null;
}

function settleTurnsOnExit(session) {
  session.proc.child.once("exit", (code, signal) => {
    const turns = [
      ...(session.pendingTurn ? [session.pendingTurn] : []),
      ...session.turnQueue.splice(0),
    ];
    session.pendingTurn = null;
    session.inAgentLoop = false;
    if (turns.length === 0) return;
    const cancelled = session.cancelRequested;
    const error = new Error(
      `pi exited before the turn finished (code=${code}, signal=${signal})`,
    );
    void session.flushEmits().finally(() => {
      for (const turn of turns) {
        if (cancelled) turn.resolve("cancelled");
        else turn.reject(error);
      }
    });
  });
}

function cutAtOutputLimit(piStopReason) {
  return piStopReason === "length";
}

function recordEnding(session, message) {
  endings.set(session, {
    stopReason: message?.stopReason,
    errorMessage: message?.errorMessage,
  });
}

function turnStopReason(session) {
  return cutAtOutputLimit(endings.get(session)?.stopReason)
    ? "max_tokens"
    : "end_turn";
}

function modelRequestError(session) {
  const ending = endings.get(session);
  if (ending?.stopReason !== "error") return undefined;
  return new Error(
    ending.errorMessage
      ? `Model request failed: ${ending.errorMessage}`
      : "Model request failed.",
  );
}

function endTurn(session) {
  if (session.cancelRequested) return session.pendingTurn?.resolve("cancelled");
  const error = modelRequestError(session);
  if (error) session.pendingTurn?.reject(error);
  else session.pendingTurn?.resolve(turnStopReason(session));
}

function lastRepliesOf(messages) {
  let replies = lastRepliesOfTurns.get(messages);
  if (replies) return replies;
  replies = new Set();
  let last;
  for (const message of messages) {
    if (message?.role === "user") {
      if (last) replies.add(last);
      last = undefined;
    } else if (message?.role === "assistant") {
      last = message;
    }
  }
  if (last) replies.add(last);
  lastRepliesOfTurns.set(messages, replies);
  return replies;
}

function cutReply(message, messages) {
  return (
    cutAtOutputLimit(message?.stopReason) && lastRepliesOf(messages).has(message)
  );
}

function replayMeta(message, messages) {
  return cutReply(message, messages)
    ? { _meta: { platform: { stopReason: "max_tokens" } } }
    : {};
}

function sessionRefOf(mcpServers) {
  for (const server of Array.isArray(mcpServers) ? mcpServers : []) {
    const header = (Array.isArray(server?.headers) ? server.headers : []).find(
      (h) => String(h?.name).toLowerCase() === SESSION_REF_HEADER,
    );
    if (typeof header?.value === "string" && header.value) return header.value;
  }
  return undefined;
}

function rememberSessionRef(sessionId, mcpServers) {
  const ref = sessionRefOf(mcpServers);
  if (ref) sessionRefs.set(sessionId, ref);
}

function piEnv(sessionId, mcpServers) {
  const ref =
    sessionRefOf(mcpServers) ??
    (sessionId === undefined ? undefined : sessionRefs.get(sessionId));
  return ref ? { ...process.env, PLATFORM_SESSION_REF: ref } : process.env;
}

const edits = [
  {
    find: "    this.sessions.closeAllExcept?.(session.sessionId);\n",
    replace: "",
    count: 2,
  },
  {
    find: "          list: {},\n          delete: {}\n",
    replace: "          list: {},\n          delete: {},\n          close: {}\n",
    count: 1,
  },
  {
    find: "  async cancel(params) {\n",
    replace:
      "  async closeSession(params) {\n" +
      "    this.sessions.close(params.sessionId);\n" +
      "    return {};\n" +
      "  }\n" +
      "  async cancel(params) {\n",
    count: 1,
  },
  {
    find: "    this.proc.onEvent((ev) => this.handlePiEvent(ev));\n",
    replace:
      "    this.proc.onEvent((ev) => this.handlePiEvent(ev));\n" +
      `    ${HELPERS}.settleTurnsOnExit(this);\n`,
    count: 1,
  },
  {
    find: "  maybeGet(sessionId) {\n    return this.sessions.get(sessionId);\n  }\n",
    replace:
      "  maybeGet(sessionId) {\n" +
      "    const s = this.sessions.get(sessionId);\n" +
      `    if (s && ${HELPERS}.exited(s.proc)) this.sessions.delete(sessionId);\n` +
      "    return this.sessions.get(sessionId);\n" +
      "  }\n",
    count: 1,
  },
  {
    find: "    const updateNotice = buildUpdateNotice();\n",
    replace: "    const updateNotice = null;\n",
    count: 1,
  },
  {
    find: '      case "turn_end": {\n        break;\n      }\n',
    replace:
      '      case "turn_end": {\n' +
      `        ${HELPERS}.recordEnding(this, ev.message);\n` +
      "        break;\n" +
      "      }\n",
    count: 1,
  },
  {
    find: "  startTurn(t) {\n    this.cancelRequested = false;\n",
    replace:
      "  startTurn(t) {\n" +
      "    this.cancelRequested = false;\n" +
      `    ${HELPERS}.recordEnding(this, undefined);\n`,
    count: 1,
  },
  {
    find:
      '    const reason = this.cancelRequested ? "cancelled" : "end_turn";\n' +
      "    this.pendingTurn?.resolve(reason);\n",
    replace: `    ${HELPERS}.endTurn(this);\n`,
    count: 1,
  },
  {
    find:
      '      case "auto_retry_start": {\n' +
      "        this.emit({\n" +
      '          sessionUpdate: "agent_message_chunk",\n' +
      '          content: { type: "text", text: formatAutoRetryMessage(ev) }\n' +
      "        });\n" +
      "        break;\n" +
      "      }\n" +
      '      case "auto_retry_end": {\n' +
      "        this.emit({\n" +
      '          sessionUpdate: "agent_message_chunk",\n' +
      '          content: { type: "text", text: "Retry finished, resuming." }\n' +
      "        });\n" +
      "        break;\n" +
      "      }\n",
    replace: "",
    count: 1,
  },
  {
    find:
      "        const text = normalizePiAssistantText(m?.content);\n" +
      "        if (text) {\n" +
      "          await this.conn.sessionUpdate({\n" +
      "            sessionId: session.sessionId,\n",
    replace:
      "        const text = normalizePiAssistantText(m?.content);\n" +
      `        if (text || ${HELPERS}.cutReply(m, messages)) {\n` +
      "          await this.conn.sessionUpdate({\n" +
      "            sessionId: session.sessionId,\n" +
      `            ...${HELPERS}.replayMeta(m, messages),\n`,
    count: 1,
  },
  {
    find: '      stdio: "pipe",\n      env: process.env\n',
    replace: '      stdio: "pipe",\n      env: params.env ?? process.env\n',
    count: 1,
  },
  {
    find: "        cwd: params.cwd,\n        piCommand: params.piCommand\n      });\n",
    replace:
      "        cwd: params.cwd,\n" +
      "        piCommand: params.piCommand,\n" +
      `        env: ${HELPERS}.piEnv(undefined, params.mcpServers)\n` +
      "      });\n",
    count: 1,
  },
  {
    find:
      "          sessionPath: stored.sessionFile,\n" +
      "          piCommand: process.env.PI_ACP_PI_COMMAND\n",
    replace:
      "          sessionPath: stored.sessionFile,\n" +
      "          piCommand: process.env.PI_ACP_PI_COMMAND,\n" +
      `          env: ${HELPERS}.piEnv(sessionId, opts?.mcpServers)\n`,
    count: 1,
  },
  {
    find: "    this.mcpServers = opts.mcpServers;\n",
    replace:
      "    this.mcpServers = opts.mcpServers;\n" +
      `    ${HELPERS}.rememberSessionRef(opts.sessionId, opts.mcpServers);\n`,
    count: 1,
  },
];

function patched(url, loaded) {
  const { version } = JSON.parse(
    readFileSync(new URL("../package.json", url), "utf8"),
  );
  if (version !== PATCHED_VERSION)
    return `pi-acp ${version} is not the ${PATCHED_VERSION} it targets`;
  let source = Buffer.from(loaded.source).toString("utf8");
  for (const { find, replace, count } of edits) {
    const parts = source.split(find);
    if (parts.length - 1 !== count)
      return `pi-acp ${version} has ${parts.length - 1} of the ${count} expected matches for an edit`;
    source = parts.join(replace);
  }
  return { ...loaded, source };
}

dropOwnImport();
globalThis[Symbol.for("platform.pi-acp-patch")] = {
  exited,
  settleTurnsOnExit,
  recordEnding,
  endTurn,
  cutReply,
  replayMeta,
  piEnv,
  rememberSessionRef,
};

registerHooks({
  load(url, context, nextLoad) {
    const loaded = nextLoad(url, context);
    if (!url.endsWith("/pi-acp/dist/index.js")) return loaded;
    let result;
    try {
      result = patched(url, loaded);
    } catch (error) {
      result = String(error);
    }
    if (typeof result === "object") return result;
    process.stderr.write(
      `pi-acp-patch: not applied: ${result}; drop the patch once ${UPSTREAM_GAPS}\n`,
    );
    return loaded;
  },
});
