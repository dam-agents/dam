import { spawn } from "node:child_process";
import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { RuntimeEnvReader } from "../core/runtime-env.js";

// Supervisor for the optional image-provided pod service (ADR-065),
// installed at /usr/local/bin/pod-service like the ADR-037 harness shims.
//
// Env changes reload in place: a running process's environ can't be
// rewritten from outside, so the supervisor persists the merged env to a
// snapshot file and sends SIGHUP. A service that handles it re-reads the
// snapshot; one that doesn't dies by the default signal action and is
// respawned with the fresh env — both paths converge on the same env.
//
// Exit-code contract: exit 0 means "nothing to do for this env" (down until
// the env next changes); any other exit is a crash, restarted with capped
// backoff.

const BACKOFF_INITIAL_MS = 1_000;
const BACKOFF_MAX_MS = 30_000;
// A run at least this long resets the backoff — a later crash is fresh, not
// a continuation of a startup-crash loop.
const HEALTHY_RUN_MS = 60_000;
const SIGTERM_GRACE_MS = 10_000;

const SNAPSHOT_NOTE =
  "Managed by agent-runtime (ADR-065). The merged env the pod service was " +
  "(re)started with; the service re-reads it on SIGHUP. Do not edit.";

/** Narrow process port so tests can fake the child without an EventEmitter. */
export interface PodServiceProcess {
  kill(signal: NodeJS.Signals): void;
  /** Resolves exactly once, when the process is gone (spawn failure included). */
  exited: Promise<{ code: number | null; signal: string | null }>;
}

export type SpawnPodService = (
  env: Record<string, string | undefined>,
) => PodServiceProcess;

export interface PodServiceSupervisor {
  /** Env is current (warm boot or driver rewrite): snapshot it, then start
   *  the service or SIGHUP a running one. */
  refreshEnv(): void;
  shutdown(): void;
}

export interface PodServiceSupervisorDeps {
  spawn: SpawnPodService;
  envReader: RuntimeEnvReader;
  writeEnvSnapshot: (env: Record<string, string | undefined>) => void;
  log: (msg: string) => void;
  /** Test seams — production uses the defaults above. */
  backoffInitialMs?: number;
  backoffMaxMs?: number;
  healthyRunMs?: number;
  sigtermGraceMs?: number;
}

export function createPodServiceSupervisor(
  deps: PodServiceSupervisorDeps,
): PodServiceSupervisor {
  const backoffInitialMs = deps.backoffInitialMs ?? BACKOFF_INITIAL_MS;
  const backoffMaxMs = deps.backoffMaxMs ?? BACKOFF_MAX_MS;
  const healthyRunMs = deps.healthyRunMs ?? HEALTHY_RUN_MS;
  const sigtermGraceMs = deps.sigtermGraceMs ?? SIGTERM_GRACE_MS;

  let child: PodServiceProcess | null = null;
  let restartTimer: ReturnType<typeof setTimeout> | null = null;
  let killTimer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;
  let backoffMs = backoffInitialMs;

  // Same merge order as every other spawn path: runtime-channel env first,
  // process.env wins on collision.
  const mergedEnv = () => ({ ...deps.envReader.current(), ...process.env });

  function start(): void {
    const proc = deps.spawn(mergedEnv());
    child = proc;
    const startedAt = Date.now();
    deps.log("started");

    void proc.exited.then(({ code, signal }) => {
      if (child !== proc) return; // superseded by a newer spawn
      child = null;
      if (killTimer) clearTimeout(killTimer);
      killTimer = null;
      if (stopped) return;
      if (signal === "SIGHUP") {
        backoffMs = backoffInitialMs;
        deps.log("did not handle reload; respawning with fresh env");
        start();
        return;
      }
      if (code === 0) {
        deps.log("exited cleanly; staying down until env changes");
        return;
      }
      if (Date.now() - startedAt >= healthyRunMs) backoffMs = backoffInitialMs;
      deps.log(
        `exited (code ${code}, signal ${signal}); restarting in ${backoffMs}ms`,
      );
      restartTimer = setTimeout(() => {
        restartTimer = null;
        start();
      }, backoffMs);
      backoffMs = Math.min(backoffMs * 2, backoffMaxMs);
    });
  }

  return {
    refreshEnv() {
      if (stopped) return;
      if (restartTimer) {
        clearTimeout(restartTimer);
        restartTimer = null;
      }
      backoffMs = backoffInitialMs;
      // Snapshot before the signal: the file must hold the fresh env by the
      // time the handler reads it.
      deps.writeEnvSnapshot(mergedEnv());
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
      killTimer = setTimeout(() => proc.kill("SIGKILL"), sigtermGraceMs);
    },
  };
}

/** Production adapter: direct child of the runtime (PID 1 reaps it), output
 *  forwarded to the pod log stream. */
export function spawnPodServiceProcess(
  command: string,
  log: (msg: string) => void,
): SpawnPodService {
  // If the runtime itself dies, don't leave the service running unreaped.
  let current: ReturnType<typeof spawn> | null = null;
  process.once("exit", () => {
    try {
      current?.kill("SIGKILL");
    } catch {
      // already gone
    }
  });

  return (env) => {
    const proc = spawn(command, [], {
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    current = proc;
    proc.stdout.on("data", (c: Buffer) => log(c.toString().trimEnd()));
    proc.stderr.on("data", (c: Buffer) => log(c.toString().trimEnd()));
    const exited = new Promise<{ code: number | null; signal: string | null }>(
      (resolve) => {
        // `error` fires without `exit` when the spawn itself fails; map it
        // to a crash-shaped exit so the backoff handles it.
        proc.on("error", (err) => {
          log(`spawn failed: ${err.message}`);
          resolve({ code: null, signal: null });
        });
        proc.on("exit", (code, signal) => resolve({ code, signal }));
      },
    );
    return { kill: (sig) => proc.kill(sig), exited };
  };
}

/** Atomic write (tmp + rename) so a SIGHUP handler never reads a
 *  half-written snapshot. */
export function createEnvSnapshotWriter(
  path: string,
): (env: Record<string, string | undefined>) => void {
  return (env) => {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(`${path}.tmp`, JSON.stringify({ _note: SNAPSHOT_NOTE, env }));
    renameSync(`${path}.tmp`, path);
  };
}
