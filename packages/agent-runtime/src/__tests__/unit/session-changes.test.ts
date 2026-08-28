import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionMetadataStore } from "../../modules/acp/infrastructure/session-metadata-store.js";
import {
  createSessionChanges,
  notifyingSessionMetadataStore,
} from "../../modules/acp/services/session-changes.js";

// TEST_OVERVIEW: the notifier behind session watch notices — coalescing, subscriber counting, on-demand hooks, the store decorator.

function fakeStore(): SessionMetadataStore {
  return {
    get: () => undefined,
    set: () => {},
    recordActivity: () => {},
    recordSeen: () => {},
    all: () => ({}),
    tombstone: () => {},
    isTombstoned: () => false,
  };
}

describe("createSessionChanges", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("coalesces a burst into one delivery", () => {
    const changes = createSessionChanges(250);
    const seen = vi.fn();
    changes.subscribe(seen);
    changes.notify();
    changes.notify();
    changes.notify();
    expect(seen).not.toHaveBeenCalled();
    vi.advanceTimersByTime(250);
    expect(seen).toHaveBeenCalledTimes(1);
  });

  it("drops notifications with no subscriber", () => {
    const changes = createSessionChanges(250);
    changes.notify();
    const seen = vi.fn();
    changes.subscribe(seen);
    vi.advanceTimersByTime(1_000);
    expect(seen).not.toHaveBeenCalled();
  });

  it("starts on-demand work with the first subscriber and stops with the last", () => {
    const changes = createSessionChanges(250);
    const start = vi.fn();
    const stop = vi.fn();
    changes.onDemand({ start, stop });
    const unsubA = changes.subscribe(() => {});
    const unsubB = changes.subscribe(() => {});
    expect(start).toHaveBeenCalledTimes(1);
    unsubA();
    expect(stop).not.toHaveBeenCalled();
    unsubB();
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it("notifies on every store mutation and on no read", () => {
    const changes = createSessionChanges(250);
    const seen = vi.fn();
    changes.subscribe(seen);
    const store = notifyingSessionMetadataStore(fakeStore(), changes);

    store.get("x");
    store.all();
    store.isTombstoned("x");
    vi.advanceTimersByTime(1_000);
    expect(seen).not.toHaveBeenCalled();

    store.set("x", {});
    vi.advanceTimersByTime(250);
    store.recordActivity("x");
    vi.advanceTimersByTime(250);
    store.recordSeen("x");
    vi.advanceTimersByTime(250);
    store.tombstone("x");
    vi.advanceTimersByTime(250);
    expect(seen).toHaveBeenCalledTimes(4);
  });
});
