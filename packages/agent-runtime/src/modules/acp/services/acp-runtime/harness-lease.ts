import type { AgentProcess } from "../../infrastructure/agent-process.js";

export type HarnessTeardownReason =
  | "agent-exited"
  | "config-recycle"
  | "env-recycle"
  | "harness-unresponsive"
  | "shutdown";

export interface HarnessLease {
  ensure(): boolean;
  send(frame: unknown): boolean;
  whenReady(cb: () => void): () => void;
  refreshEnv(opts: { force: boolean }): void;
  recycleForConfig(): void;
  requestRecycle(): void;
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
  beforeFirstSpawn?: () => Promise<void>;
  envForceRecycleMs: number;
  log: (msg: string) => void;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: Holds the harness child process on loan. Spawns
 * it when the first client needs it, holds early callers back until the env
 * is ready at boot (bounded by a timeout, and covering the boot work that has
 * to precede the first spawn), and takes the process back when the env or the
 * harness's own config changes, or when a caller reports the process
 * unresponsive: right away when idle, after work drains when busy, or after a
 * grace period when forced. Every way the process goes down runs the same
 * cleanup and reports one reason — agent-exited, config-recycle, env-recycle,
 * harness-unresponsive, or shutdown — so the cleanup steps cannot drift apart
 * between the paths. A crash is final for the pod; a recycle respawns on the
 * next attach.
 */
const RECYCLE_LOG: Partial<Record<HarnessTeardownReason, string>> = {
  "config-recycle": "recycling harness to apply a config change",
  "env-recycle": "recycling harness to apply env change",
};

export function createHarnessLease(deps: HarnessLeaseDeps): HarnessLease {
  let agent: AgentProcess | null = null;
  let terminal = false;
  let envReady = deps.envReadyAtBoot;
  const readyWaiters = new Set<() => void>();
  let warmTimer: ReturnType<typeof setTimeout> | null = null;
  let bootWorkStarted = false;
  let bootWorkDone = deps.beforeFirstSpawn === undefined;
  let bootTimer: ReturnType<typeof setTimeout> | null = null;
  let pendingRecycle:
    | "config-recycle"
    | "env-recycle"
    | "harness-unresponsive"
    | null = null;
  let forceTimer: ReturnType<typeof setTimeout> | null = null;

  function releaseWaiters(): void {
    if (warmTimer) {
      clearTimeout(warmTimer);
      warmTimer = null;
    }
    if (bootTimer) {
      clearTimeout(bootTimer);
      bootTimer = null;
    }
    for (const release of [...readyWaiters]) release();
    readyWaiters.clear();
  }

  function releaseIfReady(): void {
    if (envReady && bootWorkDone) releaseWaiters();
  }

  function finishBootWork(): void {
    bootWorkDone = true;
    releaseIfReady();
  }

  function startBootWork(): void {
    if (bootWorkStarted || bootWorkDone || !envReady) return;
    bootWorkStarted = true;
    const hold = deps.beforeFirstSpawn?.();
    if (!hold) {
      finishBootWork();
      return;
    }
    bootTimer = setTimeout(() => {
      bootWorkDone = true;
      releaseWaiters();
    }, deps.warmStartTimeoutMs);
    void hold.catch(() => {}).then(finishBootWork);
  }

  function markEnvReady(): void {
    if (envReady) return;
    envReady = true;
    startBootWork();
    releaseIfReady();
  }

  if (!envReady) {
    warmTimer = setTimeout(() => {
      envReady = true;
      bootWorkDone = true;
      releaseWaiters();
    }, deps.warmStartTimeoutMs);
  }

  function resetPendingRecycle(): void {
    pendingRecycle = null;
    if (forceTimer) {
      clearTimeout(forceTimer);
      forceTimer = null;
    }
  }

  function clearWarmGate(): void {
    if (warmTimer) {
      clearTimeout(warmTimer);
      warmTimer = null;
    }
    if (bootTimer) {
      clearTimeout(bootTimer);
      bootTimer = null;
    }
    readyWaiters.clear();
  }

  function teardown(reason: HarnessTeardownReason): void {
    resetPendingRecycle();
    clearWarmGate();
    deps.onTeardown(reason);
  }

  function recycle(): void {
    const reason = pendingRecycle ?? "env-recycle";
    resetPendingRecycle();
    const old = agent;
    if (!old) return;
    deps.log(RECYCLE_LOG[reason] ?? "recycling unresponsive harness");
    agent = null;
    teardown(reason);
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
      startBootWork();
      if (envReady && bootWorkDone) {
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
      pendingRecycle ??= "env-recycle";
      if (!deps.busy()) {
        recycle();
        return;
      }
      deps.log(
        `env recycle deferred: ${deps.describeBusy()}` +
          (opts.force ? ` — forcing in ${deps.envForceRecycleMs}ms` : ""),
      );
      if (opts.force && !forceTimer)
        forceTimer = setTimeout(recycle, deps.envForceRecycleMs);
    },

    recycleForConfig() {
      if (!agent) return;
      pendingRecycle ??= "config-recycle";
      if (!deps.busy()) {
        recycle();
        return;
      }
      deps.log(
        `config recycle deferred: ${deps.describeBusy()} — forcing in ` +
          `${deps.envForceRecycleMs}ms`,
      );
      if (!forceTimer) forceTimer = setTimeout(recycle, deps.envForceRecycleMs);
    },

    requestRecycle() {
      if (!agent) return;
      pendingRecycle = "harness-unresponsive";
      if (!deps.busy()) {
        recycle();
        return;
      }
      deps.log(
        `harness recycle deferred: ${deps.describeBusy()} — forcing in ` +
          `${deps.envForceRecycleMs}ms`,
      );
      if (!forceTimer) forceTimer = setTimeout(recycle, deps.envForceRecycleMs);
    },

    maybeRecycle() {
      if (pendingRecycle !== null && !deps.busy()) recycle();
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
