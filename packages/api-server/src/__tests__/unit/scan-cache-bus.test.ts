import { describe, it, expect } from "vitest";
import {
  createScanCache,
  wireScanCacheBus,
} from "../../modules/skills/infrastructure/scan-cache.js";
import type { RedisBus, BusListener } from "../../core/redis-bus.js";

function fakeBus(): RedisBus {
  const listeners = new Map<string, Set<BusListener>>();
  return {
    async publish(channel, payload) {
      for (const fn of listeners.get(channel) ?? []) fn(payload);
    },
    subscribe(channel, listener) {
      let set = listeners.get(channel);
      if (!set) listeners.set(channel, (set = new Set()));
      set.add(listener);
      return () => set!.delete(listener);
    },
    async close() {},
  };
}

describe("scan cache bus invalidation", () => {
  it("an invalidation broadcast on one replica busts the cache on another", async () => {
    const bus = fakeBus();
    const cacheA = createScanCache(() => {});
    const cacheB = createScanCache(() => {});
    const broadcastA = wireScanCacheBus(cacheA, bus);
    wireScanCacheBus(cacheB, bus);

    let scans = 0;
    const scanner = async () => {
      scans++;
      return [];
    };
    await cacheB.scan({ kind: "shared" }, "git@repo", undefined, scanner);
    await cacheB.scan({ kind: "shared" }, "git@repo", undefined, scanner);
    expect(scans).toBe(1);

    broadcastA("git@repo", undefined);
    await cacheB.scan({ kind: "shared" }, "git@repo", undefined, scanner);
    expect(scans).toBe(2);
  });

  it("drops malformed payloads without touching the cache", async () => {
    const bus = fakeBus();
    const cache = createScanCache(() => {});
    wireScanCacheBus(cache, bus);

    let scans = 0;
    await cache.scan({ kind: "shared" }, "git@repo", undefined, async () => {
      scans++;
      return [];
    });
    await bus.publish("skills:scan-invalidate", "not json");
    await bus.publish("skills:scan-invalidate", '{"nope":1}');
    await cache.scan({ kind: "shared" }, "git@repo", undefined, async () => {
      scans++;
      return [];
    });
    expect(scans).toBe(1);
  });
});
