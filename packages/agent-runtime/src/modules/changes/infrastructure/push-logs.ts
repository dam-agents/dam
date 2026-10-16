import { open, readdir, stat } from "node:fs/promises";
import { join, relative } from "node:path";

import { createFilesWatcher, type WatchHandle } from "../../files-watch.js";
import {
  completeLinesOf,
  pushedRefOf,
  pushEntriesIn,
  type PushedRef,
} from "../domain/push-log.js";

export const PUSH_LOG_DIR = "logs/refs/remotes";
export const MAX_WATCHED_REPOSITORIES = 200;

export interface Push extends PushedRef {
  commonDir: string;
  at: number;
}

export interface PushLogWatcher {
  watch(commonDirs: readonly string[]): Promise<void>;
  close(): void;
}

async function logFilesUnder(dir: string): Promise<string[]> {
  const entries = await readdir(dir, {
    recursive: true,
    withFileTypes: true,
  }).catch(() => []);
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name));
}

async function readFrom(path: string, offset: number, size: number) {
  const handle = await open(path, "r");
  try {
    const buffer = Buffer.alloc(size - offset);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, offset);
    return buffer.subarray(0, bytesRead).toString("utf8");
  } finally {
    await handle.close();
  }
}

export function createPushLogWatcher(deps: {
  onPush: (push: Push) => void;
  log: (msg: string) => void;
}): PushLogWatcher {
  const watched = new Map<string, WatchHandle>();
  const pending = new Set<string>();
  let capLogged = false;

  async function scan(
    commonDir: string,
    offsets: Map<string, number>,
    initial: boolean,
  ): Promise<void> {
    const dir = join(commonDir, PUSH_LOG_DIR);
    for (const path of await logFilesUnder(dir)) {
      const size = await stat(path).then(
        (info) => info.size,
        () => null,
      );
      if (size === null) continue;
      const known = offsets.get(path);
      if (initial || (known !== undefined && size === known)) {
        offsets.set(path, size);
        continue;
      }
      const from = known !== undefined && size > known ? known : 0;
      const text = completeLinesOf(await readFrom(path, from, size));
      offsets.set(path, from + Buffer.byteLength(text));
      const ref = pushedRefOf(relative(dir, path));
      if (!ref) continue;
      for (const entry of pushEntriesIn(text))
        deps.onPush({ commonDir, ...ref, at: entry.at });
    }
  }

  async function watchOne(commonDir: string): Promise<void> {
    if (pending.has(commonDir) || watched.has(commonDir)) return;
    pending.add(commonDir);
    try {
      await watchFresh(commonDir);
    } finally {
      pending.delete(commonDir);
    }
  }

  async function watchFresh(commonDir: string): Promise<void> {
    const exists = await stat(join(commonDir, PUSH_LOG_DIR)).then(
      (info) => info.isDirectory(),
      () => false,
    );
    if (!exists) return;
    const offsets = new Map<string, number>();
    let queue = scan(commonDir, offsets, true).catch(() => undefined);
    const rescan = () => {
      queue = queue
        .then(() => scan(commonDir, offsets, false))
        .catch((error: unknown) =>
          deps.log(
            `reading the push log of ${commonDir} failed: ${error instanceof Error ? error.message : String(error)}`,
          ),
        );
    };
    watched.set(
      commonDir,
      createFilesWatcher(commonDir).watchTree(PUSH_LOG_DIR, rescan),
    );
    await queue;
  }

  return {
    async watch(commonDirs) {
      for (const commonDir of commonDirs) {
        if (watched.has(commonDir) || pending.has(commonDir)) continue;
        if (watched.size >= MAX_WATCHED_REPOSITORIES) {
          if (!capLogged)
            deps.log(
              `watching the push logs of ${MAX_WATCHED_REPOSITORIES} repositories already; more are not watched`,
            );
          capLogged = true;
          return;
        }
        await watchOne(commonDir);
      }
    },
    close() {
      for (const handle of watched.values()) handle.close();
      watched.clear();
    },
  };
}
