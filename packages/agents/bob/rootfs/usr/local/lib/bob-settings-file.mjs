/** UNIT_BOUNDARY_DESCRIPTION: Bob reads one fixed $HOME/.bob/settings/settings.json
 * and watches it. Two Bob processes on different models would read each other's
 * model, so this preload points one process at its own BOB_SETTINGS_FILE. The rest
 * of ~/.bob (task store, rules, MCP config) stays shared. */
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { join } from "node:path";
import { pathOf, wrapMoves } from "./bob-preload-lib.mjs";

const target = process.env.BOB_SETTINGS_FILE;
const shared = join(process.env.HOME ?? "", ".bob", "settings", "settings.json");
if (target && target !== shared) {
  const redirect = (p) => {
    const path = pathOf(p);
    if (path === shared) return target;
    if (path === `${shared}.bak`) return `${target}.bak`;
    return p;
  };
  const names = ["readFile", "writeFile", "appendFile", "access", "stat", "lstat", "open", "unlink", "rm", "watch"];
  const patch = (owner, list) => {
    for (const name of list) {
      const original = owner[name];
      if (typeof original !== "function") continue;
      owner[name] = function (p, ...rest) {
        return original.call(this, redirect(p), ...rest);
      };
    }
  };
  patch(fs, [...names, ...names.map((n) => `${n}Sync`), "existsSync", "watchFile", "unwatchFile", "createReadStream", "createWriteStream"]);
  patch(fs.promises, names);
  wrapMoves((from, to) => [redirect(from), redirect(to)]);
  syncBuiltinESMExports();
}
