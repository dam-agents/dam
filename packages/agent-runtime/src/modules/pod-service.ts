import { spawn } from "node:child_process";
import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { RuntimeEnvReader } from "../core/runtime-env.js";

const BACKOFF_INITIAL_MS = 1_000;
const BACKOFF_MAX_MS = 30_000;
// A run at least this long resets the backoff — a later crash is fresh, not
// a continuation of a startup-crash loop.
const HEALTHY_RUN_MS = 60_000;
const SIGTERM_GRACE_MS = 10_000;

export interface PodServiceSupervisor {
  refreshEnv(): void;
  shutdown(): void;
}

export function createPodServiceSupervisor(opts: {
  command: string;
  snapshotPath: string;
  envReader: RuntimeEnvReader;
  log: (msg: string) => void;
}): PodServiceSupervisor {
  const { command, snapshotPath, envReader, log } = opts;

  let child: ReturnType<typeof spawn> | null = null;
  let restartTimer: ReturnType<typeof setTimeout> | null = null;
  let killTimer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;
  let backoffMs = BACKOFF_INITIAL_MS;

  // If the runtime itself dies, don't leave the service running unreaped.
  process.once("exit", () => {
    try {
      child?.kill("SIGKILL");
    } catch {
      // already gone
    }
  });

  // Same merge order as every other spawn path: runtime-channel env first,
  // process.env wins on collision. The snapshot is what the service re-reads
  // on SIGHUP, so it must be written before the signal lands.
  const mergedEnv = () => ({ ...envReader.current(), ...process.env });

  function writeSnapshot(): void {
    mkdirSync(dirname(snapshotPath), { recursive: true });
    // Atomic (tmp + rename) so a SIGHUP handler never reads a partial file.
    writeFileSync(`${snapshotPath}.tmp`, JSON.stringify({ env: mergedEnv() }));
    renameSync(`${snapshotPath}.tmp`, snapshotPath);
  }

  function start(): void {
    const proc = spawn(command, [], {
      env: mergedEnv(),
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
      if (killTimer) clearTimeout(killTimer);
      killTimer = null;
      if (stopped) return;
      if (signal === "SIGHUP") {
        // Didn't handle the reload signal — respawn against the fresh env.
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
      if (stopped) return;
      if (restartTimer) {
        clearTimeout(restartTimer);
        restartTimer = null;
      }
      backoffMs = BACKOFF_INITIAL_MS;
      writeSnapshot();
      if (child) child.kill("SIGHUP");
      else start();
    },
    shutdown() {
      stopped = true;
      if (restartTimer) clearTimeout(restartTimer);
      restartTimer = null;
      const proc = child;
      if (!proc) return;
      proc.kill("SIGTERM");
      killTimer = setTimeout(() => proc.kill("SIGKILL"), SIGTERM_GRACE_MS);
    },
  };
}
