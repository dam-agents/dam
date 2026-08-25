# tiny-search

A minimal in-memory full-text search index for Node.js. No dependencies.

It is **deliberately naive** — `search()` re-tokenizes every document from
raw text on every query and scans the full token list once per query term;
there is no index of any kind — so an optimization campaign has real,
measurable headroom (~50–70×, not 5%) against a behavioral suite that must
stay green. Do not "fix" the naive implementation in place — the slowness is
the exercise.

- **AND semantics** — a document matches only if it contains every query term
- **occurrence scoring** — score = total occurrences of all query terms
- **deterministic ordering** — score descending, ties by id ascending
- **replace on re-add**, `remove()`, result `limit` (default 10)

## Usage

```js
import { TinySearch } from "./src/tiny-search.js";

const index = new TinySearch();
index.add("alpha", "Rust is fast. Rust is safe.");
index.add("bravo", "Go is simple and fast");
index.search("fast");        // [{ id: "alpha", score: 1 }, { id: "bravo", score: 1 }]
index.search("rust fast");   // [{ id: "alpha", score: 3 }]
```

## Tests

Behavioral test suite (node:test, no install needed) — 13 tests pinning the
tokenizer, AND semantics, occurrence scoring, ordering, tie-breaks, limits,
replace-on-re-add, and removal:

```sh
npm test          # or: node --test
```

## Benchmark

Deterministic per seed; prints one JSON line with per-op latency percentiles
and a **result checksum** — same seed and same semantics always produce the
same checksum, so a rewrite that changes behavior is caught even when the
tests are not looking:

```sh
node bench/bench.mjs --scenario query-heavy --n 5000  --ops 400  --seed 1
node bench/bench.mjs --scenario index-heavy --n 5000  --ops 2000 --seed 1
node bench/bench.mjs --scenario mixed       --n 5000  --ops 400  --seed 1
```

Output fields: `p50_us`, `p95_us`, `mean_us` (per-operation latency in
microseconds), `ops_per_sec`, `build_ms` (initial corpus load), `checksum`.
Term frequencies are Zipf-ish (early vocabulary words are common, late ones
rare), and the checksum folds every query's result ids and scores — a rewrite
that changes search semantics changes the checksum even if it gets faster.

Reference baseline (Node 24, Apple Silicon): query-heavy p50 ≈ 12 ms at
`--n 5000`, ≈ 49 ms at `--n 20000` — latency grows linearly with the corpus.
`index-heavy` p50 ≈ 23 µs.

## Running it as an optimization campaign

The repo is shaped for unattended, hypothesis-driven optimization:

- **Single process, low memory.** The benchmark starts no daemons and peaks
  well under 100 MB — nothing to OOM, nothing to contend with. Run
  measurement arms serially anyway; concurrent instances pollute latency.
- **Fast measurements.** One bench invocation is seconds, so an iteration of
  arms × seeds fits comfortably inside an hour.
- **No network, no installs.** Zero dependencies; `node --test` and the bench
  run offline.
- **A guard metric.** Any indexing strategy pays its cost on the write path —
  bound the regression on `index-heavy` instead of pretending it is free.
- **Anti-cheat.** `test/` and `bench/` are the ruler: a candidate that edits
  them scores nothing, and the per-seed `checksum` must not change.

Suggested pre-registration:

- **Primary metric:** `speedup_p50` on `query-heavy` at `--n 5000`
  (baseline p50 ÷ candidate p50), higher is better.
- **Pass condition:** median speedup ≥ 20 across 5 seeds, ≥ 4/5 seeds
  individually ≥ 20, all 13 tests green, per-seed `checksum` unchanged, and
  `index-heavy` p50 regression ≤ 3×.
- **Dose-response:** the effect should grow with `--n` (try 1000 / 5000 /
  20000) — a mechanism claim about scan cost predicts that; a fixed-overhead
  fix does not.
