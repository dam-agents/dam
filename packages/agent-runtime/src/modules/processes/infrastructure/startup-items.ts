import {
  existsSync,
  linkSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { startupItemIdSchema } from "agent-runtime-api";
import type { StartupItemConfig } from "../domain/startup-items.js";
import { describeFailure, runOnce } from "../../../core/run-once.js";

const OPENRC_BOOTED = "/run/openrc/softlevel";
const RC_TIMEOUT_MS = 30_000;

export interface StartupItemStore {
  available(): boolean;
  list(): StartupItemConfig[];
  create(id: string, text: string): "written" | "same" | "taken";
  setDisabled(id: string, disabled: boolean): Promise<boolean>;
  remove(id: string): Promise<boolean>;
  logPath(id: string): string;
  run(action: "start" | "stop" | "restart", id: string): Promise<string | null>;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: The agent's Startup Items as the image keeps
 * them: openrc's user services for root, a script each in
 * `~/.config/rc/init.d`, started at boot when `~/.config/rc/runlevels/default`
 * links it. The agent writes them, or the platform for a starter kit that
 * declares them, which never replaces a script already there; the user's
 * Disable removes the link and Remove deletes both, and Start, Stop and
 * Restart go through `rc-service --user`. Only a vm machine, which openrc booted, has them: a
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

  async function rcService(args: string[]): Promise<string | null> {
    const result = await runOnce({
      command: ["rc-service", "--user", ...args],
      timeoutMs: RC_TIMEOUT_MS,
      env: {
        PATH: process.env.PATH,
        HOME: agentHome,
        XDG_RUNTIME_DIR: process.env.XDG_RUNTIME_DIR,
      },
    });
    return result.ok ? null : describeFailure("rc-service", result.error);
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

    create(id, text) {
      const target = script(id);
      const draft = join(initDir, `.${name(id)}.${process.pid}.new`);
      mkdirSync(initDir, { recursive: true });
      writeFileSync(draft, text, { mode: 0o755 });
      try {
        linkSync(draft, target);
        return "written";
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        return readFileSync(target, "utf8") === text ? "same" : "taken";
      } finally {
        rmSync(draft, { force: true });
      }
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
