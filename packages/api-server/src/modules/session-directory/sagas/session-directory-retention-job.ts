import { SESSION_DIRECTORY_RETENTION_DAYS } from "../domain/types.js";

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const STARTUP_DELAY_MS = 5 * 60 * 1000;
const ADVISORY_LOCK_KEY = 0x73_65_73_64_69;

export type SessionDirectoryRetentionJob = {
  start(): void;
  stop(): void;
};

export type SessionDirectoryRetentionDeps = {
  withLock: (key: number, fn: () => Promise<void>) => Promise<boolean>;
  deleteOld: (days: number) => Promise<number>;
};

export function startSessionDirectoryRetentionJob(
  deps: SessionDirectoryRetentionDeps,
): SessionDirectoryRetentionJob {
  const { withLock, deleteOld } = deps;
  let timer: NodeJS.Timeout | null = null;
  let running = false;

  async function tick(): Promise<void> {
    try {
      await withLock(ADVISORY_LOCK_KEY, async () => {
        const n = await deleteOld(SESSION_DIRECTORY_RETENTION_DAYS);
        if (n > 0) {
          process.stderr.write(
            `[session-directory/retention] deleted ${n} agent_sessions older than ${SESSION_DIRECTORY_RETENTION_DAYS}d\n`,
          );
        }
      });
    } catch (err) {
      process.stderr.write(
        `[session-directory/retention] tick failed: ${err}\n`,
      );
    }
  }

  return {
    start() {
      if (running) return;
      running = true;
      timer = setTimeout(function loop() {
        tick().finally(() => {
          if (running) timer = setTimeout(loop, WEEK_MS);
        });
      }, STARTUP_DELAY_MS);
    },
    stop() {
      running = false;
      if (timer) clearTimeout(timer);
      timer = null;
    },
  };
}
