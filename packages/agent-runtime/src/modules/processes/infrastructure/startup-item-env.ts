import {
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";

const NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
const UNSAFE_VALUE = /^\$|["'#\r\n]/;
const RUNTIME_OWN = new Set(["PORT", "PWD", "OLDPWD", "SHLVL", "_"]);

export interface StartupItemEnvFile {
  write(env: NodeJS.ProcessEnv): boolean;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: The runtime's env as the agent's Startup Items
 * get it: `~/.config/rc/profile.env`, which openrc reads in user mode at every
 * `openrc --user` and `rc-service --user`, and from which it adds each
 * variable its env filter left unset. So an item holds what the pod service
 * holds, the connection placeholders included, while PATH and the gateway's
 * variables stay what the filter passed. The runtime's own listen port and
 * shell state are not the agent's env: a service that serves on `PORT` would
 * take the runtime's. openrc's parser cuts a value at a quote or a `#` and
 * keeps one that starts with `$` as the whole line, so such a value, and a
 * name no shell takes, is left out rather than delivered wrong. A write says
 * whether the file changed, so the caller restarts items only for a new env.
 */
export function createStartupItemEnvFile(
  agentHome: string,
): StartupItemEnvFile {
  const path = join(agentHome, ".config", "rc", "profile.env");

  function current(): string | null {
    try {
      return readFileSync(path, "utf8");
    } catch {
      return null;
    }
  }

  return {
    write(env) {
      const content = Object.entries(env)
        .filter(
          (entry): entry is [string, string] =>
            entry[1] !== undefined &&
            NAME.test(entry[0]) &&
            !RUNTIME_OWN.has(entry[0]) &&
            !UNSAFE_VALUE.test(entry[1]),
        )
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([name, value]) => `${name}=${value}\n`)
        .join("");
      if (current() === content) return false;
      const tmp = `${path}.${process.pid}.tmp`;
      try {
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(tmp, content, { mode: 0o600 });
        renameSync(tmp, path);
      } catch (err) {
        rmSync(tmp, { force: true });
        throw err;
      }
      return true;
    },
  };
}
