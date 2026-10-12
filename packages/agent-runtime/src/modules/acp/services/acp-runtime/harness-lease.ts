import type { AgentProcess } from "../../infrastructure/agent-process.js";

export type HarnessTeardownReason =
  | "agent-exited"
  | "config-recycle"
  | "env-recycle"
  | "harness-unresponsive"
  | "shutdown";

export type DeferrableRecycle = "config-recycle" | "env-recycle";

export interface PendingRecycle {
  reason: DeferrableRecycle;
  since: number;
}

export interface HarnessLease {
  ensure(): boolean;
  pid(): number | null;
  send(frame: unknown): boolean;
  whenReady(cb: () => void): () => void;
  refreshEnv(opts: { force: boolean }): void;
  recycleForConfig(): void;
  requestRecycle(): void;
  cancelRecycleRequest(): void;
  maybeRecycle(): void;
  pending(): PendingRecycle | null;
  recycleNow(): boolean;
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
  beforeSpawn?: () => Promise<void>;
  envForceRecycleMs: number;
  keptTasks: () => number;
  onPendingChange: () => void;
  log: (msg: string) => void;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: Holds the harness child process on loan. Spawns
 * it when the first client needs it, holds early callers back until the env
 * is ready at boot (bounded by a timeout, and covering the spawn work that has
 * to precede the first spawn), and takes the process back when the env or the
 * harness's own config changes, or when a caller reports the process
 * unresponsive: right away when idle, after work drains when busy, or after a
 * grace period when forced. An env change may have moved the agent to another
 * provider, so the spawn work runs again, under the same ceiling, before the
 * process that follows it. A caller that hears from the process again calls
 * its own request off, and a recycle owed for env or config still stands. Every way the process goes down runs the same
 * cleanup and reports one reason — agent-exited, config-recycle, env-recycle,
 * harness-unresponsive, or shutdown — so the cleanup steps cannot drift apart
 * between the paths. A crash is final for this lease, which the pod's lease
 * router then drops unless it is the default one; a recycle respawns on the
 * next attach. A forced recycle for env or config is held back while a kept
 * Harness Task runs, because the recycle would kill it: the recycle stays owed
 * until the task ends or stops being kept, or a caller applies it now. An
 * unresponsive harness is forced anyway.
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
  let bootWorkDone = deps.beforeSpawn === undefined;
  let bootCycle = 0;
  let gateOpen = envReady && bootWorkDone;
  let bootTimer: ReturnType<typeof setTimeout> | null = null;
  let pendingRecycle: DeferrableRecycle | "harness-unresponsive" | null = null;
  let owedSince: number | null = null;
  let forceTimer: ReturnType<typeof setTimeout> | null = null;
  let forceHeld = false;
  let supersededRecycle: {
    reason: DeferrableRecycle | null;
    forced: boolean;
  } | null = null;

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

  function openGate(): void {
    gateOpen = true;
    releaseWaiters();
  }

  function releaseIfReady(): void {
    if (envReady && bootWorkDone) openGate();
  }

  function finishBootWork(): void {
    bootWorkDone = true;
    releaseIfReady();
  }

  function startBootWork(): void {
    if (bootWorkStarted || bootWorkDone || !envReady) return;
    bootWorkStarted = true;
    const cycle = bootCycle;
    const hold = deps.beforeSpawn?.();
    if (!hold) {
      finishBootWork();
      return;
    }
    bootTimer = setTimeout(openGate, deps.warmStartTimeoutMs);
    void hold
      .catch(() => {})
      .then(() => {
        if (cycle === bootCycle) finishBootWork();
      });
  }

  function markEnvReady(): void {
    if (envReady) return;
    envReady = true;
    if (warmTimer) {
      clearTimeout(warmTimer);
      warmTimer = null;
    }
    startBootWork();
    releaseIfReady();
  }

  if (!envReady) {
    warmTimer = setTimeout(() => {
      envReady = true;
      openGate();
    }, deps.warmStartTimeoutMs);
  }

  function resetPendingRecycle(): void {
    const hadPending = pendingRecycle !== null;
    pendingRecycle = null;
    owedSince = null;
    forceHeld = false;
    supersededRecycle = null;
    if (forceTimer) {
      clearTimeout(forceTimer);
      forceTimer = null;
    }
    if (hadPending) deps.onPendingChange();
  }

  function oweRecycle(reason: DeferrableRecycle, forced: boolean): void {
    if (pendingRecycle === "harness-unresponsive" && supersededRecycle) {
      supersededRecycle.reason ??= reason;
      supersededRecycle.forced ||= forced;
    }
    owedSince ??= Date.now();
    if (pendingRecycle !== null) return;
    pendingRecycle = reason;
    deps.onPendingChange();
  }

  function forceRecycle(): void {
    forceTimer = null;
    const kept = deps.keptTasks();
    if (pendingRecycle === "harness-unresponsive" || kept === 0) {
      recycle();
      return;
    }
    if (forceHeld) return;
    forceHeld = true;
    deps.log(`holding ${pendingRecycle} for ${kept} kept background task(s)`);
  }

  function armForce(): void {
    if (!forceTimer)
      forceTimer = setTimeout(forceRecycle, deps.envForceRecycleMs);
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

  function rearmSpawnWork(): void {
    if (deps.beforeSpawn === undefined) return;
    bootCycle += 1;
    bootWorkStarted = false;
    bootWorkDone = false;
    gateOpen = false;
  }

  function recycle(): void {
    const reason = pendingRecycle ?? "env-recycle";
    resetPendingRecycle();
    const old = agent;
    if (!old) return;
    deps.log(RECYCLE_LOG[reason] ?? "recycling unresponsive harness");
    agent = null;
    teardown(reason);
    if (reason === "env-recycle") rearmSpawnWork();
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

    pid() {
      return agent?.pid ?? null;
    },

    send(frame) {
      if (!agent) return false;
      agent.send(frame);
      return true;
    },

    whenReady(cb) {
      startBootWork();
      if (gateOpen) {
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
      oweRecycle("env-recycle", opts.force);
      if (!deps.busy()) {
        recycle();
        return;
      }
      deps.log(
        `env recycle deferred: ${deps.describeBusy()}` +
          (opts.force ? ` — forcing in ${deps.envForceRecycleMs}ms` : ""),
      );
      if (opts.force) armForce();
    },

    recycleForConfig() {
      if (!agent) return;
      oweRecycle("config-recycle", true);
      if (!deps.busy()) {
        recycle();
        return;
      }
      deps.log(
        `config recycle deferred: ${deps.describeBusy()} — forcing in ` +
          `${deps.envForceRecycleMs}ms`,
      );
      armForce();
    },

    requestRecycle() {
      if (!agent) return;
      if (pendingRecycle !== "harness-unresponsive") {
        supersededRecycle = {
          reason: pendingRecycle,
          forced: forceTimer !== null || forceHeld,
        };
      }
      pendingRecycle = "harness-unresponsive";
      deps.onPendingChange();
      if (!deps.busy()) {
        recycle();
        return;
      }
      deps.log(
        `harness recycle deferred: ${deps.describeBusy()} — forcing in ` +
          `${deps.envForceRecycleMs}ms`,
      );
      armForce();
    },

    cancelRecycleRequest() {
      if (pendingRecycle !== "harness-unresponsive" || !supersededRecycle)
        return;
      const restored = supersededRecycle;
      supersededRecycle = null;
      pendingRecycle = restored.reason;
      if (restored.reason === null) owedSince = null;
      deps.onPendingChange();
      if (!restored.forced && forceTimer) {
        clearTimeout(forceTimer);
        forceTimer = null;
      }
      deps.log(
        restored.reason
          ? `harness answered again; recycle stays owed for ${restored.reason}`
          : "harness answered again; recycle called off",
      );
    },

    maybeRecycle() {
      if (pendingRecycle === null) return;
      if (!deps.busy()) {
        recycle();
        return;
      }
      if (forceHeld && deps.keptTasks() === 0) {
        forceHeld = false;
        deps.log(
          `kept background tasks are gone; ${pendingRecycle} waits for ` +
            `${deps.describeBusy()} — forcing in ${deps.envForceRecycleMs}ms`,
        );
        armForce();
      }
    },

    pending() {
      if (pendingRecycle === null || pendingRecycle === "harness-unresponsive")
        return null;
      return { reason: pendingRecycle, since: owedSince ?? Date.now() };
    },

    recycleNow() {
      if (!agent || pendingRecycle === null) return false;
      deps.log(`applying ${pendingRecycle} now, whatever runs`);
      recycle();
      return true;
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
