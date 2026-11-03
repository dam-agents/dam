import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { dropOwnImport } from "./bob-preload-lib.mjs";

const BOB_VERSION = "2.0.6";
const UPSTREAM_GAP =
  "Bob starts the MCP servers of mcp.json in the background in `bob acp` too, as `bob chat` does";

/**
 * UNIT_BOUNDARY_DESCRIPTION: `bob acp` builds every session's harness as a
 * non-interactive one, and Bob ties the MCP startup mode to that flag: a
 * session/new, session/load or session/resume answers only after every
 * server of ~/.bob/settings/mcp.json finished its first connect. A stdio
 * server that never answers initialize holds each of them for the MCP SDK's
 * 60 s request timeout, so one broken entry stalls every chat on the agent,
 * and a reopen that also spawns Bob runs out of its load budget. The edit makes the chat
 * process start those servers in the background, as `bob chat` does. The
 * servers a session carries, the platform entry among them, are registered
 * after that startup and are still awaited, so the platform tools are there
 * on the first turn. The preload takes its own --import out of NODE_OPTIONS
 * once Bob's bundle loads, so the processes Bob starts do not inherit it.
 */
const edits = [
  {
    find: 'startupMode:l?"startInBackground":"blockUntilReady"',
    replace: 'startupMode:"startInBackground"',
    count: 1,
  },
];

function patched(url, loaded) {
  const { version } = JSON.parse(
    readFileSync(new URL("../package.json", url), "utf8"),
  );
  if (version !== BOB_VERSION)
    return `Bob ${version} is not the ${BOB_VERSION} it targets`;
  let source = Buffer.from(loaded.source).toString("utf8");
  for (const { find, replace, count } of edits) {
    const parts = source.split(find);
    if (parts.length - 1 !== count)
      return `Bob ${version} has ${parts.length - 1} of the ${count} expected matches for an edit`;
    source = parts.join(replace);
  }
  return { ...loaded, source };
}

registerHooks({
  load(url, context, nextLoad) {
    const loaded = nextLoad(url, context);
    if (!/\/dist\/bob(\.js)?$/.test(url)) return loaded;
    dropOwnImport("bob-acp-patch.mjs");
    let result;
    try {
      result = patched(url, loaded);
    } catch (error) {
      result = String(error);
    }
    if (typeof result === "object") return result;
    process.stderr.write(
      `bob-acp-patch: not applied: ${result}; drop the patch once ${UPSTREAM_GAP}\n`,
    );
    return loaded;
  },
});
