import { describe, it, expect, vi } from "vitest";
import type { Redis } from "ioredis";
import { createLeaderLease } from "../../core/leader-lease.js";

function fakeRedis(): Redis & { store: Map<string, string> } {
  const store = new Map<string, string>();
  return {
    store,
    async set(
      key: string,
      value: string,
      _px: string,
      _ttl: number,
      nx: string,
    ) {
      if (nx === "NX" && store.has(key)) return null;
      store.set(key, value);
      return "OK";
    },
    async eval(script: string, _n: number, key: string, id: string) {
      if (store.get(key) !== id) return 0;
      if (script.includes("DEL")) store.delete(key);
      return 1;
    },
  } as unknown as Redis & { store: Map<string, string> };
}

describe("leader lease", () => {
  it("elects exactly one holder among replicas campaigning at once", async () => {
    const redis = fakeRedis();
    const acquired: string[] = [];
    const leases = ["a", "b", "c"].map((name) =>
      createLeaderLease({
        redis,
        name: "channels",
        onAcquired: () => void acquired.push(name),
        onLost: () => {},
        log: () => {},
      }),
    );

    await Promise.all(leases.map((l) => l.start()));

    expect(acquired).toEqual(["a"]);
    expect(leases.filter((l) => l.isLeader())).toHaveLength(1);

    await Promise.all(leases.map((l) => l.stop()));
  });

  it("hands the lease to another replica when the holder stops", async () => {
    const redis = fakeRedis();
    const events: string[] = [];
    const make = (name: string) =>
      createLeaderLease({
        redis,
        name: "channels",
        onAcquired: () => void events.push(`+${name}`),
        onLost: () => void events.push(`-${name}`),
        log: () => {},
      });

    const first = make("a");
    const second = make("b");
    await first.start();
    await second.start();
    expect(events).toEqual(["+a"]);

    await first.stop();
    expect(redis.store.has("leader:channels")).toBe(false);

    await second.start();
    expect(events).toEqual(["+a", "-a", "+b"]);

    await second.stop();
  });

  it("releases the lease when onAcquired fails, so another replica can win", async () => {
    const redis = fakeRedis();
    const events: string[] = [];
    const broken = createLeaderLease({
      redis,
      name: "channels",
      onAcquired: () => {
        events.push("+a");
        throw new Error("slack gateway failed to connect");
      },
      onLost: () => void events.push("-a"),
      log: () => {},
    });
    const healthy = createLeaderLease({
      redis,
      name: "channels",
      onAcquired: () => void events.push("+b"),
      onLost: () => void events.push("-b"),
      log: () => {},
    });

    await broken.start();
    expect(broken.isLeader()).toBe(false);
    expect(redis.store.has("leader:channels")).toBe(false);

    await healthy.start();
    expect(healthy.isLeader()).toBe(true);
    expect(events).toEqual(["+a", "-a", "+b"]);

    await broken.stop();
    await healthy.stop();
  });

  // TEST_SCENARIO: one transient renew error must not cost the install a holder; the second stands down and releases the key so takeover beats the TTL.
  it("tolerates one renew blip, stands down and releases on the second", async () => {
    vi.useFakeTimers();
    try {
      const redis = fakeRedis();
      const realEval = redis.eval.bind(redis);
      const lease = createLeaderLease({
        redis,
        name: "channels",
        onAcquired: () => {},
        onLost: () => {},
        log: () => {},
      });
      await lease.start();
      expect(lease.isLeader()).toBe(true);

      redis.eval = ((script: string, ...args: unknown[]) => {
        if (script.includes("PEXPIRE"))
          return Promise.reject(new Error("ETIMEDOUT"));
        return realEval(script, ...(args as [number, string, string]));
      }) as Redis["eval"];

      await vi.advanceTimersByTimeAsync(10_000);
      expect(lease.isLeader()).toBe(true);

      await vi.advanceTimersByTimeAsync(10_000);
      expect(lease.isLeader()).toBe(false);
      expect(redis.store.has("leader:channels")).toBe(false);

      redis.eval = realEval as Redis["eval"];
      await lease.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  // TEST_SCENARIO: a failed teardown must not leave the ex-leader's workers running lease-less forever — onLost gets one retry.
  it("retries a failed onLost once", async () => {
    const redis = fakeRedis();
    let lostCalls = 0;
    const lease = createLeaderLease({
      redis,
      name: "channels",
      onAcquired: () => {},
      onLost: () => {
        lostCalls += 1;
        if (lostCalls === 1) throw new Error("bolt stop failed");
      },
      log: () => {},
    });
    await lease.start();
    expect(lease.isLeader()).toBe(true);

    await lease.stop();
    expect(lostCalls).toBe(2);
    expect(redis.store.has("leader:channels")).toBe(false);
  });

  it("stands down when Redis is unreachable rather than acting as leader", async () => {
    const redis = fakeRedis();
    const lease = createLeaderLease({
      redis,
      name: "channels",
      onAcquired: () => {},
      onLost: () => {},
      log: () => {},
    });
    await lease.start();
    expect(lease.isLeader()).toBe(true);

    vi.spyOn(redis, "eval").mockRejectedValue(new Error("ECONNREFUSED"));
    await lease.stop();
    expect(lease.isLeader()).toBe(false);
  });
});
