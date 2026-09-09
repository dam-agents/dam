import { describe, it, expect, afterEach, vi } from "vitest";
import { createWorld } from "./acp-world.js";

/**
 * TEST_OVERVIEW: boot work that has to land before the harness first starts.
 *
 * A harness reads its own config file once, at spawn, so anything the
 * platform must put there — a seeded model — has to be written before the
 * first process exists. The pod's environment is recorded on disk and
 * survives a restart, so the runtime cannot hang that work on the moment it
 * first learns the environment is ready: on every boot after the first that
 * moment never comes. It also cannot wait forever, or a hook that never
 * settles would leave the pod unable to start at all.
 */
describe("acp-runtime: boot work before the first spawn", () => {
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
      beforeFirstSpawn: () => {
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
      beforeFirstSpawn: () => new Promise<void>(() => {}),
    });

    world.connect();
    expect(world.harnessStarted()).toBe(false);

    vi.advanceTimersByTime(1_000);
    expect(world.harnessStarted()).toBe(true);
  });
});
