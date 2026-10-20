import { execFile } from "node:child_process";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { join } from "node:path";
import { startupItemIdSchema } from "agent-runtime-api";
import type { StartupItemConfig } from "../domain/startup-items.js";

const OPENRC_BOOTED = "/run/openrc/softlevel";
const RC_TIMEOUT_MS = 30_000;

export interface StartupItemStore {
  available(): boolean;
  list(): StartupItemConfig[];
  setDisabled(id: string, disabled: boolean): Promise<boolean>;
  remove(id: string): Promise<boolean>;
  logPath(id: string): string;
  run(action: "start" | "stop" | "restart", id: string): Promise<string | null>;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: The agent's Startup Items as the image keeps
 * them: openrc's user services for root, a script each in
 * `~/.config/rc/init.d`, started at boot when `~/.config/rc/runlevels/default`
 * links it. The agent writes them; the user's Disable removes the link and
 * Remove deletes both, and Start, Stop and Restart go through
 * `rc-service --user`. Only a vm machine, which openrc booted, has them: a
 * container agent runs the same image without openrc. A name is read under
 * the same rule as the scan's, so a file of another shape is not an item and
 * never names a path outside the log directory.
 */
export function createStartupItemStore(agentHome: string): StartupItemStore {
  const initDir = join(agentHome, ".config", "rc", "init.d");
  const bootDir = join(agentHome, ".config", "rc", "runlevels", "default");
  const logDir = join(agentHome, ".local", "state", "rc");

  const name = (id: string) => startupItemIdSchema.parse(id);
  const script = (id: string) => join(initDir, name(id));
  const bootLink = (id: string) => join(bootDir, name(id));

  function present(path: string): boolean {
    try {
      lstatSync(path);
      return true;
    } catch {
      return false;
    }
  }

  function commandOf(path: string): string {
    try {
      const text = readFileSync(path, "utf8");
      const command = /^\s*command="?([^"\n]*)"?\s*$/m.exec(text)?.[1] ?? "";
      const args = /^\s*command_args="([^"]*)"\s*$/m.exec(text)?.[1] ?? "";
      return [command, args].filter(Boolean).join(" ") || path;
    } catch {
      return path;
    }
  }

  function rcService(args: string[]): Promise<string | null> {
    return new Promise((resolve) => {
      execFile(
        "rc-service",
        ["--user", ...args],
        {
          timeout: RC_TIMEOUT_MS,
          env: {
            PATH: process.env.PATH,
            HOME: agentHome,
            XDG_RUNTIME_DIR: process.env.XDG_RUNTIME_DIR,
          },
        },
        (error, stdout, stderr) => {
          resolve(error ? `${stderr}${stdout}`.trim() || error.message : null);
        },
      );
    });
  }

  return {
    available: () => existsSync(OPENRC_BOOTED),

    list() {
      let entries: string[];
      try {
        entries = readdirSync(initDir);
      } catch {
        return [];
      }
      return entries
        .filter((entry) => startupItemIdSchema.safeParse(entry).success)
        .sort()
        .map((id) => ({
          id,
          command: commandOf(join(initDir, id)),
          disabled: !present(join(bootDir, id)),
        }));
    },

    async setDisabled(id, disabled) {
      if (!present(script(id))) return false;
      if (disabled) rmSync(bootLink(id), { force: true });
      else if (!present(bootLink(id))) {
        mkdirSync(bootDir, { recursive: true });
        symlinkSync(script(id), bootLink(id));
      }
      return true;
    },

    async remove(id) {
      if (!present(script(id))) return false;
      rmSync(bootLink(id), { force: true });
      rmSync(script(id), { force: true });
      return true;
    },

    logPath: (id) => join(logDir, `${name(id)}.log`),

    run: (action, id) => rcService([name(id), action]),
  };
}
