import { describe, expect, it } from "vitest";
import { createTtlMap } from "../../core/ttl-map.js";

/**
 * TEST_OVERVIEW: The expiring map the channel worker's caches are built on. An
 * entry is absent once its TTL has passed, a `set` on a live key restarts its
 * TTL, and past the entry cap a `set` sweeps only the expired entries.
 */

describe("createTtlMap", () => {
  /**
   * TEST_SCENARIO: A cached value must not outlive its TTL, and asking for it
   * after the TTL has passed must answer as if it was never stored.
   */
  it("treats an expired entry as absent", () => {
    let now = 0;
    const map = createTtlMap<string, number>({ ttlMs: 100, now: () => now });
    map.set("a", 1);
    now = 99;
    expect(map.get("a")).toBe(1);
    now = 100;
    expect(map.get("a")).toBeUndefined();
  });

  /**
   * TEST_SCENARIO: A cache refreshed just before it expires must keep its value
   * for another full TTL, and its re-insertion must move it behind entries
   * written later so the expired prefix stays a prefix.
   */
  it("restarts the TTL when a key is set again", () => {
    let now = 0;
    const map = createTtlMap<string, number>({ ttlMs: 100, now: () => now });
    map.set("a", 1);
    now = 90;
    map.set("a", 2);
    map.set("b", 3);
    now = 150;
    expect(map.get("a")).toBe(2);
    expect(map.get("b")).toBe(3);
  });

  /**
   * TEST_SCENARIO: A caller that measured when it began a slow lookup anchors
   * the entry there, so the TTL counts from the read, not from the write.
   */
  it("anchors the TTL at the time the caller measured", () => {
    let now = 100;
    const map = createTtlMap<string, number>({ ttlMs: 100, now: () => now });
    map.set("a", 1, 0);
    now = 99;
    expect(map.get("a")).toBe(1);
    now = 100;
    expect(map.get("a")).toBeUndefined();
  });

  /**
   * TEST_SCENARIO: Past the cap, a write sweeps expired entries only: a live
   * entry written first must survive the sweep.
   */
  it("sweeps expired entries past the cap and keeps live ones", () => {
    let now = 0;
    const map = createTtlMap<string, number>({
      ttlMs: 100,
      maxEntries: 2,
      now: () => now,
    });
    map.set("a", 1);
    now = 50;
    map.set("b", 2);
    now = 120;
    map.set("c", 3);
    expect(map.get("a")).toBeUndefined();
    expect(map.get("b")).toBe(2);
    expect(map.get("c")).toBe(3);
  });
});
