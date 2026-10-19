import { execFile, spawn } from "node:child_process";
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { z } from "zod";
import { startupItemIdSchema } from "agent-runtime-api";
import type { StartupItemConfig } from "../domain/startup-items.js";

const CTL = "/usr/local/lib/platform-startup/ctl";
const OPENRC_BOOTED = "/run/openrc/softlevel";
const CTL_TIMEOUT_MS = 30_000;
// UNIT_BOUNDARY_DESCRIPTION: how long a write waits for the list lock. `platform-startup add` holds it while it stops the old instance, which takes up to 15 seconds, and starts the new one.
const LOCK_WAIT_S = 60;

const entrySchema = z.object({
  id: startupItemIdSchema,
  command: z.string(),
  disabled: z.boolean().optional(),
});

type Entry = z.infer<typeof entrySchema>;

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
 * them: the list in `~/.platform/startup.json`, which the agent edits with
 * `platform-startup` and the user's Disable writes into, and the image's
 * `ctl`, which starts and stops one item. Only a vm machine, which openrc
 * booted, has them: a container agent runs the same image without openrc, and
 * an image built before Startup Items has no `ctl`. Each entry is read on its
 * own, with the same id rule `ctl` applies, and a malformed entry is dropped
 * alone, so the runtime and the boot see the same items and an id never names
 * a path outside the log directory. A write keeps the entries it cannot read,
 * so the agent's own file loses nothing to the user's choice. Every write
 * holds the list lock `platform-startup` holds, so neither loses the other's
 * write. Node has no flock: `flock(1)` locks a descriptor this process
 * opened and passes it, and the lock stays with that open file until the
 * write is done and it is closed.
 */
export function createStartupItemStore(agentHome: string): StartupItemStore {
  const listPath = join(agentHome, ".platform", "startup.json");
  const logDir = join(agentHome, ".platform", "startup-logs");
  const lockPath = join(agentHome, ".platform", "startup.lock");

  async function locked<T>(change: () => T): Promise<T> {
    mkdirSync(dirname(lockPath), { recursive: true });
    const fd = openSync(lockPath, "a");
    try {
      const code = await new Promise<number | null>((resolve) => {
        const child = spawn("flock", ["-x", "-w", String(LOCK_WAIT_S), "3"], {
          stdio: ["ignore", "ignore", "ignore", fd],
        });
        child.on("error", () => resolve(null));
        child.on("exit", resolve);
      });
      if (code !== 0)
        throw new Error("the Startup Items list stayed locked; try again");
      return change();
    } finally {
      closeSync(fd);
    }
  }

  function readRaw(): unknown[] {
    try {
      const parsed: unknown = JSON.parse(readFileSync(listPath, "utf8"));
      const items =
        typeof parsed === "object" && parsed !== null
          ? (parsed as { items?: unknown }).items
          : undefined;
      return Array.isArray(items) ? items : [];
    } catch {
      return [];
    }
  }

  function entries(raw: unknown[]): Entry[] {
    return raw.flatMap((item) => {
      const entry = entrySchema.safeParse(item);
      return entry.success ? [entry.data] : [];
    });
  }

  function write(raw: unknown[]): void {
    mkdirSync(dirname(listPath), { recursive: true });
    const tmp = `${listPath}.tmp`;
    writeFileSync(tmp, JSON.stringify({ items: raw }, null, 2));
    renameSync(tmp, listPath);
  }

  function isEntry(item: unknown, id: string): boolean {
    return entrySchema.safeParse(item).data?.id === id;
  }

  return {
    available: () => existsSync(CTL) && existsSync(OPENRC_BOOTED),

    list() {
      return entries(readRaw()).map((item) => ({
        id: item.id,
        command: item.command,
        disabled: item.disabled === true,
      }));
    },

    setDisabled: (id, disabled) =>
      locked(() => {
        const raw = readRaw();
        const index = raw.findIndex((item) => isEntry(item, id));
        if (index === -1) return false;
        const { disabled: _drop, ...rest } = raw[index] as Entry;
        raw[index] = disabled ? { ...rest, disabled: true } : rest;
        write(raw);
        return true;
      }),

    remove: (id) =>
      locked(() => {
        const raw = readRaw();
        if (!raw.some((item) => isEntry(item, id))) return false;
        write(raw.filter((item) => !isEntry(item, id)));
        return true;
      }),

    logPath: (id) => join(logDir, `${startupItemIdSchema.parse(id)}.log`),

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
