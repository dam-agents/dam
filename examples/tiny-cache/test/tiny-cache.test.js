import { test } from "node:test";
import assert from "node:assert/strict";
import { TinyCache } from "../src/tiny-cache.js";

function fakeClock(start = 0) {
  let t = start;
  const now = () => t;
  now.advance = (ms) => {
    t += ms;
  };
  return now;
}

test("set/get roundtrip", () => {
  const c = new TinyCache();
  c.set("a", 1);
  assert.equal(c.get("a"), 1);
});

test("miss returns undefined", () => {
  const c = new TinyCache();
  assert.equal(c.get("nope"), undefined);
  assert.equal(c.has("nope"), false);
});

test("overwrite updates in place without duplicating the key", () => {
  const c = new TinyCache();
  c.set("a", 1).set("a", 2);
  assert.equal(c.get("a"), 2);
  assert.equal(c.size, 1);
  assert.deepEqual(c.keys(), ["a"]);
});

test("delete removes the entry and reports whether it existed", () => {
  const c = new TinyCache();
  c.set("a", 1);
  assert.equal(c.delete("a"), true);
  assert.equal(c.delete("a"), false);
  assert.equal(c.get("a"), undefined);
  assert.equal(c.size, 0);
});

test("keys() are sorted lexicographically", () => {
  const c = new TinyCache();
  c.set("banana", 1).set("apple", 2).set("cherry", 3);
  assert.deepEqual(c.keys(), ["apple", "banana", "cherry"]);
});

test("FIFO eviction at maxEntries drops the oldest insertion", () => {
  const c = new TinyCache({ maxEntries: 2 });
  c.set("first", 1).set("second", 2).set("third", 3);
  assert.equal(c.size, 2);
  assert.equal(c.get("first"), undefined);
  assert.equal(c.get("second"), 2);
  assert.equal(c.get("third"), 3);
});

test("overwriting an existing key does not evict", () => {
  const c = new TinyCache({ maxEntries: 2 });
  c.set("a", 1).set("b", 2).set("a", 10);
  assert.equal(c.size, 2);
  assert.equal(c.get("a"), 10);
  assert.equal(c.get("b"), 2);
});

test("a TTL entry expires at exactly ttlMs", () => {
  const now = fakeClock();
  const c = new TinyCache({ now });
  c.set("a", 1, { ttlMs: 100 });
  now.advance(99);
  assert.equal(c.get("a"), 1, "live strictly before the deadline");
  now.advance(1);
  assert.equal(c.get("a"), undefined, "expired at the deadline itself");
  assert.equal(c.size, 0);
  assert.deepEqual(c.keys(), []);
});

test("overwriting refreshes the TTL", () => {
  const now = fakeClock();
  const c = new TinyCache({ now });
  c.set("a", 1, { ttlMs: 100 });
  now.advance(90);
  c.set("a", 2, { ttlMs: 100 });
  now.advance(90);
  assert.equal(c.get("a"), 2);
});

test("overwriting without a ttl makes the entry permanent", () => {
  const now = fakeClock();
  const c = new TinyCache({ now });
  c.set("a", 1, { ttlMs: 100 });
  c.set("a", 2);
  now.advance(10_000);
  assert.equal(c.get("a"), 2);
});

test("expired entries do not count toward capacity", () => {
  const now = fakeClock();
  const c = new TinyCache({ maxEntries: 2, now });
  c.set("a", 1, { ttlMs: 50 });
  c.set("b", 2);
  now.advance(100);
  c.set("c", 3);
  assert.equal(c.get("b"), 2, "live entry survives — the expired one made room");
  assert.equal(c.get("c"), 3);
});
