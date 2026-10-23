import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";

const PATCHED_VERSION = "2.1.1";
const UPSTREAM_GAP =
  "agentclientprotocol/codex-acp#663 is closed: codex-acp skips title generation on a provider " +
  "other than OpenAI's own (#595), names the session from session/new (#338) or carries a switch";

function dropOwnImport() {
  const rest = (process.env.NODE_OPTIONS ?? "")
    .replace(/--import=\S*codex-acp-patch\.mjs/, "")
    .trim();
  if (rest) process.env.NODE_OPTIONS = rest;
  else delete process.env.NODE_OPTIONS;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: codex-acp names a new chat session after its
 * first turn by starting an ephemeral Codex thread and running one turn on a
 * model it hard-codes (gpt-5.6-luna), with Codex's whole base prompt and
 * tool schemas behind it. That thread names no parent and no platform
 * session, so the Model Router cannot send it to the session's provider or
 * book it to the session. The edit makes every title generator born with a
 * title already, so no such thread starts; codex-acp still publishes the
 * first prompt as the session's title.
 */
const edits = [
  {
    find: "  generated = false;\n  inFlight = null;\n  renameEchoResolve = null;\n",
    replace: "  generated = true;\n  inFlight = null;\n  renameEchoResolve = null;\n",
    count: 1,
  },
];

function patched(url, loaded) {
  const { version } = JSON.parse(
    readFileSync(new URL("../package.json", url), "utf8"),
  );
  if (version !== PATCHED_VERSION)
    return `codex-acp ${version} is not the ${PATCHED_VERSION} it targets`;
  let source = Buffer.from(loaded.source).toString("utf8");
  for (const { find, replace, count } of edits) {
    const parts = source.split(find);
    if (parts.length - 1 !== count)
      return `codex-acp ${version} has ${parts.length - 1} of the ${count} expected matches for an edit`;
    source = parts.join(replace);
  }
  return { ...loaded, source };
}

dropOwnImport();
registerHooks({
  load(url, context, nextLoad) {
    const loaded = nextLoad(url, context);
    if (!url.endsWith("/codex-acp/dist/index.js")) return loaded;
    let result;
    try {
      result = patched(url, loaded);
    } catch (error) {
      result = String(error);
    }
    if (typeof result === "object") return result;
    process.stderr.write(
      `codex-acp-patch: not applied: ${result}; drop the patch once ${UPSTREAM_GAP}\n`,
    );
    return loaded;
  },
});
