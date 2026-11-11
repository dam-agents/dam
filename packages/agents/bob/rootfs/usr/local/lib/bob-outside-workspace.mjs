/** UNIT_BOUNDARY_DESCRIPTION: Bob asks before a file tool call outside its
 * workspace (the work directory) even under --auto-approve, and offers no
 * "always allow", unless the tool's permission group has
 * enableOutsideWorkspace: true in approval.permissionOptions. The agent's own
 * files (instructions, kit docs, memory) live in $HOME, so an unattended
 * session would wait on approvals nobody gives. Loaded into Bob, this preload
 * opens the groups the process's approvals call for in what Bob reads out of
 * $HOME/.bob/settings/settings.json: every group under --auto-approve, read and
 * execute otherwise. A group the file itself opens stays open. In what Bob
 * writes to that file, each group whose value is still the one this preload
 * laid over gets the file's own entries back, so the owner's file never
 * carries the posture, and every other change Bob saves is kept. Bob 2.1.0
 * reads and writes the file through node:fs by that path;
 * check:bob-outside-workspace ties BOB_VERSION to the image pin. */
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { join } from "node:path";
import { dropOwnImport, pathOf, wrapMoves } from "./bob-preload-lib.mjs";

const BOB_VERSION = "2.1.0";
const GROUPS = [
  "read",
  "edit",
  "execute",
  "browser",
  "mcp",
  "skill",
  "todo",
  "subtask",
  "subagent",
  "mode",
  "artifact",
];
const OPEN_ON_ASK = ["read", "execute"];
const target = join(process.env.HOME ?? "", ".bob", "settings", "settings.json");
const isTarget = (p) => pathOf(p) === target;
const opened = process.argv.includes("--auto-approve") ? GROUPS : OPEN_ON_ASK;

const original = {
  readFileSync: fs.readFileSync,
  readFile: fs.readFile,
  readFileP: fs.promises.readFile,
  writeFileSync: fs.writeFileSync,
  writeFile: fs.writeFile,
  writeFileP: fs.promises.writeFile,
};

const asText = (data) =>
  typeof data === "string" ? data : Buffer.from(data).toString("utf8");
const likeInput = (text, data) =>
  typeof data === "string" ? text : Buffer.from(text, "utf8");
const isObject = (value) =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const optionsOf = (doc) => {
  const list = isObject(doc.approval) ? doc.approval.permissionOptions : undefined;
  return Array.isArray(list) ? list : [];
};
const entriesOf = (options, groupId) =>
  options.filter((entry) => isObject(entry) && entry.groupId === groupId);
const isOpen = (entries, groupId) =>
  opened.includes(groupId) ||
  entries.some((entry) => entry.enableOutsideWorkspace === true);

const laidOver = (options) => {
  const result = options.filter(
    (entry) => !isObject(entry) || !GROUPS.includes(entry.groupId),
  );
  for (const groupId of GROUPS) {
    const own = entriesOf(options, groupId);
    if (own.length === 0 && !opened.includes(groupId)) continue;
    result.push({
      ...Object.assign({}, ...own),
      groupId,
      enableOutsideWorkspace: isOpen(own, groupId),
    });
  }
  return result;
};

const withPosture = (data) => {
  dropOwnImport("bob-outside-workspace.mjs");
  try {
    const doc = JSON.parse(asText(data));
    if (!isObject(doc)) return data;
    doc.approval = {
      ...(isObject(doc.approval) ? doc.approval : {}),
      permissionOptions: laidOver(optionsOf(doc)),
    };
    return likeInput(JSON.stringify(doc, null, 2), data);
  } catch {
    return data;
  }
};

const withoutPosture = (data) => {
  try {
    const doc = JSON.parse(asText(data));
    if (!isObject(doc) || !isObject(doc.approval)) return data;
    let onDisk = [];
    try {
      onDisk = optionsOf(JSON.parse(original.readFileSync(target, "utf8")));
    } catch {}
    const written = optionsOf(doc);
    const kept = written.filter((entry) => {
      if (!isObject(entry) || !GROUPS.includes(entry.groupId)) return true;
      const own = entriesOf(onDisk, entry.groupId);
      return entry.enableOutsideWorkspace !== isOpen(own, entry.groupId);
    });
    const keptGroups = new Set(kept.map((entry) => entry?.groupId));
    const restored = GROUPS.filter((groupId) => !keptGroups.has(groupId)).flatMap(
      (groupId) =>
        entriesOf(written, groupId).length > 0 ? entriesOf(onDisk, groupId) : [],
    );
    const options = [...kept, ...restored];
    if (options.length > 0) doc.approval.permissionOptions = options;
    else delete doc.approval.permissionOptions;
    return likeInput(JSON.stringify(doc, null, 2), data);
  } catch {
    return data;
  }
};

fs.readFileSync = function (p, ...rest) {
  const data = original.readFileSync.call(this, p, ...rest);
  return isTarget(p) ? withPosture(data) : data;
};
fs.readFile = function (p, ...rest) {
  if (!isTarget(p) || typeof rest[rest.length - 1] !== "function")
    return original.readFile.call(this, p, ...rest);
  const callback = rest.pop();
  return original.readFile.call(this, p, ...rest, (err, data) =>
    callback(err, err ? data : withPosture(data)),
  );
};
fs.promises.readFile = async function (p, ...rest) {
  const data = await original.readFileP.call(this, p, ...rest);
  return isTarget(p) ? withPosture(data) : data;
};

fs.writeFileSync = function (p, data, ...rest) {
  return original.writeFileSync.call(
    this,
    p,
    isTarget(p) ? withoutPosture(data) : data,
    ...rest,
  );
};
fs.writeFile = function (p, data, ...rest) {
  return original.writeFile.call(
    this,
    p,
    isTarget(p) ? withoutPosture(data) : data,
    ...rest,
  );
};
fs.promises.writeFile = function (p, data, ...rest) {
  return original.writeFileP.call(
    this,
    p,
    isTarget(p) ? withoutPosture(data) : data,
    ...rest,
  );
};

const restoreInSource = (from) => {
  try {
    const data = original.readFileSync(from, "utf8");
    const own = withoutPosture(data);
    if (own !== data) original.writeFileSync(from, own);
  } catch {}
};
wrapMoves((from, to) => {
  if (isTarget(to)) restoreInSource(from);
  return [from, to];
});
syncBuiltinESMExports();

export { BOB_VERSION };
