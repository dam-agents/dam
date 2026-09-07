import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createFileDocumentStoreBackend } from "../../core/document-store.js";
import { createActiveTurnStore } from "../../modules/acp/infrastructure/active-turn-store.js";

/**
 * TEST_OVERVIEW: the store is the only record that a turn was interrupted, and
 * its two load-bearing rules cannot be reached from a browser: a re-record
 * keeps the recovery attempt count (or a crash-loop guard resets on every
 * resume), and reading it back across a fresh backend is what boot recovery
 * actually does. Both are asserted here against the real file backend.
 */

let dir: string;
let tick: number;
const clock = () => `t${String(++tick).padStart(4, "0")}`;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "active-turns-"));
  tick = 0;
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const open = () =>
  createActiveTurnStore(createFileDocumentStoreBackend(dir), clock);

describe("active-turn store", () => {
  it("records, surfaces, and clears markers", () => {
    const store = open();
    store.record("s1", "machine");
    store.record("s2", "interactive");
    expect(store.leftovers()).toEqual([
      { sessionId: "s1", startedAt: "t0001", origin: "machine", attempts: 0 },
      {
        sessionId: "s2",
        startedAt: "t0002",
        origin: "interactive",
        attempts: 0,
      },
    ]);
    store.remove("s1");
    expect(store.leftovers().map((m) => m.sessionId)).toEqual(["s2"]);
  });

  it("preserves attempts across a re-record but bumps on demand", () => {
    const store = open();
    store.record("s1", "machine");
    store.bumpAttempts("s1");
    store.record("s1", "machine");
    expect(store.leftovers()[0]?.attempts).toBe(1);
  });

  it("reads leftovers back from disk on a fresh backend", () => {
    open().record("s1", "machine");
    expect(open().leftovers()).toEqual([
      { sessionId: "s1", startedAt: "t0001", origin: "machine", attempts: 0 },
    ]);
  });

  it("clearAll empties the document", () => {
    const store = open();
    store.record("s1", "machine");
    store.clearAll();
    expect(store.leftovers()).toEqual([]);
  });
});
