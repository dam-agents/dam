import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";

const PATCHED_VERSION = "0.0.34";
const UPSTREAM_ISSUES =
  "https://github.com/svkozak/pi-acp/issues/152 and https://github.com/svkozak/pi-acp/issues/72";
const HELPERS = `globalThis[Symbol.for("platform.pi-acp-patch")]`;

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
globalThis[Symbol.for("platform.pi-acp-patch")] = { exited, settleTurnsOnExit };

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
      `pi-acp-patch: not applied: ${result}; drop the patch once ${UPSTREAM_ISSUES} are fixed\n`,
    );
    return loaded;
  },
});
