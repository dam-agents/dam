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

`index-heavy` p50 ≈ 22 µs is the guard. One bench invocation is seconds —
even a full five-arm bundle's grid (arms × 3 seeds × 3 reps × 3 n values,
baseline and treatment) is minutes of measuring; the hour goes to the
worker's reasoning.

The bench prints a **`checksum`** per seed: same seed and same semantics always
produce the same value, so a rewrite that quietly changes ranking or AND
semantics is caught even where the tests are not looking. Treat a changed
checksum exactly like a failed test — the round scores nothing.

## The campaign, pinned

Pin what is yours; leave the arms to Nous. The bundle — h-main, ablations,
control-negative, robustness, a dose-response when the question is a curve —
is the tool's own methodology and the reason its verdict is defensible;
dictating its composition turns Nous into an expensive single-patch
benchmarker and can set the designer against its own methodology prompts.
The measured ~60 min iteration already *includes* the full standard bundle,
so time comes from the knobs the schema owns, not from redefining the
science. Pin with the four fields (see *You do not write the campaign's
arms* in the skill):

- **`research_question`** — "does query latency become independent of corpus
  size, and what does the write path pay for it?" Stated as a curve, the
  designer reaches for a dose-response arm on its own — let it.
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
  guard bound. These are measurement constants — legitimately yours — and
  they hard-fail if the bundle deviates, which is what makes them a spec
  rather than a request.

**The time levers**: `max_iterations: 1` (the confirming iteration; no
rehearsal), `max_turns: {design: 40, execute_analyze: 80}` to bound the
meandering, and a TTL of 2 h over the measured hour. Baselines, the exact
bench invocations and the checksum rule go in `target_system.description` —
substituted verbatim into the model's prompts.

**The bar is set where it can fail.** An inverted index should clear 20×
comfortably at n=5000; what is genuinely in doubt is the guard (does the write
path stay within 3×?) and the flatness claim at n=20000. That is the result
worth reporting, and either half can come back refuted.

## What the run puts on screen

Three score series, a verify stage, and a verdict card — with stage ids named
for the legend, because the legend is all a viewer sees (`seed-score`,
`arm-score` and `verdict` are the exact ids that sent a user asking what
their own chart meant):

- **`speedup-per-seed`** — one span per seed at n=5000 (3 points): the
  spread, so a reader sees whether one seed carries the median. Absolutes
  (`baseline_us`, `treatment_us`, `meets_bar`) ride in the attrs.
- **`speedup-vs-n`** — one span per n value (3 points, `iteration=n`): the
  curve, which is the demo's whole argument.
- **`arm-decomposition`** — one span per arm of the bundle Nous designed,
  `iteration=` set per arm (an unset iteration once made five arms look like
  one). Score `log2(effect)` so the control at ~1× and the main effect share
  an axis — but only for a valid effect: garbage gets **no score** plus an
  `invalid` attr, never a 0.0 that reads as "no change".
- **`verify`** — the replication stage, and the reason the numbers above can
  be trusted: the driver applies the worker's published `cumulative.patch` to
  its own pristine copy, runs the 13 tests and the seeded bench itself, and
  scores the primary series from its **own** measurements. The worker's
  figures become a cross-check column, and tests/checksums/ruler-lock stop
  being self-graded. tiny-search is plain Node — there is no excuse not to.
- **Verdict = a `post_data` card, not a series.** PASS/FAIL plus every named
  check (median ≥ 20×, ≥ 2/3 seeds, 13/13 tests, per-seed checksums
  unchanged, guard ≤ 3×, `h_main_status == CONFIRMED`, `result_valid`) with
  each outcome — the stock dashboard renders it. A previous run scored the
  verdict stage with the median speedup: a redundant line hiding the actual
  answer in attrs.
- **`post_data` also carries** the evidence table with absolute µs next to
  every ratio, per-phase durations, the Nous `run_id`, and cost (USD, tokens,
  LLM calls — `llm_metrics_summary.json` exists even on failed campaigns).

## Trust nothing the schema didn't define, score nothing you didn't validate

The result schema demands `per_seed`, `per_n`, `per_arm`, `checksums_per_seed`
(a list — the bar is per-seed, a blanket boolean can't answer it),
`ruler_unmodified`, `h_main_status`, `run_id`, and `cost` — and the prompt
**defines every number**: effect is "that arm's OWN baseline p50 ÷ that arm's
OWN treatment p50, query-heavy at n=5000, same seeds and reps; a no-op
control must come out ~1.0 — never 0, never blank, never copied from another
arm". An undefined `effect: "number"` is how a real run got `-1.056` on all
five arms — a guess that passed anyway because nothing validated it.

Before any span is scored, the driver runs a validation gate and records what
it finds (in `post_data`, not a raised exception — bad evidence belongs on
the page), with `result_valid` gating the verdict:

- per_seed covers exactly seeds {1, 2, 3}; per_n exactly {1000, 5000, 20000};
  all timings positive;
- arm effects are **distinct** — different code cannot agree to six decimals;
- **sign agreement** — an h-main effect claiming "slower" beside per-n data
  showing 4706× faster is irreconcilable and fails the result;
- plausibility — a median past 1000× passes only corroborated (checksums
  unchanged AND ruler untouched AND the driver's own verify measurements
  agree), because that magnitude is where broken benchmarks live;
- the worker's baselines within ~5× of the driver's own (measured at setup:
  ~2.45 / 12.97 / 56.2 ms) — further off means different-enough hardware or
  harness that the ratio isn't comparable.

## Size and shape

One round, **one iteration with Nous's standard bundle**, 3 seeds at 3 reps —
proposed as **~1 h, TTL 2 h**. The calibration is measured, not hoped: a
healthy full-bundle iteration took ~60 min on a dev cluster, and a 150-min
TTL sized for "25 min per iteration" has already executed a 2-iteration run
of this very starter mid-campaign. If the human wants more — a rehearsal
iteration, ten seeds — each is an explicit upgrade with its cost stated
(~+60 min per extra iteration), never a silent default. And pin
publish-as-you-go in the prompt: findings published the moment they exist,
so a deadline kill loses minutes, not the campaign.

Present the envelope as usual before authoring, and say what the demo shows:
the platform drawing a live loop while a worker forms a hypothesis, patches a
repo, measures a speedup curve against a bar it pre-registered, and reports
whether the mechanism claim held — decomposed by the arms Nous designed, with
a guard metric and a control that could each genuinely fail.

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
