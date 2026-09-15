import {
  browserStorage,
  type KeyValueStore,
  safeGetItem,
  safeSetItem,
} from "../../../lib/safe-storage.js";

const KEY = "platform.greetedAgents";
const CAP = 200;

/**
 * UNIT_BOUNDARY_DESCRIPTION: which agents have already been sent their opening
 * turn. An agent's session list is the real answer, but it stays empty for a
 * moment after the turn is sent and before the harness reports the session —
 * long enough that a reload in that window greets the agent a second time. A
 * ref cannot see across reloads or tabs; this can.
 */
function read(store: KeyValueStore): string[] {
  const raw = safeGetItem(store, KEY);
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((id): id is string => typeof id === "string")
      : [];
  } catch {
    return [];
  }
}

export function hasGreeted(
  agentId: string,
  store: KeyValueStore = browserStorage,
): boolean {
  return read(store).includes(agentId);
}

export function markGreeted(
  agentId: string,
  store: KeyValueStore = browserStorage,
): void {
  const next = [...read(store).filter((id) => id !== agentId), agentId];
  safeSetItem(store, KEY, JSON.stringify(next.slice(-CAP)));
}

export function clearGreeted(
  agentId: string,
  store: KeyValueStore = browserStorage,
): void {
  safeSetItem(
    store,
    KEY,
    JSON.stringify(read(store).filter((id) => id !== agentId)),
  );
}
