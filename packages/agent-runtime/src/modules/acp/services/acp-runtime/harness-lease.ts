import type { AgentProcess } from "../../infrastructure/agent-process.js";

export type HarnessTeardownReason = "agent-exited" | "env-recycle" | "shutdown";

export interface HarnessLease {
  ensure(): boolean;
  send(frame: unknown): boolean;
  whenReady(cb: () => void): () => void;
  refreshEnv(opts: { force: boolean }): void;
  maybeRecycle(): void;
  shutdown(): void;
}

export interface HarnessLeaseDeps {
  spawnAgent: () => AgentProcess;
  onFrame: (line: string) => void;
  onTeardown: (reason: HarnessTeardownReason) => void;
  busy: () => boolean;
  describeBusy: () => string;
  envReadyAtBoot: boolean;
  warmStartTimeoutMs: number;
  envForceRecycleMs: number;
  log: (msg: string) => void;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: Holds the harness child process on loan. Spawns
 * it when the first client needs it, holds early callers back until the env
 * is ready at boot (bounded by a timeout), and takes the process back when
 * the env changes: right away when idle, after work drains when busy, or
 * after a grace period when forced. Every way the process goes down runs the
 * same cleanup and reports one reason — agent-exited, env-recycle, or
 * shutdown — so the cleanup steps cannot drift apart between the paths.
 * A crash is final for the pod; only an env recycle respawns.
 */
export function createHarnessLease(deps: HarnessLeaseDeps): HarnessLease {
  let agent: AgentProcess | null = null;
  let terminal = false;
  let envReady = deps.envReadyAtBoot;
  const readyWaiters = new Set<() => void>();
  let warmTimer: ReturnType<typeof setTimeout> | null = null;
  let envRefreshPending = false;
  let envForceTimer: ReturnType<typeof setTimeout> | null = null;

  function markEnvReady(): void {
    if (envReady) return;
    envReady = true;
    if (warmTimer) {
      clearTimeout(warmTimer);
      warmTimer = null;
    }
    for (const release of [...readyWaiters]) release();
    readyWaiters.clear();
  }

  if (!envReady) warmTimer = setTimeout(markEnvReady, deps.warmStartTimeoutMs);

  function resetEnvRefresh(): void {
    envRefreshPending = false;
    if (envForceTimer) {
      clearTimeout(envForceTimer);
      envForceTimer = null;
    }
  }

  function clearWarmGate(): void {
    if (warmTimer) {
      clearTimeout(warmTimer);
      warmTimer = null;
    }
    readyWaiters.clear();
  }

  function teardown(reason: HarnessTeardownReason): void {
    resetEnvRefresh();
    clearWarmGate();
    deps.onTeardown(reason);
  }

  function recycle(): void {
    resetEnvRefresh();
    const old = agent;
    if (!old) return;
    deps.log("recycling harness to apply env change");
    agent = null;
    teardown("env-recycle");
    old.kill();
  }

  return {
    ensure() {
      if (agent) return true;
      if (terminal) return false;
      const a = deps.spawnAgent();
      agent = a;
      a.onLine(deps.onFrame);
      void a.exited.then(() => {
        if (agent !== a) return;
        agent = null;
        terminal = true;
        teardown("agent-exited");
      });
      return true;
    },

    send(frame) {
      if (!agent) return false;
      agent.send(frame);
      return true;
    },

    whenReady(cb) {
      if (envReady) {
        cb();
        return () => {};
      }
      readyWaiters.add(cb);
      return () => readyWaiters.delete(cb);
    },

    refreshEnv(opts) {
      if (!envReady) {
        markEnvReady();
        return;
      }
      if (!agent) return;
      envRefreshPending = true;
      if (!deps.busy()) {
        recycle();
        return;
      }
      deps.log(
        `env recycle deferred: ${deps.describeBusy()}` +
          (opts.force ? ` — forcing in ${deps.envForceRecycleMs}ms` : ""),
      );
      if (opts.force && !envForceTimer)
        envForceTimer = setTimeout(recycle, deps.envForceRecycleMs);
    },

    maybeRecycle() {
      if (envRefreshPending && !deps.busy()) recycle();
    },

    shutdown() {
      terminal = true;
      const old = agent;
      agent = null;
      teardown("shutdown");
      if (old) old.kill();
    },
  };
}
