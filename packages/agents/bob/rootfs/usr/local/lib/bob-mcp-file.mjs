/** UNIT_BOUNDARY_DESCRIPTION: Bob keeps one MCP server per name and lets an
 * entry of its own settings file outrank the one a session/new, session/load
 * or session/resume carries. The mcp-entry driver writes the platform entry
 * into $HOME/.bob/settings/mcp.json for the terminal's `bob chat`, so in
 * `bob acp` that file entry would shadow the session's own copy, the one that
 * carries the session ref, and every platform tool call would name no
 * session. Loaded into `bob acp` alone, this preload drops the platform entry
 * from what Bob reads out of that one file and puts it back into what Bob
 * writes to it, so the file stays whole for `bob chat` and the driver and
 * Bob's watch on the file is left alone. It says so once on stderr when it
 * reads the file and cannot hide the entry, since the symptom would otherwise
 * be only the anonymous calls it exists to prevent, and it leaves
 * NODE_OPTIONS alone until the process reads the file, so a parent that only
 * starts the real Bob still hands the preload down. Bob 2.0.6 reads and
 * writes the file through node:fs by that path; check:bob-mcp-file ties
 * BOB_VERSION to the image pin so a bump runs test:bob-session-ref again. */
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { join } from "node:path";
import { dropOwnImport, pathOf, wrapMoves } from "./bob-preload-lib.mjs";

const BOB_VERSION = "2.0.6";
const PLATFORM_ENTRY = "platform-outbound";
const target = join(process.env.HOME ?? "", ".bob", "settings", "mcp.json");
const isTarget = (p) => pathOf(p) === target;

const original = {
  readFileSync: fs.readFileSync,
  readFile: fs.readFile,
  readFileP: fs.promises.readFile,
  writeFileSync: fs.writeFileSync,
  writeFile: fs.writeFile,
  writeFileP: fs.promises.writeFile,
};

const said = new Set();
const sayOnce = (what) => {
  if (said.has(what)) return;
  said.add(what);
  process.stderr.write(`bob-mcp-file: ${what}\n`);
};
const touched = () => dropOwnImport("bob-mcp-file.mjs");

const servers = (text) => {
  const doc = JSON.parse(text);
  if (typeof doc !== "object" || doc === null || Array.isArray(doc)) return null;
  const list = doc.mcpServers;
  if (typeof list !== "object" || list === null || Array.isArray(list)) return null;
  return { doc, list };
};
const asText = (data) =>
  typeof data === "string" ? data : Buffer.from(data).toString("utf8");
const likeInput = (text, data) =>
  typeof data === "string" ? text : Buffer.from(text, "utf8");

const withoutPlatformEntry = (data) => {
  touched();
  try {
    const parsed = servers(asText(data));
    if (!parsed) {
      sayOnce(`${target} holds no mcpServers object, so nothing is hidden`);
      return data;
    }
    if (!(PLATFORM_ENTRY in parsed.list)) {
      sayOnce(`${target} holds no ${PLATFORM_ENTRY} entry to hide`);
      return data;
    }
    delete parsed.list[PLATFORM_ENTRY];
    return likeInput(JSON.stringify(parsed.doc, null, 2), data);
  } catch (error) {
    sayOnce(
      `cannot parse ${target}, so its ${PLATFORM_ENTRY} entry is not hidden: ${error.message}`,
    );
    return data;
  }
};

const withPlatformEntry = (data) => {
  touched();
  try {
    const parsed = servers(asText(data));
    if (!parsed || PLATFORM_ENTRY in parsed.list) return data;
    const onDisk = servers(original.readFileSync(target, "utf8"));
    const entry = onDisk?.list[PLATFORM_ENTRY];
    if (entry === undefined) return data;
    parsed.list[PLATFORM_ENTRY] = entry;
    return likeInput(JSON.stringify(parsed.doc, null, 2), data);
  } catch {
    return data;
  }
};

fs.readFileSync = function (p, ...rest) {
  const data = original.readFileSync.call(this, p, ...rest);
  return isTarget(p) ? withoutPlatformEntry(data) : data;
};
fs.readFile = function (p, ...rest) {
  if (!isTarget(p) || typeof rest[rest.length - 1] !== "function")
    return original.readFile.call(this, p, ...rest);
  const callback = rest.pop();
  return original.readFile.call(this, p, ...rest, (err, data) =>
    callback(err, err ? data : withoutPlatformEntry(data)),
  );
};
fs.promises.readFile = async function (p, ...rest) {
  const data = await original.readFileP.call(this, p, ...rest);
  return isTarget(p) ? withoutPlatformEntry(data) : data;
};

fs.writeFileSync = function (p, data, ...rest) {
  return original.writeFileSync.call(
    this,
    p,
    isTarget(p) ? withPlatformEntry(data) : data,
    ...rest,
  );
};
fs.writeFile = function (p, data, ...rest) {
  return original.writeFile.call(
    this,
    p,
    isTarget(p) ? withPlatformEntry(data) : data,
    ...rest,
  );
};
fs.promises.writeFile = function (p, data, ...rest) {
  return original.writeFileP.call(
    this,
    p,
    isTarget(p) ? withPlatformEntry(data) : data,
    ...rest,
  );
};

const restoreInSource = (from) => {
  try {
    const data = original.readFileSync(from);
    const merged = withPlatformEntry(data);
    if (merged !== data) original.writeFileSync(from, merged);
  } catch {}
};
wrapMoves((from, to) => {
  if (isTarget(to)) restoreInSource(from);
  return [from, to];
});
syncBuiltinESMExports();

export { BOB_VERSION };
