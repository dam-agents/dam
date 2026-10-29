import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";

const PATCHED_VERSION = "2.1.1";
const UPSTREAM_GAPS =
  "agentclientprotocol/codex-acp#663 is closed: codex-acp skips title generation on a provider " +
  "other than OpenAI's own (#595), names the session from session/new (#338) or carries a switch; " +
  "and codex-acp fails a turn whose model request failed, with the error in data.details " +
  "and no error text in the reply (https://github.com/agentclientprotocol/codex-acp/issues/647); " +
  "and a _session/steering request that asks for promptRequired starts no turn when none runs";

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
 * book it to the session. The first edit makes every title generator born
 * with a title already, so no such thread starts; codex-acp still publishes
 * the first prompt as the session's title. codex-acp also writes the final
 * error of a failed turn into the reply and ends the turn as a normal one,
 * unless the client speaks JetBrains' AIR extension, which the platform does
 * not. The second edit fails such a turn instead, with the error in
 * data.details, the only field the chat reads, and no reply text, so the
 * chat shows its failed-message card with Retry and a channel turn posts its
 * failure reply. A steer that finds no running turn starts a hidden turn of
 * its own, although the runtime asks for promptRequired and then queues the
 * same message again, so the agent would read it two times. The third edit
 * answers promptRequired instead.
 */
const edits = [
  {
    find: "  generated = false;\n  inFlight = null;\n  renameEchoResolve = null;\n",
    replace: "  generated = true;\n  inFlight = null;\n  renameEchoResolve = null;\n",
    count: 1,
  },
  {
    find:
      '    if (error62 === "usageLimitExceeded") {\n' +
      "      this.failure = RequestError.internalError(\n" +
      "        this.createTurnErrorData(params.error)\n" +
      "      );\n" +
      "    }\n" +
      "    return createAgentTextMessageChunk(`${readableServiceErrorMessage(params.error.message)}\n" +
      "\n" +
      "`);\n",
    replace:
      "    this.failure = RequestError.internalError({\n" +
      "      ...this.createTurnErrorData(params.error),\n" +
      "      details: `Model request failed: ${readableServiceErrorMessage(params.error.message)}`\n" +
      "    });\n" +
      "    return null;\n",
    count: 1,
  },
  {
    find: "    return await this.startNewTurnFromSteering(params);\n",
    replace: '    return { outcome: "promptRequired", reason: "noRunningTurn" };\n',
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
      `codex-acp-patch: not applied: ${result}; drop the patch once ${UPSTREAM_GAPS}\n`,
    );
    return loaded;
  },
});
