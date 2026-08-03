import type { Redis } from "ioredis";

/**
 * Cross-replica TTL key-value store for short-lived handoff state (OAuth
 * `state` records, chat→agent bind flows). Values are JSON; expiry is
 * Redis-native TTL. Any replica can serve the callback leg of a flow
 * another replica started.
 */
export interface TtlStore<T> {
  set(key: string, value: T): Promise<void>;
  /** Non-consuming read — callers consume only on success, so a
   *  recoverable failure leaves the flow alive within the TTL. */
  peek(key: string): Promise<T | null>;
  /** Atomic read-and-delete. */
  consume(key: string): Promise<T | null>;
  delete(key: string): Promise<void>;
}

export function createRedisTtlStore<T>(
  redis: Redis,
  prefix: string,
  ttlMs: number,
): TtlStore<T> {
  const k = (key: string) => `${prefix}:${key}`;
  return {
    async set(key, value) {
      await redis.set(k(key), JSON.stringify(value), "PX", ttlMs);
    },
    async peek(key) {
      const raw = await redis.get(k(key));
      return raw === null ? null : (JSON.parse(raw) as T);
    },
    async consume(key) {
      const raw = await redis.getdel(k(key));
      return raw === null ? null : (JSON.parse(raw) as T);
    },
    async delete(key) {
      await redis.del(k(key));
    },
  };
}

/** In-memory TtlStore for tests and compositions without Redis. */
export function createMemoryTtlStore<T>(
  ttlMs: number,
  now: () => number = () => Date.now(),
): TtlStore<T> {
  const entries = new Map<string, { value: T; expiresAt: number }>();
  const live = (key: string) => {
    const e = entries.get(key);
    if (!e) return null;
    if (now() > e.expiresAt) {
      entries.delete(key);
      return null;
    }
    return e;
  };
  return {
    async set(key, value) {
      entries.set(key, { value, expiresAt: now() + ttlMs });
    },
    async peek(key) {
      return live(key)?.value ?? null;
    },
    async consume(key) {
      const e = live(key);
      entries.delete(key);
      return e?.value ?? null;
    },
    async delete(key) {
      entries.delete(key);
    },
  };
}
