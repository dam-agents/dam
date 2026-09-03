import { watch, type FSWatcher } from "node:fs";
import { readdir } from "node:fs/promises";

import { safePath, touchesReserved } from "./files.js";

const COALESCE_MS = 250;
const RETRY_MS = 2_000;

export interface WatchHandle {
  close(): void;
}

function coalescing(onChange: () => void, coalesceMs: number) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return {
    fire() {
      if (timer) return;
      timer = setTimeout(() => {
        timer = undefined;
        onChange();
      }, coalesceMs);
      timer.unref?.();
    },
    cancel() {
      if (timer) clearTimeout(timer);
      timer = undefined;
    },
  };
}

async function entrySignature(abs: string): Promise<string | null> {
  try {
    const entries = await readdir(abs, { withFileTypes: true });
    return entries
      .map((entry) => `${entry.isDirectory() ? "d" : "f"}:${entry.name}`)
      .sort()
      .join(" ");
  } catch {
    return null;
  }
}

export function createFilesWatcher(
  workingDir: string,
  opts: { coalesceMs?: number; retryMs?: number } = {},
) {
  const coalesceMs = opts.coalesceMs ?? COALESCE_MS;
  const retryMs = opts.retryMs ?? RETRY_MS;

  function watchDirs(
    paths: readonly string[],
    onChange: () => void,
  ): WatchHandle {
    const sink = coalescing(onChange, coalesceMs);
    const watchers = new Map<string, FSWatcher>();
    const diffed = new Map<string, string | null>();
    let closed = false;

    const attach = (rel: string): void => {
      if (closed || watchers.has(rel) || diffed.has(rel)) return;
      if (touchesReserved(rel)) return;
      const abs = safePath(workingDir, rel);
      if (abs === null) return;
      try {
        const watcher = watch(abs, { persistent: false }, (eventType) => {
          if (eventType === "rename") sink.fire();
        });
        watcher.on("error", () => {
          watcher.close();
          watchers.delete(rel);
        });
        watchers.set(rel, watcher);
      } catch {
        diffed.set(rel, null);
      }
    };

    for (const rel of paths) attach(rel);

    const sweep = setInterval(() => {
      if (closed) return;
      for (const rel of paths) attach(rel);
      if (diffed.size === 0) return;
      void (async () => {
        let changed = false;
        for (const rel of [...diffed.keys()]) {
          const abs = safePath(workingDir, rel);
          if (abs === null) continue;
          const next = await entrySignature(abs);
          if (diffed.get(rel) === next) continue;
          diffed.set(rel, next);
          changed = true;
        }
        if (changed) sink.fire();
      })();
    }, retryMs);
    sweep.unref?.();

    return {
      close() {
        closed = true;
        sink.cancel();
        clearInterval(sweep);
        for (const watcher of watchers.values()) watcher.close();
        watchers.clear();
        diffed.clear();
      },
    };
  }

  /**
   * UNIT_BOUNDARY_DESCRIPTION: recursive subtree watch for whole share roots —
   * unlike watchDirs (entry-list churn of explicit directories) it reacts to
   * content edits anywhere under the tree, because its consumer treats any
   * change as "republish soon". Platform-unsupported recursive watch degrades
   * to silence rather than an error: the caller's turn/wake backstops keep
   * correctness, the watch only adds freshness.
   */
  function watchTree(rel: string, onChange: () => void): WatchHandle {
    const sink = coalescing(onChange, coalesceMs);
    let watcher: FSWatcher | undefined;
    let closed = false;
    let unsupported = false;

    function attach(): void {
      if (closed || watcher || unsupported) return;
      if (touchesReserved(rel)) return;
      const abs = safePath(workingDir, rel);
      if (abs === null) return;
      try {
        watcher = watch(abs, { recursive: true, persistent: false }, () => {
          sink.fire();
        });
        watcher.on("error", () => {
          watcher?.close();
          watcher = undefined;
        });
      } catch (err) {
        if (
          err instanceof Error &&
          "code" in err &&
          err.code === "ERR_FEATURE_UNAVAILABLE_ON_PLATFORM"
        ) {
          unsupported = true;
        }
        watcher = undefined;
      }
    }

    attach();

    const sweep = setInterval(() => attach(), retryMs);
    sweep.unref?.();

    return {
      close() {
        closed = true;
        sink.cancel();
        clearInterval(sweep);
        watcher?.close();
        watcher = undefined;
      },
    };
  }

  function watchFile(rel: string, onChange: () => void): WatchHandle {
    const sink = coalescing(onChange, coalesceMs);
    let watcher: FSWatcher | undefined;
    let closed = false;

    const reattach = (): void => {
      watcher?.close();
      watcher = undefined;
      attach();
    };

    function attach(): void {
      if (closed || watcher) return;
      if (touchesReserved(rel)) return;
      const abs = safePath(workingDir, rel);
      if (abs === null) return;
      try {
        watcher = watch(abs, { persistent: false }, (eventType) => {
          sink.fire();
          if (eventType === "rename") reattach();
        });
        watcher.on("error", () => reattach());
      } catch {
        watcher = undefined;
      }
    }

    attach();

    const sweep = setInterval(() => attach(), retryMs);
    sweep.unref?.();

    return {
      close() {
        closed = true;
        sink.cancel();
        clearInterval(sweep);
        watcher?.close();
        watcher = undefined;
      },
    };
  }

  return { watchDirs, watchFile, watchTree };
}

export type FilesWatcher = ReturnType<typeof createFilesWatcher>;
