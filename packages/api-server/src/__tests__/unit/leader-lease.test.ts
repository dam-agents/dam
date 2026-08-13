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
