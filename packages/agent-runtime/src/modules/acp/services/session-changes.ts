import type { SessionMetadataStore } from "../infrastructure/session-metadata-store.js";

const COALESCE_MS = 250;

export interface SessionChanges {
  notify(): void;
  subscribe(listener: () => void): () => void;
  watch(listener: () => void): () => void;
  onDemand(hooks: { start: () => void; stop: () => void }): void;
}

export function createSessionChanges(coalesceMs = COALESCE_MS): SessionChanges {
  const listeners = new Set<() => void>();
  const watchers = new Set<() => void>();
  let pending: ReturnType<typeof setTimeout> | undefined;
  let hooks: { start: () => void; stop: () => void } | undefined;

  return {
    notify() {
      if ((listeners.size === 0 && watchers.size === 0) || pending) return;
      pending = setTimeout(() => {
        pending = undefined;
        for (const listener of [...listeners, ...watchers]) listener();
      }, coalesceMs);
      pending.unref?.();
    },

    watch(listener) {
      watchers.add(listener);
      return () => watchers.delete(listener);
    },

    subscribe(listener) {
      listeners.add(listener);
      if (listeners.size === 1) hooks?.start();
      return () => {
        listeners.delete(listener);
        if (listeners.size > 0) return;
        if (watchers.size === 0 && pending) {
          clearTimeout(pending);
          pending = undefined;
        }
        hooks?.stop();
      };
    },

    onDemand(next) {
      hooks = next;
    },
  };
}

export function notifyingSessionMetadataStore(
  store: SessionMetadataStore,
  changes: SessionChanges,
): SessionMetadataStore {
  return {
    get: (sessionId) => store.get(sessionId),
    all: () => store.all(),
    isTombstoned: (sessionId) => store.isTombstoned(sessionId),

    set(sessionId, meta) {
      store.set(sessionId, meta);
      changes.notify();
    },
    recordActivity(sessionId) {
      store.recordActivity(sessionId);
      changes.notify();
    },
    recordSeen(sessionId) {
      store.recordSeen(sessionId);
      changes.notify();
    },
    tombstone(sessionId) {
      store.tombstone(sessionId);
      changes.notify();
    },
  };
}
