import { useSyncExternalStore } from "react";

import {
  browserStorage,
  type KeyValueStore,
  safeGetItem,
  safeSetItem,
} from "../../../lib/safe-storage.js";

const KEY = "platform-pinned-sessions";
const listeners = new Set<() => void>();
let cached: { raw: string | null; set: ReadonlySet<string> } | null = null;

export const pinKey = (agentId: string, sessionId: string) =>
  `${agentId}:${sessionId}`;

export function readPinnedSessions(
  store: KeyValueStore = browserStorage,
): ReadonlySet<string> {
  const raw = safeGetItem(store, KEY);
  if (cached?.raw === raw) return cached.set;
  let ids: unknown = [];
  try {
    ids = raw ? JSON.parse(raw) : [];
  } catch {}
  const set = new Set(
    Array.isArray(ids)
      ? ids.filter((id): id is string => typeof id === "string")
      : [],
  );
  cached = { raw, set };
  return set;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key === KEY) listener();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

function writePinned(
  pin: (set: Set<string>) => void,
  store: KeyValueStore,
): void {
  const next = new Set(readPinnedSessions(store));
  pin(next);
  safeSetItem(store, KEY, JSON.stringify([...next]));
  for (const listener of listeners) listener();
}

export function togglePinnedSession(
  key: string,
  store: KeyValueStore = browserStorage,
): void {
  writePinned((set) => set.delete(key) || set.add(key), store);
}

export function unpinSession(
  key: string,
  store: KeyValueStore = browserStorage,
): void {
  if (readPinnedSessions(store).has(key))
    writePinned((set) => set.delete(key), store);
}

// UNIT_BOUNDARY_DESCRIPTION: the Sessions the viewer pinned to the top of the sidebar, kept in this browser only (a prototype ceiling: pins do not follow the user to another device; a per-owner list beside the sidebar order is the upgrade). A key is `agentId:sessionId`; other tabs see a change through the storage event.
export function usePinnedSessions(): ReadonlySet<string> {
  return useSyncExternalStore(subscribe, () => readPinnedSessions());
}
