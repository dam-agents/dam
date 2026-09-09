import { describe, expect, it } from "vitest";

import {
  readPersistedFlag,
  readPersistedNumber,
  writePersistedFlag,
  writePersistedNumber,
} from "../../lib/persisted-prefs.js";
import type { KeyValueStore } from "../../lib/safe-storage.js";

/**
 * TEST_OVERVIEW: Persisted preferences are read while the chat view renders,
 * so the storage boundary must never raise. Browsers that block site data
 * throw on every localStorage touch, and that branch is unreachable by hand —
 * it needs a store that throws, which is why these cases are asserted here
 * rather than left to a smoke test. The rest pins the encoding both ways and
 * the rule for a value that is present but unusable: fall back rather than
 * hand a caller a NaN width.
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

const throwingStore: KeyValueStore = {
  keys: () => {
    throw new Error("storage disabled");
  },
  getItem: () => {
    throw new Error("storage disabled");
  },
  setItem: () => {
    throw new Error("storage disabled");
  },
  removeItem: () => {
    throw new Error("storage disabled");
  },
};

describe("persisted preferences against a throwing store", () => {
  it("TEST_SCENARIO: a read falls back instead of raising", () => {
    expect(readPersistedFlag("k", true, throwingStore)).toBe(true);
    expect(readPersistedFlag("k", false, throwingStore)).toBe(false);
    expect(readPersistedNumber("k", 220, throwingStore)).toBe(220);
    expect(readPersistedNumber("k", null, throwingStore)).toBeNull();
  });

  it("TEST_SCENARIO: a write is dropped instead of raising", () => {
    expect(() => writePersistedFlag("k", true, throwingStore)).not.toThrow();
    expect(() => writePersistedNumber("k", 1, throwingStore)).not.toThrow();
  });
});

describe("persisted preferences round-trip", () => {
  it("TEST_SCENARIO: an absent key yields the caller's fallback", () => {
    const store = mapStore();
    expect(readPersistedFlag("k", true, store)).toBe(true);
    expect(readPersistedNumber("k", 260, store)).toBe(260);
    expect(readPersistedNumber("k", null, store)).toBeNull();
  });

  it("TEST_SCENARIO: a stored value wins over the fallback", () => {
    const store = mapStore();
    writePersistedFlag("flag", false, store);
    writePersistedNumber("num", 315, store);
    expect(readPersistedFlag("flag", true, store)).toBe(false);
    expect(readPersistedNumber("num", 220, store)).toBe(315);
  });

  it("TEST_SCENARIO: an unusable stored number falls back", () => {
    for (const raw of ["garbage", "", "   ", "NaN", "Infinity"]) {
      const store = mapStore({ num: raw });
      expect(readPersistedNumber("num", 220, store)).toBe(220);
    }
  });
});
