# The tiny-search starter — the cheap Nous demo

This reference is background **for you** — never recite it. Two or three plain
sentences and a question beat any paragraph in this file.

The bundled target for showing what a *hypothesis-driven campaign* does, on a
budget: a dependency-free in-memory full-text search index whose `search()`
re-tokenizes every document from raw text on every query and scans the token
list once per term. There is no index of any kind, so the headroom is real
(~50–70×) and the mechanism is a textbook one an inverted index fixes.

It ships beside this reference at
[examples/tiny-search/](../examples/tiny-search/) and is already on this pod —
never clone or download it to *read* it.

## Why this one and not tiny-cache

[tiny-cache](tiny-cache-starter.md) is the starter for a **`claude-code` loop**,
where your driver runs the locked benchmark and scores each sweep point itself.
Handing it to `nous` fits worse for two reasons that have nothing to do with
integrity (the image copy is a pristine ruler on either worker — see the last
section): its optimized side lands at ~0.3 µs, the resolution floor of the
bench's per-op `hrtime` sampling, so the headline ratio measures the clock; and
the win is known in advance, with no guard metric that could fail.

tiny-search does not have that problem, and that is the whole reason it exists:

| | tiny-cache | tiny-search |
|---|---|---|
| Baseline metric | ~175 µs p50 | **~12.4 ms p50** (n=5000) |
| Optimized side | ~0.3 µs — at the timer floor | ~0.2 ms — ~1000× above it |
| Guard metric | none (`write-heavy` only) | **`index-heavy`**, ~22 µs |
| Behavior check | 11 tests | 13 tests **plus a result checksum** |
| Answer | known 500× win | a curve, with a real write-path cost |

The guard metric is what makes it a campaign rather than a stunt: any indexing
strategy moves work to the write path, so the interesting question is not "is
it faster" but "how much does the write path pay, and does the win scale".

## Measured on this pod (verify, don't trust)

13/13 tests green, and the baseline is yours to measure before designing
anything:

```sh
cd examples/tiny-search && node --test
node bench/bench.mjs --scenario query-heavy --n 5000 --ops 400 --seed 1
node bench/bench.mjs --scenario index-heavy --n 5000 --ops 2000 --seed 1
```

Reference numbers from a dev-cluster-class machine — the linearity is the
point, and it is what a mechanism claim predicts:

| n | query-heavy p50 | vs n=1000 |
|---|---|---|
| 1 000 | 2.45 ms | 1.0× |
| 5 000 | 12.97 ms | 5.3× |
| 20 000 | 56.2 ms | 23× |

`index-heavy` p50 ≈ 22 µs is the guard. One bench invocation is seconds, so
arms × seeds × the n grid still fits inside the hour.

The bench prints a **`checksum`** per seed: same seed and same semantics always
produce the same value, so a rewrite that quietly changes ranking or AND
semantics is caught even where the tests are not looking. Treat a changed
checksum exactly like a failed test — the round scores nothing.

## The campaign, pinned

Don't hand the worker a paragraph and hope. Pin the design with the four
fields (see *You do not write the campaign's arms* in the skill), so the
campaign commits to the curve and the guard before it runs:

- **`research_question`** — "does query latency become independent of corpus
  size, and what does the write path pay for it?" Stated as a curve, the
  designer reaches for a dose-response arm by itself.
- **`controllable_knobs`** — `[index_strategy, n]`. The sweep variable must be
  here or it may never be swept.
- **`ground_truth`** — `primary_metric: "speedup_p50(query-heavy, n=5000)"`,
  `direction_claim: "baseline p50 grows ~linearly in n while the candidate
  stays roughly flat, so speedup grows with n"`, `seeds: [1, 2, 3]`,
  `pass_condition: "median speedup_p50 ≥ 20 AND ≥ 2/3 seeds individually ≥ 20
  AND 13/13 tests green AND per-seed checksum unchanged AND index-heavy
  p50 regression ≤ 3×"`.
- **`locked_parameters`** — `n_values: [1000, 5000, 20000]`,
  `reps_per_seed: 3`, `ops_query_heavy: 400`, `ops_index_heavy: 2000`, and the
  guard bound. These hard-fail if the bundle deviates, which is what makes
  them a spec rather than a request.

Put the baselines, the exact bench invocations and the checksum rule in
`target_system.description` — it is substituted into the model's prompts
verbatim.

**The bar is set where it can fail.** An inverted index should clear 20×
comfortably at n=5000; what is genuinely in doubt is the guard (does the write
path stay within 3×?) and the flatness claim at n=20000. That is the result
worth reporting, and either half can come back refuted.

## Size and shape

One round, 1–2 campaign iterations (rehearsal + one confirming pass), 3 seeds
at 3 reps — the standard hour. Measurement is cheap here, so the hour goes to
the campaign's own reasoning, not to benchmarking; if the estimate slips, cut
an iteration before you cut the n grid, because the grid is the finding.

Present the envelope as usual before authoring, and say what the demo shows:
the platform drawing a live loop while a worker forms a hypothesis, patches a
repo, measures it against a bar it pre-registered, and reports whether the
mechanism claim held — decomposed by arm, with a guard metric it could fail.

## Getting the repo onto the worker — it is already there

No clone, no download, no GitHub. The `nous` image is built `FROM` the
claude-code image, which stages this skill at `/usr/local/share/dam-skills/`,
so a spawned nous worker already carries the starter at:

```
/usr/local/share/dam-skills/dam-experiment/examples/tiny-search/
```

Nous needs a git repo with at least one commit (it runs each arm in an isolated
worktree), so the campaign prompt opens with three lines of setup:

```sh
cp -R /usr/local/share/dam-skills/dam-experiment/examples/tiny-search ~/tiny-search
cd ~/tiny-search && git init -q && git add -A
git -c user.email=nous@local -c user.name=nous commit -qm "baseline: naive tiny-search"
```

Then `repo_path: ~/tiny-search`. Two things this buys beyond convenience:

- **No egress at all.** No GitHub connection, no public repo, nothing to
  publish — the model provider is the only connection the worker needs. It
  works on any cluster, offline.
- **A pristine ruler inside the worker.** The image copy is read-only and
  untouched, so the campaign can verify its own integrity against it —
  `git diff --no-index --quiet` on `test/` and `bench/` against
  `/usr/local/share/dam-skills/dam-experiment/examples/tiny-search/` catches a
  candidate that edited the tests or the benchmark. Put that check in the
  prompt: a candidate that changed the ruler scores nothing, exactly as in a
  driver-run loop.

**One deployment caveat.** The examples ride in the image, so a worker only has
what its image was built with. A nous image built before tiny-search landed in
this skill will not have the directory — check for it in the prompt and fail
loudly rather than improvising a download. Rebuilding is
`mise run cluster:build-agent` on a dev cluster.
