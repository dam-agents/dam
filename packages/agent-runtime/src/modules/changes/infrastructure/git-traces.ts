import { mkdir, readdir, readFile, rm, stat } from "node:fs/promises";
import { join } from "node:path";

import { createFilesWatcher, type WatchHandle } from "../../files-watch.js";
import { gitCommandOf, type GitCommand } from "../domain/git-trace.js";

/**
 * UNIT_BOUNDARY_DESCRIPTION: a trace still being written has no atexit
 * event yet. A git process killed before it exits never writes one, so a
 * trace this old is dropped unread rather than kept waiting forever.
 */
export const STALE_TRACE_MS = 10 * 60_000;

const COMPLETE = /"event":"atexit"/;

export interface GitTraceReader {
  start(): Promise<void>;
  drain(): Promise<void>;
  close(): void;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: reads the traces git writes into the runtime's
 * trace directory, one file per git process, and hands each finished command
 * that records work to `onCommand`. A file is read once its process has
 * exited, then deleted, so the directory holds only what is still running
 * and git never reaches its file cap. Nothing of a trace is logged or kept:
 * it carries the full command line.
 */
export function createGitTraceReader(deps: {
  dir: string;
  onCommand: (command: GitCommand) => void;
  log: (msg: string) => void;
  now?: () => number;
}): GitTraceReader {
  const now = deps.now ?? Date.now;
  let watch: WatchHandle | undefined;
  let queue = Promise.resolve();

  async function sweep(): Promise<void> {
    const names = await readdir(deps.dir).catch(() => [] as string[]);
    for (const name of names) {
      const path = join(deps.dir, name);
      const text = await readFile(path, "utf8").catch(() => null);
      if (text === null) continue;
      if (!COMPLETE.test(text)) {
        const modified = await stat(path).then(
          (info) => info.mtimeMs,
          () => null,
        );
        if (modified !== null && now() - modified < STALE_TRACE_MS) continue;
      }
      await rm(path, { force: true }).catch(() => undefined);
      const command = gitCommandOf(text);
      if (command) deps.onCommand(command);
    }
  }

  function drain(): Promise<void> {
    queue = queue
      .then(sweep)
      .catch((error: unknown) =>
        deps.log(
          `reading git traces failed: ${error instanceof Error ? error.message : String(error)}`,
        ),
      );
    return queue;
  }

  return {
    async start() {
      await mkdir(deps.dir, { recursive: true, mode: 0o700 });
      watch = createFilesWatcher(deps.dir).watchDirs([""], () => {
        void drain();
      });
      await drain();
    },
    drain,
    close() {
      watch?.close();
      watch = undefined;
    },
  };
}
