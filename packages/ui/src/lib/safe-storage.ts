/**
 * UNIT_BOUNDARY_DESCRIPTION: the one localStorage boundary in the UI, used by
 * the session stores (drafts, undelivered sends) and by persisted user
 * preferences. Browsers throw on any localStorage touch when storage is
 * disabled or full, and these callers read and sweep on paths that must not
 * abort — sign-out, owner switch, session load, first render — so every
 * access here absorbs the throw instead of raising it.
 *
 * Writes split by what a lost write costs. The session stores call setItem
 * directly and handle their own quota failures, because how (shed records,
 * warn) differs per store and losing a record the user typed matters.
 * Preferences use safeSetItem, where the worst outcome is a panel returning
 * to its default and a toast would be noise.
 */
export interface KeyValueStore {
  keys(): string[];
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export const browserStorage: KeyValueStore = {
  keys: () => Object.keys(localStorage),
  getItem: (key) => localStorage.getItem(key),
  setItem: (key, value) => localStorage.setItem(key, value),
  removeItem: (key) => localStorage.removeItem(key),
};

export function safeKeys(store: KeyValueStore): string[] {
  try {
    return store.keys();
  } catch {
    return [];
  }
}

export function safeGetItem(store: KeyValueStore, key: string): string | null {
  try {
    return store.getItem(key);
  } catch {
    return null;
  }
}

export function safeSetItem(
  store: KeyValueStore,
  key: string,
  value: string,
): void {
  try {
    store.setItem(key, value);
  } catch {}
}

export function safeRemoveItem(store: KeyValueStore, key: string): void {
  try {
    store.removeItem(key);
  } catch {}
}

export function removeAllWithPrefix(
  store: KeyValueStore,
  prefix: string,
): void {
  for (const key of safeKeys(store)) {
    if (key.startsWith(prefix)) safeRemoveItem(store, key);
  }
}
