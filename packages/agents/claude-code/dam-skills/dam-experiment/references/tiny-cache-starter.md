# The tiny-cache starter

This reference is background **for you** — never recite it. When offering the
starter, two or three plain sentences and a question beat any paragraph in
this file; the anti-cheat story is one sentence to the user ("the tests and
benchmark are locked — a round that edits them scores nothing"), and its
mechanics belong in the driver script, not the chat.

The bundled example for a user with no optimization target of their own: a
dependency-free in-memory TTL cache for Node whose implementation is
**deliberately naive** — `get()` scans an array, every call rebuilds it to
purge expired entries, `set()` re-sorts all keys — so a loop has real headroom
(~100×, not 5%) against a behavioral suite that must stay green. The slowness
is the exercise; never offer to fix it outside an experiment.

## It ships inside this skill

The starter's code lives in the `examples/tiny-cache/` directory **beside this
reference file** (under the skill's own directory). It is already on this pod
— never clone or download anything to obtain it. That copy is read-only
skill material and stays pristine; the working copy is made on opt-in.

## Showing ≠ setting up ≠ running

Match the action to what the user actually asked:

- **"Show me" / "what is it?"** — describe it. This reference plus the skill
  copy's files is everything a description needs; read them, quote them, and
  do not execute anything — nobody asked to run code yet.
- **"Set it up" / "let's use it"** — copy the skill copy into the workspace,
  then say you are about to run its test suite and benchmark to measure the
  baseline, and do so. The user hears it from you before anything executes.

```sh
cp -r "$(dirname <this reference>)/../examples/tiny-cache" examples/tiny-cache
```

(One local `cp` from the skill directory you read this file in — resolve the
real path from there.)

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
  `test/` must be provably untouched and `bench/bench.mjs` is off-limits, or
  the cheapest path to a good score is editing the ruler. The skill's own
  copy is the pristine reference — have the driver diff the working copy's
  `test/` and `bench/` against it every round.
- **A known, large effect** — a `Map` plus lazy purge collapses `get()` to
  O(1), so the loop's job is to *prove* the win under a pass condition, not
  to discover it. Say that to the user; it shapes how small the design can be.

## The loop — with the worker the user picks

The loop shape is the same whichever harness does the rewriting: each round
spawns a worker whose prompt carries the current `src/tiny-cache.js` and asks
for a faster rewrite under the locked semantics; the driver writes the
candidate back, runs `node --test` (broken tests score nothing) and the bench
across fixed seeds, and scores median speedup against the measured baseline.
Everything stays local to the driver — the worker only ever transforms the
source it is handed.

**The worker is the user's choice, always.** Any supported general coding
agent can play the round (see the skill's
[images reference](images.md)); present the options and ask, don't pre-pick.
`claude-code` is the natural suggestion to lead with only because it needs no
credential this sandbox does not already hold — the others need their
provider's connection granted first, and you should check for the grant
before offering them as ready to use. This is an example project: its point
is to show the loop, so running it on whichever harness the user wants to
watch is a legitimate reason all by itself.

As with any run, present the expected duration and the rest of the approval
envelope before authoring — a handful of rounds at a few minutes per spawn is
typically well under an hour, but say the number you actually derived.
