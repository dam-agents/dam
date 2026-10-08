import { describe, it, expect, afterEach, vi } from "vitest";
import { createWorld } from "./acp-world.js";

/**
 * TEST_OVERVIEW: spawn work that has to land before the harness starts.
 *
 * A harness reads its own config file once, at spawn, so anything the
 * platform must put there — a seeded model — has to be written before the
 * first process exists, and again before the process that follows an env
 * change, since the env is how a provider switch reaches the pod. The pod's
 * environment is recorded on disk and survives a restart, so the runtime
 * cannot hang that work on the moment it first learns the environment is
 * ready: on every boot after the first that moment never comes. It also cannot wait forever, or a hook that never
 * settles would leave the pod unable to start at all.
 */
describe("acp-runtime: spawn work before the harness starts", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  /**
   * TEST_SCENARIO: The pod boots with its environment already on disk — the
   * ordinary case for every restart, hibernation wake and reschedule. The
   * first client to attach must still wait for the boot work, because the
   * config it writes is read by the process that attach is about to spawn.
   */
  it("runs boot work on a pod whose env was ready at boot", async () => {
    let release = (): void => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let calls = 0;

    const world = createWorld({
      envReadyAtBoot: true,
      beforeSpawn: () => {
        calls += 1;
        return held;
      },
    });

    world.connect();
    expect(calls).toBe(1);
    expect(world.harnessStarted()).toBe(false);

    release();
    await held;
    await Promise.resolve();
    expect(world.harnessStarted()).toBe(true);
  });

  /**
   * TEST_SCENARIO: The agent is switched to another provider while running.
   * The env change recycles the harness, and the model written for the old
   * provider is useless on the new one, so the spawn work has to run again
   * before the replacement process starts, not only once per pod.
   */
  it("runs the spawn work again before the spawn that follows an env change", async () => {
    let calls = 0;
    const world = createWorld({
      envReadyAtBoot: true,
      beforeSpawn: () => {
        calls += 1;
        return Promise.resolve();
      },
    });

    world.connect();
    await Promise.resolve();
    await Promise.resolve();
    expect(calls).toBe(1);
    expect(world.harnessCount()).toBe(1);

    world.runtime.refreshEnv({ force: false });
    expect(world.harness().killed()).toBe(true);

    world.connect();
    await Promise.resolve();
    await Promise.resolve();
    expect(calls).toBe(2);
    expect(world.harnessCount()).toBe(2);
  });

  /**
   * TEST_SCENARIO: The spawn work of the previous cycle is still pending when
   * an env change re-arms it — the listing hung past the warm-start ceiling
   * and the harness started without it. When that old hold finally settles,
   * it must not count as the new cycle's work: the gate stays shut until the
   * new hold lands.
   */
  it("ignores a spawn-work hold from before the env change", async () => {
    vi.useFakeTimers();
    const holds: (() => void)[] = [];
    const world = createWorld({
      envReadyAtBoot: true,
      warmStartTimeoutMs: 1_000,
      beforeSpawn: () =>
        new Promise<void>((resolve) => {
          holds.push(resolve);
        }),
    });

    world.connect();
    vi.advanceTimersByTime(1_000);
    expect(world.harnessCount()).toBe(1);

    world.runtime.refreshEnv({ force: false });
    expect(world.harness().killed()).toBe(true);
    world.connect();
    expect(holds).toHaveLength(2);

    holds[0]?.();
    await vi.advanceTimersByTimeAsync(0);
    expect(world.harnessCount()).toBe(1);

    holds[1]?.();
    await vi.advanceTimersByTimeAsync(0);
    expect(world.harnessCount()).toBe(2);
  });

  /**
   * TEST_SCENARIO: A cold boot, where the environment arrives late. The wait
   * for the environment and the wait for the boot work are separate deadlines:
   * the env one must not still be running once the env has arrived, or it
   * fires part-way through the boot work and starts the harness on a config
   * the seed has not finished writing.
   */
  it("does not let the env deadline cut the boot work short", async () => {
    vi.useFakeTimers();
    let release = (): void => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });

    const world = createWorld({
      envReadyAtBoot: false,
      warmStartTimeoutMs: 1_000,
      beforeSpawn: () => held,
    });

    world.connect();
    vi.advanceTimersByTime(900);
    world.runtime.refreshEnv({ force: false });

    vi.advanceTimersByTime(200);
    expect(world.harnessStarted()).toBe(false);

    release();
    await vi.runAllTimersAsync();
    expect(world.harnessStarted()).toBe(true);
  });

  /**
   * TEST_SCENARIO: The boot work never settles — an unreachable provider with
   * no timeout of its own. The warm-start ceiling releases the caller so the
   * harness still starts; the agent then runs without the seeded value rather
   * than not running at all.
   */
  it("starts the harness anyway when boot work never settles", () => {
    vi.useFakeTimers();
    const world = createWorld({
      envReadyAtBoot: true,
      warmStartTimeoutMs: 1_000,
      beforeSpawn: () => new Promise<void>(() => {}),
    });

    world.connect();
    expect(world.harnessStarted()).toBe(false);

    vi.advanceTimersByTime(1_000);
    expect(world.harnessStarted()).toBe(true);
  });
});
