/** UNIT_BOUNDARY_DESCRIPTION: the plumbing Bob's three preloads share, so a
 * fix lands in one place: the path an fs call names, however Bob spells it;
 * the wrapping of the fs calls that move or copy one file onto another; and
 * taking a preload's own --import out of NODE_OPTIONS, so the processes Bob
 * starts (tools, MCP servers, scripts) do not inherit it. A preload that
 * patches fs through here calls syncBuiltinESMExports itself afterwards. */
import fs from "node:fs";
import { fileURLToPath } from "node:url";

export const pathOf = (p) =>
  p instanceof URL ? fileURLToPath(p) : Buffer.isBuffer(p) ? p.toString() : p;

export function wrapMoves(onMove) {
  for (const [owner, name] of [
    [fs, "rename"],
    [fs, "renameSync"],
    [fs.promises, "rename"],
    [fs, "copyFile"],
    [fs, "copyFileSync"],
    [fs.promises, "copyFile"],
  ]) {
    const move = owner[name];
    owner[name] = function (from, to, ...rest) {
      const [source, destination] = onMove(from, to);
      return move.call(this, source, destination, ...rest);
    };
  }
}

export function dropOwnImport(fileName) {
  const own = new RegExp(
    `(^|\\s)--import=\\S*${fileName.replaceAll(".", "\\.")}(?=\\s|$)`,
    "g",
  );
  const remaining = (process.env.NODE_OPTIONS ?? "").replace(own, " ").trim();
  if (remaining) process.env.NODE_OPTIONS = remaining;
  else delete process.env.NODE_OPTIONS;
}
