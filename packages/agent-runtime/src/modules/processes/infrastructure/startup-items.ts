import { execFile } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { z } from "zod";
import type { StartupItemConfig } from "../domain/startup-items.js";

const CTL = "/usr/local/lib/platform-startup/ctl";
const OPENRC_BOOTED = "/run/openrc/softlevel";
const CTL_TIMEOUT_MS = 30_000;

const listSchema = z.object({
  items: z.array(
    z.object({
      id: z.string(),
      command: z.string(),
      disabled: z.boolean().optional(),
    }),
  ),
});

export interface StartupItemStore {
  available(): boolean;
  list(): StartupItemConfig[];
  setDisabled(id: string, disabled: boolean): boolean;
  remove(id: string): boolean;
  logPath(id: string): string;
  run(action: "start" | "stop" | "restart", id: string): Promise<string | null>;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: The agent's Startup Items as the image keeps
 * them: the list in `~/.platform/startup.json`, which the agent edits with
 * `platform-startup` and the user's Disable writes into, and the image's
 * `ctl`, which starts and stops one item. Only a vm machine, which openrc
 * booted, has them: a container agent runs the same image without openrc, and
 * an image built before Startup Items has no `ctl`. A list that does not parse
 * reads as empty, as `ctl` reads it.
 */
export function createStartupItemStore(agentHome: string): StartupItemStore {
  const listPath = join(agentHome, ".platform", "startup.json");
  const logDir = join(agentHome, ".platform", "startup-logs");

  function read(): z.infer<typeof listSchema> {
    try {
      const parsed = listSchema.safeParse(
        JSON.parse(readFileSync(listPath, "utf8")),
      );
      return parsed.success ? parsed.data : { items: [] };
    } catch {
      return { items: [] };
    }
  }

  function write(list: z.infer<typeof listSchema>): void {
    mkdirSync(dirname(listPath), { recursive: true });
    const tmp = `${listPath}.tmp`;
    writeFileSync(tmp, JSON.stringify(list, null, 2));
    renameSync(tmp, listPath);
  }

  return {
    available: () => existsSync(CTL) && existsSync(OPENRC_BOOTED),

    list() {
      return read().items.map((item) => ({
        id: item.id,
        command: item.command,
        disabled: item.disabled === true,
      }));
    },

    setDisabled(id, disabled) {
      const list = read();
      const item = list.items.find((i) => i.id === id);
      if (!item) return false;
      item.disabled = disabled || undefined;
      write(list);
      return true;
    },

    remove(id) {
      const list = read();
      if (!list.items.some((i) => i.id === id)) return false;
      write({ items: list.items.filter((i) => i.id !== id) });
      return true;
    },

    logPath: (id) => join(logDir, `${id}.log`),

    run(action, id) {
      return new Promise((resolve) => {
        execFile(
          CTL,
          [action, id],
          { timeout: CTL_TIMEOUT_MS },
          (error, _stdout, stderr) => {
            resolve(error ? stderr.trim() || error.message : null);
          },
        );
      });
    },
  };
}
