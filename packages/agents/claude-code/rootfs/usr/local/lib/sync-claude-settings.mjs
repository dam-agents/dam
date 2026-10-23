import {
  closeSync,
  linkSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";

const REPORT_BACKGROUND_WORK = "node /usr/local/lib/report-background-work.mjs";
const REPORTING_EVENTS = ["Stop", "SubagentStop"];
const LOCK_WAIT_MS = 2000;
const LOCK_STALE_MS = 30_000;

const sleep = (ms) =>
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

/**
 * UNIT_BOUNDARY_DESCRIPTION: every writer of this file takes this lock across
 * its whole read-modify-write, so no writer's change is written over by a copy
 * another writer read before it, and the write is a rename, so no reader sees a
 * partial file. A writer that takes no lock — Claude Code itself, a hand edit, a
 * kit that predates the rule — can still be overwritten between our read and
 * our rename. A lock whose writer is gone is broken, so a writer that died
 * inside its section never stops the sync for good, and a lock whose text names
 * no live writer at all — a kit that took it and died — is broken the same way;
 * of two waiters that break the same stale lock, the one whose rename took a
 * newer lock puts it back.
 */
const acquire = (lockPath) => {
  const mine = `${process.pid}:${randomUUID()}`;
  const deadline = Date.now() + LOCK_WAIT_MS;
  for (;;) {
    try {
      const fd = openSync(lockPath, "wx");
      writeSync(fd, mine);
      closeSync(fd);
      return mine;
    } catch (err) {
      if (err.code !== "EEXIST") throw err;
    }
    let holder;
    let age;
    try {
      holder = readFileSync(lockPath, "utf8").split(":")[0];
      age = Date.now() - statSync(lockPath).mtimeMs;
    } catch {
      continue;
    }
    if (age > LOCK_STALE_MS && !alive(holder)) {
      const aside = `${lockPath}.stale.${mine}`;
      try {
        renameSync(lockPath, aside);
        if (readFileSync(aside, "utf8").split(":")[0] !== holder) {
          try {
            linkSync(aside, lockPath);
          } catch {}
        }
      } catch {}
      rmSync(aside, { force: true });
      continue;
    }
    if (Date.now() >= deadline)
      throw new Error(
        `kept settings.json as it is, ${lockPath} stayed locked for ${LOCK_WAIT_MS} ms`,
      );
    sleep(5);
  }
};

const alive = (holder) => {
  if (!/^[1-9]\d*$/.test(holder)) return false;
  try {
    process.kill(Number(holder), 0);
    return true;
  } catch (err) {
    return err.code !== "ESRCH";
  }
};

const release = (lockPath, mine) => {
  try {
    if (readFileSync(lockPath, "utf8") === mine) unlinkSync(lockPath);
  } catch {}
};

try {
  const path = join(process.env.HOME, ".claude", "settings.json");
  const lockPath = `${path}.lock`;
  mkdirSync(dirname(path), { recursive: true });
  const mine = acquire(lockPath);
  try {
    let settings;
    try {
      settings = JSON.parse(readFileSync(path, "utf8"));
    } catch (err) {
      if (err.code !== "ENOENT")
        throw new Error(
          `kept settings.json as it is, it cannot be read: ${err.message}`,
        );
      settings = {};
    }
    if (
      settings === null ||
      typeof settings !== "object" ||
      Array.isArray(settings)
    )
      throw new Error(`kept settings.json as it is, it is no settings object`);

    const before = JSON.stringify(settings);

    const env = Object.fromEntries(
      Object.entries(settings.env ?? {}).filter(([k]) => !k.startsWith("OTEL_")),
    );
    for (const [k, v] of Object.entries(process.env))
      if (k.startsWith("OTEL_")) env[k] = v;
    if (Object.keys(env).length) settings.env = env;
    else delete settings.env;

    const hooks = settings.hooks ?? {};
    for (const event of REPORTING_EVENTS) {
      const others = (hooks[event] ?? [])
        .map((matcher) => ({
          ...matcher,
          hooks: (matcher.hooks ?? []).filter(
            (hook) => hook.command !== REPORT_BACKGROUND_WORK,
          ),
        }))
        .filter((matcher) => matcher.hooks.length > 0);
      hooks[event] = [
        ...others,
        { hooks: [{ type: "command", command: REPORT_BACKGROUND_WORK }] },
      ];
    }
    settings.hooks = hooks;

    if (JSON.stringify(settings) !== before) {
      const tmp = `${path}.${process.pid}.tmp`;
      try {
        writeFileSync(tmp, JSON.stringify(settings, null, 2));
        renameSync(tmp, path);
      } catch (err) {
        rmSync(tmp, { force: true });
        throw err;
      }
    }
  } finally {
    release(lockPath, mine);
  }
} catch (err) {
  process.stderr.write(`sync-claude-settings: ${err.message}\n`);
}
