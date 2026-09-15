// TEST_OVERVIEW: an agent is sent its opening turn once per browser, not once
// TEST_OVERVIEW: per mounted view. The session list settles this afterwards, but
// TEST_OVERVIEW: it is empty for a moment after the turn is sent, so a reload in
// TEST_OVERVIEW: that window used to greet the same agent a second time.
import { describe, expect, test } from "vitest";

import type { KeyValueStore } from "../../lib/safe-storage.js";
import {
  clearGreeted,
  hasGreeted,
  markGreeted,
} from "../../modules/agents/lib/greeted-agents.js";

function store(): KeyValueStore {
  const map = new Map<string, string>();
  return {
    keys: () => [...map.keys()],
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
  };
}

describe("greetedAgents", () => {
  test("a marked agent stays marked, and only that agent", () => {
    const s = store();
    expect(hasGreeted("a", s)).toBe(false);
    markGreeted("a", s);
    expect(hasGreeted("a", s)).toBe(true);
    expect(hasGreeted("b", s)).toBe(false);
  });

  test("a failed send releases the mark, so the next load retries", () => {
    const s = store();
    markGreeted("a", s);
    clearGreeted("a", s);
    expect(hasGreeted("a", s)).toBe(false);
  });

  test("the list is capped, keeping the most recent agents", () => {
    const s = store();
    for (let i = 0; i < 250; i++) markGreeted(`agent-${i}`, s);
    expect(hasGreeted("agent-249", s)).toBe(true);
    expect(hasGreeted("agent-50", s)).toBe(true);
    expect(hasGreeted("agent-49", s)).toBe(false);
  });

  test("unreadable or corrupt storage greets rather than throws", () => {
    const broken: KeyValueStore = {
      keys: () => {
        throw new Error("denied");
      },
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("denied");
      },
      removeItem: () => {
        throw new Error("denied");
      },
    };
    expect(hasGreeted("a", broken)).toBe(false);
    expect(() => markGreeted("a", broken)).not.toThrow();

    const garbage = store();
    garbage.setItem("platform.greetedAgents", "{not json");
    expect(hasGreeted("a", garbage)).toBe(false);
  });
});
