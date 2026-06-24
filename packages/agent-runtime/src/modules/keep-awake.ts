import { mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join } from "node:path";

// Keep-awake marker files under $HOME/.platform/keep-awake.d/; /api/status is
// not-idle while any exist. keyed/ releases by id; anon/ releases one of a
// fungible count — separate dirs so a "release one" can't drop a keyed lease.
export interface KeepAwakeStore {
  hasPin(): boolean;
  acquire(id?: string): void;
  release(id?: string): void;
  purge(): void;
}

const VALID_ID = /^[A-Za-z0-9._-]{1,128}$/;
const isSafeId = (id: string): boolean =>
  VALID_ID.test(id) && id !== "." && id !== "..";

export function createKeepAwakeStore(homeDir: string): KeepAwakeStore {
  const root = join(homeDir, ".platform", "keep-awake.d");
  const keyedDir = join(root, "keyed");
  const anonDir = join(root, "anon");

  const wipe = (dir: string): void => {
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
  };

  mkdirSync(keyedDir, { recursive: true });
  mkdirSync(anonDir, { recursive: true });

  const count = (dir: string): number => {
    try {
      return readdirSync(dir).length;
    } catch {
      return 0;
    }
  };

  return {
    hasPin: () => count(keyedDir) > 0 || count(anonDir) > 0,

    acquire(id) {
      if (id === undefined) {
        writeFileSync(join(anonDir, randomUUID()), "");
        return;
      }
      if (!isSafeId(id)) throw new Error(`invalid keep-awake id: ${id}`);
      writeFileSync(join(keyedDir, id), "");
    },

    release(id) {
      if (id === undefined) {
        // Anon pins are fungible — removing any one decrements the count.
        const [one] = readdirSync(anonDir).sort();
        if (one) rmSync(join(anonDir, one), { force: true });
        return;
      }
      if (!isSafeId(id)) throw new Error(`invalid keep-awake id: ${id}`);
      rmSync(join(keyedDir, id), { force: true });
    },

    purge() {
      wipe(keyedDir);
      wipe(anonDir);
    },
  };
}
