import type { SessionMetadataStore } from "../infrastructure/session-metadata-store.js";

const COALESCE_MS = 250;

export interface SessionChanges {
  notify(): void;
  announce(): void;
  subscribe(listener: () => void): () => void;
  watch(listener: () => void): () => void;
  onDemand(hooks: { start: () => void; stop: () => void }): void;
}

export function createSessionChanges(coalesceMs = COALESCE_MS): SessionChanges {
  const listeners = new Set<() => void>();
  const watchers = new Set<() => void>();
  let pending: ReturnType<typeof setTimeout> | undefined;
  let pendingWatchers = false;
  let hooks: { start: () => void; stop: () => void } | undefined;

  const fire = (withWatchers: boolean) => {
    pendingWatchers ||= withWatchers;
    if ((listeners.size === 0 && !pendingWatchers) || pending) return;
    pending = setTimeout(() => {
      pending = undefined;
      const all = pendingWatchers
        ? [...listeners, ...watchers]
        : [...listeners];
      pendingWatchers = false;
      for (const listener of all) listener();
    }, coalesceMs);
    pending.unref?.();
  };

  return {
    notify() {
      if (listeners.size === 0 && watchers.size === 0) return;
      fire(true);
    },

    // UNIT_BOUNDARY_DESCRIPTION: tells subscribers to re-read the list without telling watchers that a session changed, so a reader whose answer was incomplete can say the rest has arrived without dropping the listing it just read.
    announce() {
      fire(false);
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
    findByRef: (ref) => store.findByRef(ref),
    all: () => store.all(),
    isTombstoned: (sessionId) => store.isTombstoned(sessionId),
    runStartsOf: (sessionId) => store.runStartsOf(sessionId),
    sendersOf: (sessionId) => store.sendersOf(sessionId),
    verdictsOf: (sessionId) => store.verdictsOf(sessionId),
    markUnstored: (sessionId) => store.markUnstored(sessionId),
    markStored: (sessionId) => store.markStored(sessionId),

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
    startRun(sessionId) {
      const stamp = store.startRun(sessionId);
      changes.notify();
      return stamp;
    },
    finishRun(sessionId) {
      store.finishRun(sessionId);
      changes.notify();
    },
    recordSender(sessionId, entry) {
      store.recordSender(sessionId, entry);
      changes.notify();
    },
    recordVerdict(sessionId, verdict) {
      store.recordVerdict(sessionId, verdict);
    },
    copyAttribution(sessionId, fromSessionId, opts) {
      store.copyAttribution(sessionId, fromSessionId, opts);
      changes.notify();
    },
    adopt(sessionId, fromSessionId, meta) {
      store.adopt(sessionId, fromSessionId, meta);
      changes.notify();
    },
    tombstone(sessionId) {
      store.tombstone(sessionId);
      changes.notify();
    },
  };
}
