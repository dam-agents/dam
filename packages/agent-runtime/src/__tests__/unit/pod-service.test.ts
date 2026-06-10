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
  const supervisor = createPodServiceSupervisor({
    spawn: (env) => {
      spawnedEnvs.push(env);
      const fake = makeFakeProc();
      spawned.push(fake);
      return fake.proc;
    },
    envReader: { current: () => opts.env ?? {}, ready: () => true },
    log: () => {},
    backoffInitialMs: 1_000,
    backoffMaxMs: 4_000,
    healthyRunMs: 60_000,
    sigtermGraceMs: 10_000,
  });
  return { supervisor, spawned, spawnedEnvs };
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

  it("SIGTERMs and respawns immediately on env change, skipping backoff", async () => {
    const { supervisor, spawned } = makeSupervisor();
    supervisor.refreshEnv();

    supervisor.refreshEnv();
    expect(spawned[0]!.signals).toEqual(["SIGTERM"]);
    expect(spawned).toHaveLength(1); // waits for the old process to be gone

    spawned[0]!.exit(null, "SIGTERM");
    await flush();
    expect(spawned).toHaveLength(2);
  });

  it("escalates to SIGKILL when SIGTERM is ignored", async () => {
    const { supervisor, spawned } = makeSupervisor();
    supervisor.refreshEnv();
    supervisor.refreshEnv();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(spawned[0]!.signals).toEqual(["SIGTERM", "SIGKILL"]);
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
});
