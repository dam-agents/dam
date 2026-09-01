const DEFAULT_MAX_ENTRIES = 10_000;

/**
 * UNIT_BOUNDARY_DESCRIPTION: Bounded insertion into a per-replica cache. At the
 * cap the oldest key goes — a Map iterates in insertion order — so crossing it
 * costs one entry, not the whole map. Insertion order, not access order: a key
 * re-`set` after eviction moves to the back, but a hot key that is only read
 * still ages out. The caches this backs re-fetch on a miss, so an early
 * eviction costs a redundant upstream call, never a wrong answer.
 */
export function boundedSet<K, V>(
  map: Map<K, V>,
  key: K,
  value: V,
  maxEntries = DEFAULT_MAX_ENTRIES,
): void {
  if (!map.has(key) && map.size >= maxEntries) {
    const oldest = map.keys().next();
    if (!oldest.done) map.delete(oldest.value);
  }
  map.set(key, value);
}
