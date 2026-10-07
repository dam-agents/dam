import { spawn, type ChildProcess } from "node:child_process";
import { mergedSpawnEnv, type RuntimeEnvReader } from "../core/runtime-env.js";

const BACKOFF_INITIAL_MS = 1_000;
const BACKOFF_MAX_MS = 30_000;
const HEALTHY_RUN_MS = 60_000;

export interface DisplaySupervisor {
  stop(): void;
}

// Runs platform-display, the browser panel's display stack, for the life of
// the runtime: it exits as soon as any part of the stack dies, and is started
// again, with a backoff while it keeps failing. It runs in a process group of
// its own, which is killed whole.
export function startDisplaySupervisor(opts: {
  command: string;
  envReader?: RuntimeEnvReader;
  spawnEnv?: () => NodeJS.ProcessEnv;
  log: (msg: string) => void;
  backoffInitialMs?: number;
}): DisplaySupervisor {
  const initial = opts.backoffInitialMs ?? BACKOFF_INITIAL_MS;
  const env =
    opts.spawnEnv ??
    (() => (opts.envReader ? mergedSpawnEnv(opts.envReader) : process.env));
  let child: ChildProcess | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let backoffMs = initial;
  let stopped = false;

  const killGroup = (pid: number | undefined) => {
    if (!pid) return;
    try {
      process.kill(-pid, "SIGKILL");
    } catch {}
  };
  process.once("exit", () => killGroup(child?.pid));

  function start() {
    timer = null;
    if (stopped) return;
    const proc = spawn(opts.command, [], {
      env: env(),
      detached: true,
      stdio: ["ignore", "ignore", "pipe"],
    });
    child = proc;
    const startedAt = Date.now();
    proc.stderr?.on("data", (c: Buffer) => opts.log(c.toString().trimEnd()));
    const onExit = (code: number | null, signal: string | null) => {
      if (child !== proc) return;
      child = null;
      // What it started may outlive it, a killed one most of all, and would
      // hold the display the next one starts.
      killGroup(proc.pid);
      if (stopped) return;
      if (Date.now() - startedAt >= HEALTHY_RUN_MS) backoffMs = initial;
      opts.log(`exited (${signal ?? code}), starting again in ${backoffMs}ms`);
      timer = setTimeout(start, backoffMs);
      timer.unref?.();
      backoffMs = Math.min(backoffMs * 2, BACKOFF_MAX_MS);
    };
    proc.on("exit", onExit);
    proc.on("error", (err) => {
      opts.log(err.message);
      onExit(null, null);
    });
  }

  start();
  return {
    stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      killGroup(child?.pid);
    },
  };
}
