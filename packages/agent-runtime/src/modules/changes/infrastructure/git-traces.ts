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

/**
 * UNIT_BOUNDARY_DESCRIPTION: the directory watch fires when git creates a
 * trace, at the start of its process, and not when git appends the event
 * that ends it. While a trace is still unfinished the reader sweeps again on
 * this interval, so a command that runs a while (an editor, a slow hook)
 * links once it exits rather than when the next git process starts.
 */
export const UNFINISHED_SWEEP_MS = 1_000;

const COMPLETE = /"event":"atexit"/;

/**
 * UNIT_BOUNDARY_DESCRIPTION: the file git writes when the directory holds as
 * many traces as it allows, telling every later git process to skip its
 * trace. It is deleted at once, so tracing resumes as soon as the backlog is
 * read.
 */
const DISCARD_MARKER = "git-trace2-discard";

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
  sessionEnvVars: readonly string[];
  onCommand: (command: GitCommand) => void;
  log: (msg: string) => void;
  now?: () => number;
  unfinishedSweepMs?: number;
}): GitTraceReader {
  const now = deps.now ?? Date.now;
  let watch: WatchHandle | undefined;
  let queue = Promise.resolve();
  let retry: ReturnType<typeof setTimeout> | undefined;

  async function sweep(): Promise<boolean> {
    let unfinished = false;
    const names = await readdir(deps.dir).catch(() => [] as string[]);
    for (const name of names) {
      const path = join(deps.dir, name);
      if (name === DISCARD_MARKER) {
        deps.log("git skipped traces while their directory was full");
        await rm(path, { force: true }).catch(() => undefined);
        continue;
      }
      const text = await readFile(path, "utf8").catch(() => null);
      if (text === null) continue;
      if (!COMPLETE.test(text)) {
        const modified = await stat(path).then(
          (info) => info.mtimeMs,
          () => null,
        );
        if (modified !== null && now() - modified < STALE_TRACE_MS) {
          unfinished = true;
          continue;
        }
      }
      await rm(path, { force: true }).catch(() => undefined);
      const command = gitCommandOf(text, deps.sessionEnvVars);
      if (command) deps.onCommand(command);
    }
    return unfinished;
  }

  function sweepLater(): void {
    if (retry || !watch) return;
    retry = setTimeout(() => {
      retry = undefined;
      void drain();
    }, deps.unfinishedSweepMs ?? UNFINISHED_SWEEP_MS);
    retry.unref?.();
  }

  function drain(): Promise<void> {
    queue = queue
      .then(sweep)
      .then((unfinished) => {
        if (unfinished) sweepLater();
      })
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
      if (retry) clearTimeout(retry);
      retry = undefined;
    },
  };
}
