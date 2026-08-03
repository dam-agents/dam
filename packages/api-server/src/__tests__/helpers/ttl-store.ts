import type { TtlStore } from "../../core/ttl-store.js";

/** In-memory TtlStore whose backing Map stays visible for assertions —
 *  tests seed and inspect flows synchronously via `map`. */
export function createInspectableTtlStore<T>(): {
  store: TtlStore<T>;
  map: Map<string, T>;
} {
  const map = new Map<string, T>();
  return {
    map,
    store: {
      async set(key, value) {
        map.set(key, value);
      },
      async peek(key) {
        return map.get(key) ?? null;
      },
      async consume(key) {
        const v = map.get(key) ?? null;
        map.delete(key);
        return v;
      },
      async delete(key) {
        map.delete(key);
      },
    },
  };
}
