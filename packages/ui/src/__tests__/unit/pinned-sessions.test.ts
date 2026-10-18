import { describe, expect, it } from "vitest";

import type { KeyValueStore } from "../../lib/safe-storage.js";
import {
  pinKey,
  readPinnedSessions,
  togglePinnedSession,
  unpinSession,
} from "../../modules/sessions/lib/pinned-sessions.js";

/**
 * TEST_OVERVIEW: The sidebar's pinned Sessions live in browser storage. A
 * toggle pins and then unpins one Session by its agent and session id, and a
 * stored value that is not a list of ids reads as no pins rather than breaking
 * the sidebar.
 */

function mapStore(seed: Record<string, string> = {}): KeyValueStore {
  const map = new Map(Object.entries(seed));
  return {
    keys: () => [...map.keys()],
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, value),
    removeItem: (key) => void map.delete(key),
  };
}

describe("pinned sessions", () => {
  // TEST_SCENARIO: pinning the same Session twice leaves it unpinned, and a pin on one agent's Session does not pin another agent's Session with the same id.
  it("toggles one Session by agent and id", () => {
    const store = mapStore();
    togglePinnedSession(pinKey("agent-a", "s1"), store);
    expect(readPinnedSessions(store).has(pinKey("agent-a", "s1"))).toBe(true);
    expect(readPinnedSessions(store).has(pinKey("agent-b", "s1"))).toBe(false);
    togglePinnedSession(pinKey("agent-a", "s1"), store);
    expect(readPinnedSessions(store).size).toBe(0);
  });

  // TEST_SCENARIO: unpinning a deleted Session removes only its pin and never pins one that was not pinned.
  it("unpins without toggling", () => {
    const store = mapStore();
    togglePinnedSession(pinKey("agent-a", "s1"), store);
    unpinSession(pinKey("agent-a", "s2"), store);
    expect([...readPinnedSessions(store)]).toEqual([pinKey("agent-a", "s1")]);
    unpinSession(pinKey("agent-a", "s1"), store);
    unpinSession(pinKey("agent-a", "s1"), store);
    expect(readPinnedSessions(store).size).toBe(0);
  });

  // TEST_SCENARIO: a corrupt or foreign value under the key reads as no pins, and non-string entries are dropped.
  it("reads a bad stored value as no pins", () => {
    expect(
      readPinnedSessions(mapStore({ "platform-pinned-sessions": "{oops" }))
        .size,
    ).toBe(0);
    expect([
      ...readPinnedSessions(
        mapStore({ "platform-pinned-sessions": '["a:1", 7, null]' }),
      ),
    ]).toEqual(["a:1"]);
  });
});
