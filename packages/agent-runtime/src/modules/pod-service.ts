import { spawn } from "node:child_process";
import type { DocumentStore } from "../core/document-store.js";
import { mergedSpawnEnv, type RuntimeEnvReader } from "../core/runtime-env.js";

const BACKOFF_INITIAL_MS = 1_000;
const BACKOFF_MAX_MS = 30_000;
// A run at least this long resets the backoff — a later crash is fresh, not
// a continuation of a startup-crash loop.
const HEALTHY_RUN_MS = 60_000;

export interface PodServiceSupervisor {
  refreshEnv(): void;
}

export function createPodServiceSupervisor(opts: {
  command: string;
  snapshot: DocumentStore<{ env: NodeJS.ProcessEnv }>;
  envReader: RuntimeEnvReader;
  log: (msg: string) => void;
}): PodServiceSupervisor {
  const { command, snapshot, envReader, log } = opts;

  let child: ReturnType<typeof spawn> | null = null;
  let restartTimer: ReturnType<typeof setTimeout> | null = null;
  let backoffMs = BACKOFF_INITIAL_MS;

  process.once("exit", () => {
    try {
      child?.kill("SIGKILL");
    } catch {
      // already gone
    }
  });

  function start(): void {
    const proc = spawn(command, [], {
      env: mergedSpawnEnv(envReader),
      stdio: ["ignore", "pipe", "pipe"],
    });
    child = proc;
    const startedAt = Date.now();
    log("started");
    proc.stdout?.on("data", (c: Buffer) => log(c.toString().trimEnd()));
    proc.stderr?.on("data", (c: Buffer) => log(c.toString().trimEnd()));

    const onExit = (code: number | null, signal: string | null): void => {
      if (child !== proc) return; // superseded, or already handled
      child = null;
      if (signal === "SIGHUP") {
        backoffMs = BACKOFF_INITIAL_MS;
        log("did not handle reload; respawning with fresh env");
        start();
        return;
      }
      if (code === 0) {
        log("exited cleanly; staying down until env changes");
        return;
      }
      if (Date.now() - startedAt >= HEALTHY_RUN_MS)
        backoffMs = BACKOFF_INITIAL_MS;
      log(
        `exited (code ${code}, signal ${signal}); restarting in ${backoffMs}ms`,
      );
      restartTimer = setTimeout(() => {
        restartTimer = null;
        start();
      }, backoffMs);
      backoffMs = Math.min(backoffMs * 2, BACKOFF_MAX_MS);
    };
    proc.on("exit", onExit);
    // `error` fires without `exit` when the spawn itself fails; map it to a
    // crash-shaped exit so the backoff handles it.
    proc.on("error", (err) => {
      log(`spawn failed: ${err.message}`);
      onExit(null, null);
    });
  }

  return {
    refreshEnv() {
      if (restartTimer) clearTimeout(restartTimer);
      restartTimer = null;
      backoffMs = BACKOFF_INITIAL_MS;
      snapshot.write({ env: mergedSpawnEnv(envReader) });
      if (child) child.kill("SIGHUP");
      else start();
    },
  };
}
