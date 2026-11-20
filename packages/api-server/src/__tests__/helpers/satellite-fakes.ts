import type { Redis } from "ioredis";
import type { BlobHandoff } from "../../core/blob-handoff.js";
import type { RedisBus } from "../../core/redis-bus.js";
import type { SatelliteFileChannel } from "../../modules/satellites/services/file-channel.js";

/**
 * UNIT_BOUNDARY_DESCRIPTION: The file channel's two neighbours in a test — a
 * shared store that speaks only the commands the channel uses, and a bus that
 * delivers a publication to every subscriber at once, as the real one does
 * across replicas. Two channel instances built on this pair see one store, which
 * is what proves an operation queued on one replica is claimed and answered on
 * another.
 */
export function fakeRedis(
  options: { failOn?: string; failWith?: unknown } = {},
): Redis & { has(key: string): boolean } {
  const strings = new Map<string, string>();
  const sets = new Map<string, Set<string>>();
  const lists = new Map<string, string[]>();
  const hashes = new Map<string, Map<string, number>>();

  const list = (key: string): string[] => {
    const existing = lists.get(key);
    if (existing !== undefined) return existing;
    const created: string[] = [];
    lists.set(key, created);
    return created;
  };

  const matches = (key: string, pattern: string): boolean => {
    const source = pattern
      .split("*")
      .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
      .join(".*");
    return new RegExp(`^${source}$`).test(key);
  };

  const redis = {
    async set(key: string, value: string, ...args: unknown[]) {
      if (options.failOn === "set") throw options.failWith ?? new Error("set");
      if (args.includes("NX") && strings.has(key)) return null;
      strings.set(key, value);
      return "OK";
    },
    async get(key: string) {
      return strings.get(key) ?? null;
    },
    async getdel(key: string) {
      const value = strings.get(key) ?? null;
      strings.delete(key);
      return value;
    },
    async del(...keys: string[]) {
      let removed = 0;
      for (const key of keys) {
        if (strings.delete(key)) removed++;
        sets.delete(key);
        lists.delete(key);
        hashes.delete(key);
      }
      return removed;
    },
    async incr(key: string) {
      const value = Number(strings.get(key) ?? "0") + 1;
      strings.set(key, String(value));
      return value;
    },
    async decr(key: string) {
      const value = Number(strings.get(key) ?? "0") - 1;
      strings.set(key, String(value));
      return value;
    },
    async expire() {
      return 1;
    },
    async sadd(key: string, member: string) {
      const set = sets.get(key) ?? new Set<string>();
      sets.set(key, set);
      if (set.has(member)) return 0;
      set.add(member);
      return 1;
    },
    async srem(key: string, member: string) {
      return sets.get(key)?.delete(member) ? 1 : 0;
    },
    async scard(key: string) {
      return sets.get(key)?.size ?? 0;
    },
    async rpush(key: string, ...values: string[]) {
      const queue = list(key);
      queue.push(...values);
      return queue.length;
    },
    async lpop(key: string) {
      return list(key).shift() ?? null;
    },
    async llen(key: string) {
      return lists.get(key)?.length ?? 0;
    },
    async lrem(key: string, _count: number, value: string) {
      const queue = list(key);
      const kept = queue.filter((entry) => entry !== value);
      lists.set(key, kept);
      return queue.length - kept.length;
    },
    async lmove(
      source: string,
      destination: string,
      from: "LEFT" | "RIGHT",
      to: "LEFT" | "RIGHT",
    ) {
      const queue = list(source);
      const value = from === "LEFT" ? queue.shift() : queue.pop();
      if (value === undefined) return null;
      const target = list(destination);
      if (to === "LEFT") target.unshift(value);
      else target.push(value);
      return value;
    },
    async lrange(key: string, start: number, stop: number) {
      const queue = lists.get(key) ?? [];
      return queue.slice(start, stop === -1 ? undefined : stop + 1);
    },
    async eval(_script: string, _keys: number, ...args: (string | number)[]) {
      const script = String(_script);
      const parts = args.map((arg) => String(arg));
      if (script.includes("satfile:enqueue")) {
        const [revoked, members, rotation, queue, agentId, id] = parts;
        if (strings.has(revoked!)) return 0;
        const memberSet = sets.get(members!) ?? new Set<string>();
        sets.set(members!, memberSet);
        if (!memberSet.has(agentId!)) {
          memberSet.add(agentId!);
          list(rotation!).push(agentId!);
        }
        list(queue!).push(id!);
        return 1;
      }
      if (script.includes("satfile:pop")) {
        const [queue, members, rotation, agentId] = parts;
        const id = list(queue!).shift() ?? null;
        if (list(queue!).length === 0) {
          sets.get(members!)?.delete(agentId!);
          lists.set(
            rotation!,
            (lists.get(rotation!) ?? []).filter((entry) => entry !== agentId),
          );
        }
        return id;
      }
      if (script.includes("satfile:release")) {
        const [inflight] = parts;
        const value = Number(strings.get(inflight!) ?? "0");
        if (value > 0) strings.set(inflight!, String(value - 1));
        return value;
      }
      throw new Error("unsupported script");
    },
    async hincrby(key: string, field: string, by: number) {
      const hash = hashes.get(key) ?? new Map<string, number>();
      hashes.set(key, hash);
      const value = (hash.get(field) ?? 0) + by;
      hash.set(field, value);
      return value;
    },
    async hgetall(key: string) {
      const hash = hashes.get(key);
      if (hash === undefined) return {};
      return Object.fromEntries(
        [...hash].map(([field, value]) => [field, String(value)]),
      );
    },
    async scan(
      _cursor: string,
      _match: string,
      pattern: string,
      _countFlag: string,
      _count: number,
    ) {
      const keys = [
        ...strings.keys(),
        ...sets.keys(),
        ...lists.keys(),
        ...hashes.keys(),
      ].filter((key) => matches(key, pattern));
      return ["0", keys] as [string, string[]];
    },
    has(key: string) {
      return strings.has(key) || lists.has(key) || sets.has(key);
    },
  };
  return redis as unknown as Redis & { has(key: string): boolean };
}

export function fakeRedisBus(): RedisBus & {
  published(channelPrefix: string): string[];
} {
  const listeners = new Map<string, Set<(payload: string) => void>>();
  const seen = new Map<string, string[]>();
  return {
    async publish(channel, payload) {
      seen.set(channel, [...(seen.get(channel) ?? []), payload]);
      for (const listener of [...(listeners.get(channel) ?? [])])
        listener(payload);
    },
    subscribe(channel, listener) {
      const set = listeners.get(channel) ?? new Set();
      set.add(listener);
      listeners.set(channel, set);
      return () => {
        set.delete(listener);
      };
    },
    async close() {},
    published: (channelPrefix) =>
      [...seen]
        .filter(([channel]) => channel.startsWith(channelPrefix))
        .flatMap(([, payloads]) => payloads),
  };
}

export function fakeBlobs(): BlobHandoff {
  const store = new Map<string, Buffer>();
  let next = 0;
  return {
    async put(data) {
      const key = `blob:${next++}`;
      store.set(key, data);
      return key;
    },
    async take(key) {
      const body = store.get(key) ?? null;
      store.delete(key);
      return body;
    },
  };
}

export function stubFileChannel(
  overrides: Partial<SatelliteFileChannel> = {},
): SatelliteFileChannel {
  return {
    enqueue: async () => ({ ok: true as const, id: "unused" }),
    awaitResult: async () => ({ ok: false as const, errno: "EIO" as const }),
    take: async () => [],
    settle: async () => {},
    seen: async () => {},
    isPresent: async () => false,
    revoke: async () => {},
    isRevoked: async () => false,
    clearRevoked: async () => {},
    satelliteOffline: async () => {},
    flushSummary: async () => {},
    ...overrides,
  };
}
