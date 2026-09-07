import {
  browserStorage,
  type KeyValueStore,
  safeGetItem,
  safeSetItem,
} from "./safe-storage.js";

export function readPersistedFlag(
  key: string,
  fallback: boolean,
  store: KeyValueStore = browserStorage,
): boolean {
  const raw = safeGetItem(store, key);
  return raw === null ? fallback : raw === "1";
}

export function writePersistedFlag(
  key: string,
  value: boolean,
  store: KeyValueStore = browserStorage,
): void {
  safeSetItem(store, key, value ? "1" : "0");
}

export function readPersistedNumber<T extends number | null>(
  key: string,
  fallback: T,
  store: KeyValueStore = browserStorage,
): number | T {
  const raw = safeGetItem(store, key);
  if (raw === null || raw.trim() === "") return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

export function writePersistedNumber(
  key: string,
  value: number,
  store: KeyValueStore = browserStorage,
): void {
  safeSetItem(store, key, String(value));
}
