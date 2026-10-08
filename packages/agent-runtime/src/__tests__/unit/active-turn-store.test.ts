import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createFileDocumentStoreBackend } from "../../core/document-store.js";
import { createActiveTurnStore } from "../../modules/acp/infrastructure/active-turn-store.js";

/**
 * TEST_OVERVIEW: the store is the only record that a turn was interrupted, and
 * its load-bearing rules cannot be reached from a browser: the resumed turn's
 * re-record keeps the recovery attempt count (or a crash-loop guard resets on
 * every resume),
 * reading it back across a fresh backend is what boot recovery actually does,
 * and only a marker the previous process left behind is a leftover — a turn
 * this process runs is live work, not an interrupted one. All are asserted
 * here against the real file backend.
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
  it("surfaces the previous process's markers and clears them", () => {
    const previous = open();
    previous.record("s1");
    previous.record("s2");
    const booted = open();
    expect(booted.leftovers()).toEqual([
      { sessionId: "s1", startedAt: "t0001", attempts: 0 },
      { sessionId: "s2", startedAt: "t0002", attempts: 0 },
    ]);
    booted.remove("s1");
    expect(booted.leftovers().map((m) => m.sessionId)).toEqual(["s2"]);
  });

  it("preserves attempts across a re-record but bumps on demand", () => {
    const store = open();
    store.record("s1");
    store.bumpAttempts("s1");
    store.record("s1");
    expect(open().leftovers()[0]?.attempts).toBe(1);
  });

  it("reads leftovers back from disk on a fresh backend", () => {
    open().record("s1");
    expect(open().leftovers()).toEqual([
      { sessionId: "s1", startedAt: "t0001", attempts: 0 },
    ]);
  });

  /**
   * TEST_SCENARIO: boot recovery reads leftovers a few seconds after boot. A
   * turn this process started before then — the first chat message after a
   * restart — has a marker on disk while it runs, but it is live work. If it
   * counted as a leftover, recovery would resume its Session with an
   * interruption notice and the agent would answer the message twice.
   */
  it("does not count a turn this process started as a leftover", () => {
    const booted = open();
    booted.record("live");
    expect(booted.leftovers()).toEqual([]);
  });

  /**
   * TEST_SCENARIO: a leftover Session that runs a new turn in this process
   * stops being a leftover: the new turn owns the marker now. Its attempt
   * count still reaches the next boot, so a resume that dies again is not
   * resumed a second time.
   */
  it("drops an inherited marker once this process runs a turn on it", () => {
    const previous = open();
    previous.record("s1");
    const booted = open();
    booted.bumpAttempts("s1");
    booted.record("s1");
    expect(booted.leftovers()).toEqual([]);
    expect(open().leftovers()).toEqual([
      { sessionId: "s1", startedAt: "t0002", attempts: 1 },
    ]);
  });
});
