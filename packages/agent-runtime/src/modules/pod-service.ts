import { spawn } from "node:child_process";
import type { RuntimeEnvReader } from "../core/runtime-env.js";

// Supervisor for the optional image-provided pod service (ADR-065). An agent
// image may install an executable at /usr/local/bin/pod-service (a well-known
// path, like the harness shims of ADR-037); when present, the runtime keeps it
// running as a supervised child for the life of the pod — e.g. claude-code's
// local LiteLLM gateway. The runtime owns the lifecycle so the service is
// never an orphaned nohup daemon: crashes restart with backoff, env changes
// restart it against the fresh env (a service caches credentials/URLs from its
// spawn env), and exits are reaped as ordinary children of PID 1.
//
// Exit-code contract: exit 0 means "nothing to do for this env" — the service
// stays down until the env next changes. Any other exit is a crash and is
// restarted with capped exponential backoff.

const BACKOFF_INITIAL_MS = 1_000;
const BACKOFF_MAX_MS = 30_000;
// A run at least this long resets the backoff — the service was healthy, so a
// later crash is fresh, not a continuation of a startup-crash loop.
const HEALTHY_RUN_MS = 60_000;
const SIGTERM_GRACE_MS = 10_000;

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
  /**
   * Env is current — warm boot, or the env driver just rewrote it. Ensures the
   * service runs against it: starts it if down (including "declined" services
   * whose condition may now hold), or kills + respawns it so nothing keeps
   * routing on credentials/URLs captured from a stale env.
   */
  refreshEnv(): void;
  shutdown(): void;
}

export interface PodServiceSupervisorDeps {
  spawn: SpawnPodService;
  envReader: RuntimeEnvReader;
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
  let respawnOnExit = false;
  let stopped = false;
  let backoffMs = backoffInitialMs;

  function start(): void {
    // Same merge order as every other spawn path: runtime-channel env first,
    // process.env (pod env, user-set vars) wins on collision.
    const proc = deps.spawn({ ...deps.envReader.current(), ...process.env });
    child = proc;
    const startedAt = Date.now();
    deps.log("started");

    void proc.exited.then(({ code, signal }) => {
      if (child !== proc) return; // superseded by a newer spawn
      child = null;
      if (killTimer) clearTimeout(killTimer);
      killTimer = null;
      if (stopped) return;
      if (respawnOnExit) {
        respawnOnExit = false;
        backoffMs = backoffInitialMs;
        deps.log("respawning with fresh env");
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

  function killChild(): void {
    const proc = child;
    if (!proc) return;
    proc.kill("SIGTERM");
    killTimer = setTimeout(() => proc.kill("SIGKILL"), sigtermGraceMs);
  }

  return {
    refreshEnv() {
      if (stopped) return;
      if (restartTimer) {
        clearTimeout(restartTimer);
        restartTimer = null;
      }
      backoffMs = backoffInitialMs;
      if (child) {
        respawnOnExit = true;
        killChild();
      } else {
        start();
      }
    },
    shutdown() {
      stopped = true;
      if (restartTimer) clearTimeout(restartTimer);
      restartTimer = null;
      killChild();
    },
  };
}

/**
 * Production adapter: runs the executable as a direct child so PID 1 (the
 * runtime) reaps it, forwarding its output to the runtime log (i.e. pod logs).
 */
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
        // `error` fires without `exit` when the spawn itself fails; map it to
        // a crash-shaped exit so the supervisor's backoff handles it.
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
