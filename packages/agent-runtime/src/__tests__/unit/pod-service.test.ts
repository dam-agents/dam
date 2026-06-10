import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  createPodServiceSupervisor,
  type PodServiceProcess,
} from "../../modules/pod-service.js";

interface FakeProc {
  proc: PodServiceProcess;
  exit(code: number | null, signal?: string | null): void;
  signals: string[];
}

function makeFakeProc(): FakeProc {
  let resolveExit: (r: {
    code: number | null;
    signal: string | null;
  }) => void = () => {};
  const exited = new Promise<{ code: number | null; signal: string | null }>(
    (r) => {
      resolveExit = r;
    },
  );
  const signals: string[] = [];
  return {
    proc: {
      kill: (sig) => signals.push(sig),
      exited,
    },
    exit: (code, signal = null) => resolveExit({ code, signal }),
    signals,
  };
}

function makeSupervisor(opts: { env?: Record<string, string> } = {}) {
  const spawned: FakeProc[] = [];
  const spawnedEnvs: Record<string, string | undefined>[] = [];
  const snapshots: Record<string, string | undefined>[] = [];
  const events: string[] = [];
  const supervisor = createPodServiceSupervisor({
    spawn: (env) => {
      spawnedEnvs.push(env);
      events.push("spawn");
      const fake = makeFakeProc();
      spawned.push(fake);
      return fake.proc;
    },
    envReader: { current: () => opts.env ?? {}, ready: () => true },
    writeEnvSnapshot: (env) => {
      snapshots.push(env);
      events.push("snapshot");
    },
    log: () => {},
    backoffInitialMs: 1_000,
    backoffMaxMs: 4_000,
    healthyRunMs: 60_000,
    sigtermGraceMs: 10_000,
  });
  return { supervisor, spawned, spawnedEnvs, snapshots, events };
}

// Promise reactions (the exited.then in the supervisor) need a microtask flush
// that fake timers don't provide on their own.
const flush = () => vi.advanceTimersByTimeAsync(0);

describe("pod-service supervisor", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it("spawns on refreshEnv with runtime env merged under process.env", async () => {
    vi.stubEnv("POD_SVC_COLLIDE", "from-process");
    const { supervisor, spawned, spawnedEnvs } = makeSupervisor({
      env: { FROM_RUNTIME: "yes", POD_SVC_COLLIDE: "from-runtime" },
    });
    supervisor.refreshEnv();
    expect(spawned).toHaveLength(1);
    expect(spawnedEnvs[0]!.FROM_RUNTIME).toBe("yes");
    // Same precedence as harness spawns: process.env wins on collision.
    expect(spawnedEnvs[0]!.POD_SVC_COLLIDE).toBe("from-process");
  });

  it("writes the env snapshot before spawning or signaling", async () => {
    const { supervisor, snapshots, events } = makeSupervisor({
      env: { FROM_RUNTIME: "yes" },
    });
    supervisor.refreshEnv();
    expect(snapshots[0]!.FROM_RUNTIME).toBe("yes");
    supervisor.refreshEnv();
    // Snapshot lands before the process could possibly act on the signal —
    // and before the spawn, so a service may read it at any point in life.
    expect(events).toEqual(["snapshot", "spawn", "snapshot"]);
  });

  it("stays down after a clean exit until env changes again", async () => {
    const { supervisor, spawned } = makeSupervisor();
    supervisor.refreshEnv();
    spawned[0]!.exit(0);
    await flush();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(spawned).toHaveLength(1);

    supervisor.refreshEnv();
    expect(spawned).toHaveLength(2);
  });

  it("restarts a crashed service with capped exponential backoff", async () => {
    const { supervisor, spawned } = makeSupervisor();
    supervisor.refreshEnv();

    spawned[0]!.exit(1);
    await flush();
    expect(spawned).toHaveLength(1); // not yet — backoff pending
    await vi.advanceTimersByTimeAsync(1_000);
    expect(spawned).toHaveLength(2);

    spawned[1]!.exit(1);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(spawned).toHaveLength(2); // doubled to 2s, not due yet
    await vi.advanceTimersByTimeAsync(1_000);
    expect(spawned).toHaveLength(3);

    // 4s cap holds from here on.
    spawned[2]!.exit(1);
    await vi.advanceTimersByTimeAsync(4_000);
    expect(spawned).toHaveLength(4);
    spawned[3]!.exit(1);
    await vi.advanceTimersByTimeAsync(4_000);
    expect(spawned).toHaveLength(5);
  });

  it("resets backoff after a healthy run", async () => {
    const { supervisor, spawned } = makeSupervisor();
    supervisor.refreshEnv();
    spawned[0]!.exit(1);
    await vi.advanceTimersByTimeAsync(1_000); // backoff now 2s
    expect(spawned).toHaveLength(2);

    await vi.advanceTimersByTimeAsync(60_000); // healthy run
    spawned[1]!.exit(1);
    await vi.advanceTimersByTimeAsync(1_000); // back to the initial 1s
    expect(spawned).toHaveLength(3);
  });

  it("SIGHUPs a running service on env change and keeps it as the child", async () => {
    const { supervisor, spawned } = makeSupervisor();
    supervisor.refreshEnv();

    supervisor.refreshEnv();
    expect(spawned[0]!.signals).toEqual(["SIGHUP"]);
    // Reload-in-place: a service that handles the signal is never respawned.
    await vi.advanceTimersByTimeAsync(60_000);
    expect(spawned).toHaveLength(1);
  });

  it("respawns immediately when the service dies of the reload SIGHUP", async () => {
    const { supervisor, spawned } = makeSupervisor();
    supervisor.refreshEnv();
    supervisor.refreshEnv();

    // Default signal action: the service didn't install a handler.
    spawned[0]!.exit(null, "SIGHUP");
    await flush();
    expect(spawned).toHaveLength(2); // no backoff on the reload path
  });

  it("stays down when the service answers the reload with a clean exit", async () => {
    const { supervisor, spawned } = makeSupervisor();
    supervisor.refreshEnv();
    supervisor.refreshEnv();

    // e.g. the gateway re-read the snapshot and found nothing to front.
    spawned[0]!.exit(0);
    await flush();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(spawned).toHaveLength(1);
  });

  it("cancels a pending crash-restart when env changes, spawning fresh instead", async () => {
    const { supervisor, spawned } = makeSupervisor();
    supervisor.refreshEnv();
    spawned[0]!.exit(1);
    await flush(); // restart timer pending

    supervisor.refreshEnv();
    expect(spawned).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(spawned).toHaveLength(2); // the stale timer never fired
  });

  it("shutdown kills the service and suppresses all respawns", async () => {
    const { supervisor, spawned } = makeSupervisor();
    supervisor.refreshEnv();
    supervisor.shutdown();
    expect(spawned[0]!.signals).toEqual(["SIGTERM"]);
    spawned[0]!.exit(null, "SIGTERM");
    await vi.advanceTimersByTimeAsync(60_000);
    expect(spawned).toHaveLength(1);
    supervisor.refreshEnv();
    expect(spawned).toHaveLength(1);
  });

  it("escalates shutdown to SIGKILL when SIGTERM is ignored", async () => {
    const { supervisor, spawned } = makeSupervisor();
    supervisor.refreshEnv();
    supervisor.shutdown();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(spawned[0]!.signals).toEqual(["SIGTERM", "SIGKILL"]);
  });
});
