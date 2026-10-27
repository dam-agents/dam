// TEST_OVERVIEW: The command palette keeps its frecency and its copies of the session and artifact lists in this browser's localStorage only: one versioned key per list, readable only by the person who wrote it, with a decayed use count that halves every week and a cap on how many commands it remembers.
import { describe, expect, it } from "vitest";
import { z } from "zod";

import type { KeyValueStore } from "../../lib/safe-storage.js";
import {
  type Frecency,
  frecencySchema,
  recordUse,
  usesAt,
} from "../../modules/command-palette/lib/frecency.js";
import {
  clearPaletteStorage,
  readStored,
  writeStored,
} from "../../modules/command-palette/lib/palette-storage.js";
import { RANKING } from "../../modules/command-palette/lib/ranking.js";

const DAY = 86_400_000;
const NOW = Date.parse("2026-10-27T12:00:00Z");

function memoryStore(): KeyValueStore & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    keys: () => [...map.keys()],
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, value),
    removeItem: (key) => void map.delete(key),
  };
}

describe("frecency decay", () => {
  // TEST_SCENARIO: three runs today count 3; a week later they count half, four weeks later a sixteenth.
  it("halves the use count every half-life", () => {
    let table: Frecency = {};
    for (let i = 0; i < 3; i++)
      table = recordUse(table, "settings:api-keys", NOW);
    expect(usesAt(table, "settings:api-keys", NOW)).toBeCloseTo(3);
    expect(usesAt(table, "settings:api-keys", NOW + 7 * DAY)).toBeCloseTo(1.5);
    expect(usesAt(table, "settings:api-keys", NOW + 28 * DAY)).toBeCloseTo(
      3 / 16,
    );
    expect(usesAt(table, "never-run", NOW)).toBe(0);
  });

  // TEST_SCENARIO: a run adds one to what is left of the decayed count, so an old habit and a new run combine.
  it("adds a run to the decayed count", () => {
    const once = recordUse({}, "go:home", NOW);
    const again = recordUse(once, "go:home", NOW + 7 * DAY);
    expect(usesAt(again, "go:home", NOW + 7 * DAY)).toBeCloseTo(1.5);
  });

  // TEST_SCENARIO: past the cap the palette forgets the commands with the weakest decayed count, never the one just run.
  it("keeps at most the cap, dropping the weakest", () => {
    let table: Frecency = {};
    for (let i = 0; i < RANKING.MAX_FRECENCY_ENTRIES; i++)
      table = recordUse(table, `old-${i}`, NOW - 30 * DAY + i);
    table = recordUse(table, "fresh", NOW);
    expect(Object.keys(table)).toHaveLength(RANKING.MAX_FRECENCY_ENTRIES);
    expect(table.fresh).toBeDefined();
    expect(table["old-0"]).toBeUndefined();
  });
});

describe("stored lists", () => {
  // TEST_SCENARIO: a stored list is read back by the person who wrote it, under a versioned, namespaced key.
  it("round-trips for its owner under a versioned key", () => {
    const store = memoryStore();
    writeStored("frecency", "user-a", { x: { s: 1, t: NOW } }, store);
    expect([...store.map.keys()]).toEqual([
      "platform-command-palette:v1:frecency",
    ]);
    expect(readStored("frecency", "user-a", frecencySchema, store)).toEqual({
      x: { s: 1, t: NOW },
    });
  });

  // TEST_SCENARIO: another person signing in on the same browser never sees the first person's session titles, and the first read drops them.
  it("ignores and drops a list another person wrote", () => {
    const store = memoryStore();
    writeStored("sessions", "user-a", [{ title: "secret" }], store);
    expect(
      readStored("sessions", "user-b", z.array(z.unknown()), store),
    ).toBeNull();
    expect(store.map.size).toBe(0);
  });

  // TEST_SCENARIO: signing out empties every list the palette stored, of any version, and nothing else.
  it("clears its own keys on sign-out", () => {
    const store = memoryStore();
    writeStored("frecency", "user-a", {}, store);
    store.setItem("platform-command-palette:v0:old", "x");
    store.setItem("platform-theme", "dark");
    clearPaletteStorage(store);
    expect([...store.map.keys()]).toEqual(["platform-theme"]);
  });

  // TEST_SCENARIO: a corrupt or outdated value reads as nothing stored instead of breaking the palette.
  it("reads corrupt or mismatched values as nothing", () => {
    const store = memoryStore();
    store.setItem("platform-command-palette:v1:frecency", "{not json");
    expect(readStored("frecency", "user-a", frecencySchema, store)).toBeNull();
    writeStored("frecency", "user-a", { x: { s: -1, t: NOW } }, store);
    expect(readStored("frecency", "user-a", frecencySchema, store)).toBeNull();
  });
});
