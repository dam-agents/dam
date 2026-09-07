/**
 * UNIT_BOUNDARY_DESCRIPTION: the one localStorage boundary for the session
 * stores (drafts, undelivered sends). Browsers throw on any localStorage
 * touch when storage is disabled or full, and these stores are read and
 * swept on paths that must not abort — sign-out, owner switch, session
 * load — so every access here absorbs the throw instead of raising it.
 * setItem is deliberately not wrapped: writers handle their own quota
 * failures, and how (shed records, warn) differs per store.
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
