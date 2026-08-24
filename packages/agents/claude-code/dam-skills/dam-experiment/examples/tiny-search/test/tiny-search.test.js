import test from "node:test";
import assert from "node:assert/strict";
import { TinySearch, tokenize } from "../src/tiny-search.js";

function fixture() {
  const index = new TinySearch();
  index.add("alpha", "Rust is fast. Rust is safe.");
  index.add("bravo", "Go is simple and fast");
  index.add("charlie", "JavaScript everywhere: fast, flexible, fast!");
  index.add("delta", "Plain text about gardening");
  return index;
}

test("tokenize lowercases and splits on non-alphanumeric runs", () => {
  assert.deepEqual(tokenize("Re-index THE re-index, twice!"), [
    "re",
    "index",
    "the",
    "re",
    "index",
    "twice",
  ]);
  assert.deepEqual(tokenize("v2 rollout (2024)"), ["v2", "rollout", "2024"]);
  assert.deepEqual(tokenize("!!! --- ..."), []);
});

test("empty index returns no results", () => {
  const index = new TinySearch();
  assert.deepEqual(index.search("anything"), []);
});

test("single-term search scores by occurrence count", () => {
  const index = fixture();
  assert.deepEqual(index.search("rust"), [{ id: "alpha", score: 2 }]);
});

test("matching is case-insensitive", () => {
  const index = fixture();
  assert.deepEqual(index.search("RUST"), [{ id: "alpha", score: 2 }]);
});

test("results order by score descending, ties by id ascending", () => {
  const index = fixture();
  assert.deepEqual(index.search("fast"), [
    { id: "charlie", score: 2 },
    { id: "alpha", score: 1 },
    { id: "bravo", score: 1 },
  ]);
});

test("multi-term search uses AND semantics", () => {
  const index = fixture();
  assert.deepEqual(index.search("rust fast"), [{ id: "alpha", score: 3 }]);
  assert.deepEqual(index.search("rust gardening"), []);
});

test("score sums occurrences across all query terms", () => {
  const index = new TinySearch();
  index.add("x", "re-index the re-index");
  assert.deepEqual(index.search("re index"), [{ id: "x", score: 4 }]);
});

test("query with no alphanumeric tokens returns no results", () => {
  const index = fixture();
  assert.deepEqual(index.search("!!!"), []);
  assert.deepEqual(index.search(""), []);
});

test("unknown term returns no results", () => {
  const index = fixture();
  assert.deepEqual(index.search("zeppelin"), []);
});

test("limit caps results and defaults to 10", () => {
  const index = new TinySearch();
  for (let i = 0; i < 15; i += 1) {
    index.add(`doc${String(i).padStart(2, "0")}`, "common word");
  }
  assert.equal(index.search("common").length, 10);
  assert.equal(index.search("common", { limit: 3 }).length, 3);
  assert.equal(index.search("common", { limit: 100 }).length, 15);
});

test("re-adding an id replaces the old document", () => {
  const index = new TinySearch();
  index.add("a", "cat");
  index.add("a", "dog");
  assert.equal(index.size, 1);
  assert.deepEqual(index.search("cat"), []);
  assert.deepEqual(index.search("dog"), [{ id: "a", score: 1 }]);
});

test("remove deletes the document and reports whether it existed", () => {
  const index = fixture();
  assert.equal(index.remove("alpha"), true);
  assert.equal(index.remove("alpha"), false);
  assert.deepEqual(index.search("rust"), []);
  assert.equal(index.size, 3);
});

test("add validates its arguments", () => {
  const index = new TinySearch();
  assert.throws(() => index.add("", "text"), TypeError);
  assert.throws(() => index.add(42, "text"), TypeError);
  assert.throws(() => index.add("id", 42), TypeError);
});
