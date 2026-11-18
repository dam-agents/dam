import { createHash, randomUUID } from "node:crypto";
import {
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

export interface SessionMediaStore {
  put(sessionId: string, data: string): string | null;
  get(sessionId: string, key: string): string | null;
  drop(sessionId: string, key: string): void;
  forget(sessionId: string): void;
  clear(): void;
}

export interface SessionMediaRoot {
  store(): SessionMediaStore;
}

export interface SessionMediaRootDeps {
  dir: string;
  log: (msg: string) => void;
}

function removeQuietly(path: string, log: (msg: string) => void): void {
  try {
    rmSync(path, { recursive: true, force: true });
  } catch (err) {
    log(`session media: ${path} not removed: ${String(err)}`);
  }
}

function createDiskSessionMediaStore(
  dir: string,
  log: (msg: string) => void,
): SessionMediaStore {
  const sessionDir = (sessionId: string) =>
    join(dir, Buffer.from(sessionId, "utf8").toString("base64url"));
  const fileOf = (sessionId: string, key: string) =>
    join(sessionDir(sessionId), key);
  const remove = (path: string) => removeQuietly(path, log);

  return {
    put(sessionId, data) {
      const key = createHash("sha256").update(data).digest("hex");
      const path = fileOf(sessionId, key);
      const tmp = `${path}.tmp`;
      try {
        mkdirSync(sessionDir(sessionId), { recursive: true });
        writeFileSync(tmp, data, "utf8");
        renameSync(tmp, path);
        return key;
      } catch (err) {
        remove(tmp);
        log(`session media for ${sessionId}: not written: ${String(err)}`);
        return null;
      }
    },

    get(sessionId, key) {
      try {
        return readFileSync(fileOf(sessionId, key), "utf8");
      } catch {
        return null;
      }
    },

    drop(sessionId, key) {
      remove(fileOf(sessionId, key));
    },

    forget(sessionId) {
      remove(sessionDir(sessionId));
    },

    clear() {
      remove(dir);
    },
  };
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: keeps the inline image and audio bytes of each
 * Session Transcript on the machine's disk, so the in-memory log holds only
 * a key and the bytes are read back when a replay sends the frame again.
 * The root is a folder of the home's XDG cache directory, which the
 * machine's disk guard may empty when the disk runs low; the transcripts
 * live in memory only, so whatever an earlier process left there is
 * deleted when the root is made. Each runtime takes a store of its own, in
 * a fresh folder, so one runtime forgetting a Session never deletes bytes
 * another one still refers to. A file holds one block's `data` string as
 * the frame carried it, under its own SHA-256, in a folder of its Session,
 * so one image sent twice is kept once. Every call is synchronous, like the
 * transcript that calls it. A write or a read that fails answers null, and
 * the transcript keeps the bytes inline or shows a placeholder instead: the
 * disk is a cache of what the harness already keeps, not a record of its
 * own.
 */
export function createSessionMediaRoot(
  deps: SessionMediaRootDeps,
): SessionMediaRoot {
  removeQuietly(deps.dir, deps.log);
  return {
    store: () =>
      createDiskSessionMediaStore(join(deps.dir, randomUUID()), deps.log),
  };
}
