# The tiny-cache starter

The bundled example for a user with no optimization target of their own: a
dependency-free in-memory TTL cache for Node whose implementation is
**deliberately naive** — `get()` scans an array, every call rebuilds it to
purge expired entries, `set()` re-sorts all keys — so a loop has real headroom
(~100×, not 5%) against a behavioral suite that must stay green. The slowness
is the exercise; never offer to fix it outside an experiment.

Canonical repo: `https://github.com/Tomas2D/tiny-cache`

## Showing ≠ setting up ≠ running

Match the action to what the user actually asked:

- **"Show me" / "what is it?"** — describe it. This reference plus the files
  (onboarding fetches a copy to `examples/tiny-cache/` at sandbox creation;
  read them from disk if present) is everything a description needs. Do not
  clone, and above all do not execute anything — nobody asked to run code yet.
- **"Set it up" / "let's use it"** — make sure the copy exists (below), then
  say you are about to run its test suite and benchmark to measure the
  baseline, and do so. Running it is part of setup, but the user hears it
  from you first — the harness's permission layer may legitimately ask about
  executing freshly fetched code, and that prompt should never be the user's
  first hint that you started running things.

## Getting it into the workspace

Onboarding fetches the copy when the sandbox is created, so it is usually
already at `examples/tiny-cache/`. If it is missing (onboarding was skipped,
or the fetch failed), clone it and **remove `.git`** — the local copy is
working material, not a repository, and stripping it prevents accidental git
work (commits, pushes, PR offers) against it:

```sh
git clone --depth 1 https://github.com/Tomas2D/tiny-cache examples/tiny-cache \
  && rm -rf examples/tiny-cache/.git
```

## Measuring the baseline (setup time, not show time)

Once the user has opted in, verify on this pod before designing anything —
the suite must be green and the baseline is yours to measure, not to assume:

```sh
cd examples/tiny-cache && node --test          # 11 tests, all green
node bench/bench.mjs --scenario read-heavy --n 20000 --ops 5000 --seed 1
```

The bench is deterministic per seed and prints one JSON line (`p50_us`,
`p95_us`, `mean_us`, `ops_per_sec`). Expect a read-heavy p50 in the low
hundreds of µs at `--n 20000`. Bake your measured numbers into the run so
every score has its denominator.

## The exercise

Optimize `get()` latency on the read-heavy scenario. What makes it a good
first experiment:

- **Self-scoring** — the bench is the scorer; no dataset or judge to author.
- **Cheat-resistant, if you lock it** — the behavioral suite pins FIFO
  eviction, sorted `keys()`, the injectable clock, and TTL semantics, so a
  rewrite that drops semantics fails loudly. Lock the rest yourself:
  `test/` must be provably untouched (empty `git diff` is unavailable without
  `.git` — compare against a pristine copy or checksums you take up front)
  and `bench/bench.mjs` is off-limits, or the cheapest path to a good score
  is editing the ruler.
- **A known, large effect** — a `Map` plus lazy purge collapses `get()` to
  O(1), so the loop's job is to *prove* the win under a pass condition, not
  to discover it. Say that to the user; it shapes how small the design can be.

## Two tiers

**`claude-code` loop (the default starter).** Fully local, no credentials
beyond the sandbox's own: each round spawns a `claude-code` worker whose
prompt carries the current `src/tiny-cache.js` and asks for a rewrite; the
driver writes the candidate back, runs `node --test` (broken tests score
nothing) and the bench across fixed seeds, and scores median speedup vs the
measured baseline. This is the zero-configuration path — offer it first.

**`nous` campaign (when the user wants the full machinery).** Nous clones its
target itself, so this tier uses the canonical repo URL as the campaign
target and needs the GitHub connection granted. Interview per the skill's
Nous section, then a brief in this shape (fill every bracket from the
interview — these are the settled parameters, not suggestions):

```
I want to optimize https://github.com/Tomas2D/tiny-cache — a small
dependency-free in-memory TTL cache for Node. get() latency grows with the
entry count; at ~20k entries reads are slow.
Benchmark: node bench/bench.mjs --scenario read-heavy --n 20000 --ops 5000
--seed <s> (prints JSON: p50_us, p95_us, ops_per_sec).
Behavioral suite: node --test (must stay green).
Constraints: [time box / smallest defensible design].
Metric: speedup_p50 on read-heavy.
Pass: median >= [X] across [seeds], at least [k/n] individually, no test
changes, write-heavy p50 must not regress more than [Y]%.
```

Present the expected duration before asking approval (a 2-iteration,
3-seed smoke campaign is roughly 1.5–2.5 h) — it is the deciding factor.
