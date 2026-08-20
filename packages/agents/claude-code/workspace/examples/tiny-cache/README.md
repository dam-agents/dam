# tiny-cache

A minimal in-memory key/value cache for Node.js. No dependencies.

**This is DAM's bundled experiment starter**, seeded into every sandbox
workspace at creation. It is deliberately naive — `get()` scans an array,
every call rebuilds it to purge expired entries, and `set()` re-sorts all
keys — so an optimization loop has real, measurable headroom against a
behavioral suite that must stay green. Do not "fix" the naive implementation
in place — the slowness is the exercise. A clonable mirror lives at
<https://github.com/Tomas2D/tiny-cache> for workers (e.g. a Nous campaign)
that fetch their target themselves.

- optional per-entry **TTL** — expired entries are never returned
- bounded capacity with **FIFO eviction** (oldest insertion goes first)
- `keys()` returns keys in **sorted order**
- injectable clock for deterministic tests

## Usage

```js
import { TinyCache } from "./src/tiny-cache.js";

const cache = new TinyCache({ maxEntries: 10_000 });
cache.set("session:42", { user: "ada" }, { ttlMs: 60_000 });
cache.get("session:42"); // { user: "ada" }
cache.keys();            // ["session:42"]
```

## Tests

Behavioral test suite (node:test, no install needed):

```sh
npm test          # or: node --test
```

## Benchmark

Deterministic per seed; prints one JSON line with per-op latency percentiles:

```sh
node bench/bench.mjs --scenario read-heavy  --n 20000 --ops 5000 --seed 1
node bench/bench.mjs --scenario write-heavy --n 20000 --ops 5000 --seed 1
node bench/bench.mjs --scenario mixed       --n 20000 --ops 5000 --seed 1
```

Output fields: `p50_us`, `p95_us`, `mean_us` (per-operation latency in
microseconds), `ops_per_sec`.
