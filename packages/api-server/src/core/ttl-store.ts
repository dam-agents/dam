import type { Redis } from "ioredis";

export interface TtlStore<T> {
  set(key: string, value: T): Promise<void>;
  peek(key: string): Promise<T | null>;
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
