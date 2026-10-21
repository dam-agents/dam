import { useSyncExternalStore } from "react";

import {
  browserStorage,
  type KeyValueStore,
  safeGetItem,
  safeSetItem,
} from "../../../lib/safe-storage.js";
import {
  type ActivityFilters,
  isFiltered,
  parseActivityFilters,
  serializeActivityFilters,
} from "../../home/lib/activity-filter.js";
import { keepFirstSessionPages } from "../api/queries.js";

const KEY = "platform-agent-session-filters";
const listeners = new Set<() => void>();
const NO_FILTERS: ReadonlyMap<string, ActivityFilters> = new Map();
let cached: {
  raw: string | null;
  map: ReadonlyMap<string, ActivityFilters>;
} | null = null;

export function readAgentSessionFilters(
  store: KeyValueStore = browserStorage,
): ReadonlyMap<string, ActivityFilters> {
  const raw = safeGetItem(store, KEY);
  if (cached?.raw === raw) return cached.map;
  let entries: unknown = {};
  try {
    entries = raw ? JSON.parse(raw) : {};
  } catch {}
  const map = new Map<string, ActivityFilters>();
  if (typeof entries === "object" && entries !== null)
    for (const [agentId, value] of Object.entries(entries)) {
      const filters = parseActivityFilters(value);
      if (isFiltered(filters)) map.set(agentId, filters);
    }
  cached = { raw, map };
  return map;
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

export function setAgentSessionFilter(
  agentId: string,
  filters: ActivityFilters,
  store: KeyValueStore = browserStorage,
): void {
  const current = readAgentSessionFilters(store);
  if (current.has(agentId) && !isFiltered(filters)) keepFirstSessionPages();
  const next = Object.fromEntries(
    [...current].map(([id, f]) => [id, serializeActivityFilters(f)]),
  );
  if (isFiltered(filters)) next[agentId] = serializeActivityFilters(filters);
  else delete next[agentId];
  safeSetItem(store, KEY, JSON.stringify(next));
  for (const listener of listeners) listener();
}

export function useAgentSessionFilters(): ReadonlyMap<string, ActivityFilters> {
  return useSyncExternalStore(
    subscribe,
    () => readAgentSessionFilters(),
    () => NO_FILTERS,
  );
}

// UNIT_BOUNDARY_DESCRIPTION: the session filter the viewer set on one Agent's row in the sidebar, kept in this browser only, like pins; undefined while the Agent has none, since a filter reset to the default is removed rather than stored. Other tabs see a change through the storage event.
export function useAgentSessionFilter(
  agentId: string,
): ActivityFilters | undefined {
  return useSyncExternalStore(
    subscribe,
    () => readAgentSessionFilters().get(agentId),
    () => undefined,
  );
}
