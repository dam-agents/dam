import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Redis } from "ioredis";
import { createSessionPresence } from "../../apps/api-server/agent-proxies/session-presence.js";
import { createMemoryTtlStore } from "../../core/ttl-store.js";
import { ACTIVE_SESSION_KEY } from "../../modules/agents/infrastructure/labels.js";

function fakeRedis(keys = new Map<string, string>()) {
  const redis = {
    keys,
    async set(key: string, value: string) {
      keys.set(key, value);
      return "OK";
    },
    async del(key: string) {
      keys.delete(key);
      return 1;
    },
    async scan(_cursor: string, _m: string, pattern: string) {
      const re = new RegExp(
        "^" +
          pattern
            .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
            .replace(/\\\*/g, ".*") +
          "$",
      );
      return ["0", [...keys.keys()].filter((k) => re.test(k))] as [
        string,
        string[],
      ];
    },
  };
  return redis as unknown as Redis & { keys: Map<string, string> };
}

function fakeRepo(annotated = new Set<string>()) {
  return {
    annotated,
    async patchAnnotation(id: string, key: string, value: string) {
      expect(key).toBe(ACTIVE_SESSION_KEY);
      if (value === "true") annotated.add(id);
      else annotated.delete(id);
    },
    async listAgentIdsWithAnnotation() {
      return [...annotated];
    },
  };
}

describe("session presence", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  // TEST_SCENARIO: release must only drop this replica's key — an eager annotation clear races another replica's acquire (reconnect landing elsewhere) and can unpin a live socket; the two-tick reconcile owns clearing.
  it("pins on first acquire; last release drops the key and leaves the clear to reconcile", async () => {
    const redis = fakeRedis();
    const repo = fakeRepo();
    const presence = createSessionPresence(repo, redis);

    const r1 = presence.acquire("a1");
    const r2 = presence.acquire("a1");
    await vi.advanceTimersByTimeAsync(1);
    expect(repo.annotated.has("a1")).toBe(true);
    expect(redis.keys.size).toBe(1);

    r1();
    await vi.advanceTimersByTimeAsync(1);
    expect(repo.annotated.has("a1")).toBe(true);

    r2();
    await vi.advanceTimersByTimeAsync(1);
    expect(redis.keys.size).toBe(0);
    expect(repo.annotated.has("a1")).toBe(true);

    await presence.reconcile();
    await presence.reconcile();
    expect(repo.annotated.has("a1")).toBe(false);
    presence.close();
  });

  it("keeps the pin while another replica still holds the agent", async () => {
    const redis = fakeRedis();
    redis.keys.set("presence:agent:a1:other-replica", "1");
    const repo = fakeRepo(new Set(["a1"]));
    const presence = createSessionPresence(repo, redis);

    const release = presence.acquire("a1");
    release();
    await vi.advanceTimersByTimeAsync(1);
    expect(repo.annotated.has("a1")).toBe(true);
    presence.close();
  });

  it("heartbeat re-asserts the annotation for held agents", async () => {
    const redis = fakeRedis();
    const repo = fakeRepo();
    const presence = createSessionPresence(repo, redis);

    presence.acquire("a1");
    await vi.advanceTimersByTimeAsync(1);
    repo.annotated.delete("a1");
    await vi.advanceTimersByTimeAsync(31_000);
    expect(repo.annotated.has("a1")).toBe(true);
    presence.close();
  });

  it("reconcile clears unheld pins after two ticks, spares held ones", async () => {
    const redis = fakeRedis();
    redis.keys.set("presence:agent:held:other-replica", "1");
    const repo = fakeRepo(new Set(["held", "orphaned"]));
    const presence = createSessionPresence(repo, redis);

    await presence.reconcile();
    expect(repo.annotated.has("orphaned")).toBe(true);

    await presence.reconcile();
    expect(repo.annotated.has("held")).toBe(true);
    expect(repo.annotated.has("orphaned")).toBe(false);
    presence.close();
  });

  it("reconcile never clears an agent this replica holds, even after a Redis flush", async () => {
    const redis = fakeRedis();
    const repo = fakeRepo(new Set(["a1"]));
    const presence = createSessionPresence(repo, redis);

    presence.acquire("a1");
    redis.keys.clear();
    await presence.reconcile();
    await presence.reconcile();
    expect(repo.annotated.has("a1")).toBe(true);
    presence.close();
  });
});

describe("memory ttl store", () => {
  it("peek is non-consuming, consume is read-and-delete", async () => {
    const store = createMemoryTtlStore<string>(1000, () => 0);
    await store.set("k", "v");
    expect(await store.peek("k")).toBe("v");
    expect(await store.consume("k")).toBe("v");
    expect(await store.consume("k")).toBe(null);
  });

  it("expires by TTL", async () => {
    let clock = 0;
    const store = createMemoryTtlStore<string>(1000, () => clock);
    await store.set("k", "v");
    clock = 1001;
    expect(await store.peek("k")).toBe(null);
  });
});
