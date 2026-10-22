const DEFAULT_MAX_ENTRIES = 5_000;

export interface TtlMap<K, V> {
  get(key: K): V | undefined;
  set(key: K, value: V, writtenAt?: number): void;
  delete(key: K): void;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: A per-replica map whose entries expire. `get`
 * treats an expired entry as absent and drops it, so a stale answer never
 * outlives its TTL. `set` moves the key to the back, which keeps insertion
 * order equal to expiry order; past `maxEntries`, `set` sweeps the expired
 * entries from the front and stops at the first live one. An evicted entry
 * costs a redundant upstream call, never a wrong answer.
 */
export function createTtlMap<K, V>(opts: {
  ttlMs: number;
  maxEntries?: number;
  now?: () => number;
}): TtlMap<K, V> {
  const maxEntries = opts.maxEntries ?? DEFAULT_MAX_ENTRIES;
  const now = opts.now ?? Date.now;
  const entries = new Map<K, { value: V; expiresAt: number }>();
  return {
    get(key) {
      const entry = entries.get(key);
      if (!entry) return undefined;
      if (entry.expiresAt <= now()) {
        entries.delete(key);
        return undefined;
      }
      return entry.value;
    },
    set(key, value, writtenAt) {
      if (!entries.has(key) && entries.size >= maxEntries) {
        const at = now();
        for (const [stale, entry] of entries) {
          if (entry.expiresAt > at) break;
          entries.delete(stale);
        }
      }
      entries.delete(key);
      entries.set(key, {
        value,
        expiresAt: (writtenAt ?? now()) + opts.ttlMs,
      });
    },
    delete(key) {
      entries.delete(key);
    },
  };
}
