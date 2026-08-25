---
name: dam-experiment
description: Use for any request to create, plan, set up, or run an experiment, compare models/prompts/approaches, test ideas and compare results, or build a benchmark sweep, optimization loop, or iterate-and-score campaign. Every experiment in this sandbox is a platform Experiment — a Python loop script (produce/eval/select, genetic algorithms) the platform observes live with a graph, per-stage progress, and score charts. Provides the python experiment_sdk (Experiment/stage/span + spawn) and the plan → "Start a new run" workflow.
allowed-tools: Bash(python3 *), Write
---

# DAM experiment

An **Experiment** is one execution of a Python loop script you author. The
platform never runs your loop — it *observes* it: you declare the loop's
**skeleton** (stages and loops) upfront, and as the script runs, every stage
execution reports a **span** (status, an optional numeric score, artifact
references). The user watches the graph fill in live.

## The SDK

A stdlib-only python module is importable in every pod (no install):

```python
import experiment_sdk as x
```

It self-configures from the pod environment. It also carries the full driver
surface — `x.spawn(...)`, `x.list_images()`, `x.require_image(...)`,
`x.list_connections()`, `x.budget()`, and the `x.s(...)` schema shorthand —
so one script both drives and reports.

## Talking to the user

The design conversation is with someone who wants a result, not a systems
briefing. Throughout — greeting, starter offer, envelope, run reports:

- **Short paragraphs, and structure over prose**: options go in bulleted
  lists, the approval envelope in a short list or table of decisions, numbers
  in tables. If a reply can be scanned instead of read, make it so.
- **State guarantees, not mechanisms.** Say "the tests and benchmark are
  locked — a round that edits them scores nothing", not how the driver diffs
  against a pristine copy. Internal machinery (integrity checks, SDK
  surfaces, file layouts) stays out of the conversation unless the user asks.
- **One decision per question.** Don't bundle "want it set up?" with worker
  choice and stage design in a single closing paragraph — sequence them.
- Plain words over platform vocabulary wherever the user hasn't used the
  term first.

## Frequent questions

The chat shows these as one-click chips on a fresh session, so answer them
well — scannable, per Talking to the user above, ending on what the user can
do next:

- **"Show me an example to optimize"** → the two bundled starters, one line
  each: **tiny-cache** (a slow cache, rewritten by a coding agent each round —
  minutes) and **tiny-search** (a slow search index optimized by a `nous`
  campaign against a pre-registered bar and a write-path guard — about an
  hour). Describe, ask which, and offer to set it up. Show, don't run; the
  references are
  [tiny-cache](references/tiny-cache-starter.md) and
  [tiny-search](references/tiny-search-starter.md).
- **"How do experiments work?"** → the loop in plain words: you describe a
  goal, we agree the design, I write it as a Python loop; each round proposes
  a candidate, builds it, measures it, and reports a score; the platform
  draws the loop live (stages, progress, score chart) but never runs or
  judges it. You review a draft plan and press "Start a new run" — nothing
  runs before that.
- **"How is a run scored?"** → the score is a number the loop itself reports
  each round — the platform charts it, never interprets it. What makes a
  score honest: it is measured (a benchmark, a test count, an evaluator),
  compared against a baseline measured up front, and guarded so it cannot be
  gamed (broken tests score nothing; the things being measured are locked).
  The pass condition — what counts as success — is agreed before the run, and
  set where a candidate could genuinely fail it: a bar nothing can miss tells
  you nothing.
- **"What types of experiments can I run?"** → anything a script can measure.
  Offer the common shapes as a short list: optimize code against a benchmark,
  evolve a prompt or any text against a scorer, sweep configurations or
  hyperparameters, benchmark several approaches on one task, or run a
  hypothesis-driven campaign against a repo with a pre-registered pass bar.
- **"Which agents can run the rounds?"** → the supported workers from
  [references/images.md](references/images.md), as a one-line-each list, with
  the credential note per worker. The choice is always the user's.

## Choose the worker image FIRST

The worker image decides what the experiment can actually do — it is the
loop's most consequential choice, so make it before writing any loop, and
make it *with* the human. Read the catalog and show it to them:

```sh
python3 -c 'import experiment_sdk as x; [print(i["id"], "-", i.get("description") or i["name"]) for i in x.list_images()]'
```

Then read [references/images.md](references/images.md): the catalogue gives one
line per image, which is not enough to choose between them. It says which images
are supported as experiment workers, what each one is for, and what credentials
each needs. Present only the supported ones, and ask which the worker should be.

**`claude-code` is the default** — it needs no credential the sandbox does not
already hold. Two reasons to choose otherwise: the human wants a specific
provider's agent in the loop (`codex`, `pi-agent`, `bob` — each needs its own
credential granted first), or the goal matches a purpose-built worker, where
doing the loop on `claude-code` would mean reimplementing the tool inside the
worker. `nous` is the one purpose-built worker supported today: it runs
hypothesis-driven campaigns (plan → build & test → analyze → learn against a
target repo) and already ships the `nous` CLI, its skill, and a gateway-wired
model path. The catalogue lists other optimizers; they are **not supported as
workers yet** — images.md says so per image, and offering one is a dead end for
the human.

**Never install a framework inside a worker.** No `pip install`, no cloning,
no building a tool the iteration needs. If a curated image exists for it,
spawn that image; targets have no unrestricted egress, so the install
usually fails outright and burns the iteration when it doesn't. If nothing in
the catalog fits, say so to the human instead of improvising an install.

When the human names a worker in their own words ("the OpenAI one", "the
evolutionary one"), map it onto a catalog id and say which id you mapped it to
— never spawn on a guessed name. If nothing in the catalog matches what the
goal needs, say that plainly instead of substituting the closest thing.

Pin the choice through `x.require_image(...)` in the declaration section, so a
wrong id fails at `--plan` while the human is reviewing the design rather
than at a run's first spawn hours later.

### Get the configuration approved before you author

The image is the first of several choices that are expensive to get wrong: a
run spends real compute for hours, and a wrong worker or a missing credential
surfaces as an empty result late, not as an error at review. So propose the
whole envelope and get an explicit yes before writing the script:

- **The image**, by catalog id, with why that one over `claude-code`.
- **The connections** each worker gets, from `x.list_connections()` — targets
  start with nothing, and the model-provider connection is usually required. If
  the image needs a provider grant this sandbox does not hold, say so here
  rather than at the first failed spawn.
- **Iteration counts**: your loop's rounds, plus any the worker runs
  internally. Total runtime multiplies through them.
- **Expected duration, stated in human terms.** "~1 h per campaign
  iteration, one confirming iteration, one round — about 1 h with queue
  slack" is a deciding factor, not a footnote: the human may cut seeds or
  rounds to fit the time they have, so give them the per-unit cost that
  makes that trade legible. The `ttl_ms` you set is derived from this number — never the other
  way around — and it is a **kill deadline, not pacing**: the platform reaps
  the target the moment it lapses, even mid-work. Size it at the worst
  plausible round plus generous slack (cold start alone is minutes; double
  your estimate, at minimum). Wanting a faster run means fewer rounds and
  tighter prompts, never a tighter TTL — a killed working pod wastes the
  whole round.
- **How long the run will look frozen.** A stage that wraps one long spawn
  reports nothing until the spawn returns: no score points, no progress, one
  node sitting at *running* for as long as the worker takes. That is normal
  and it is also indistinguishable from a hang, so say the number out loud
  before the run — "the campaign stage will show no progress for roughly two
  hours, then everything lands at once" — and name what the human can check
  in the meantime (the run stays live; its last-activity clock keeps moving).
  A human who was not told this reasonably concludes the run is dead.
- **The resource envelope** the worker runs in, when the workload is heavy
  enough for it to matter (see the Nous section's locked envelope).
- **Concurrency, from the budget.** Read `x.budget()` and the chosen worker's
  `size` from the catalog, and do the arithmetic before the human approves:
  `(ceiling − reserved) ÷ worker size`, floored over CPU and memory, is how
  many workers run *at once* — this driver's own size is part of `reserved`.
  Say the number plainly ("your budget runs 2 of these workers in parallel").
  Spawns beyond it are not errors: they queue and start as room frees, so a
  wider fan-out runs slower, not dead — but the wait burns each invocation's
  TTL, so either bound the loop's parallelism to the number or stretch
  `ttl_ms` to cover the queue time. A single worker sized past the ceiling
  is refused at `spawn` — resize it or have the human raise the budget
  before the run, never mid-loop.

Present it as a short list of decisions, not prose, and let them change any
line. Silence is not approval: if they have not answered, ask again rather
than picking a default and proceeding.

## No target? Two bundled starters

A user who wants to see how experiments work but has nothing of their own to
optimize gets one of two deliberately-slow Node packages shipped inside this
skill. Both are dependency-free, single-process, and measurable in seconds;
they differ in which worker they are shaped for, so pick by what the user
wants to see:

| Starter | Worker | Shows |
|---|---|---|
| [tiny-cache](references/tiny-cache-starter.md) ([code](examples/tiny-cache/)) | `claude-code` loop | your driver owning the ruler: it runs the locked bench, sweeps n, and scores each point |
| [tiny-search](references/tiny-search-starter.md) ([code](examples/tiny-search/)) | `nous` campaign | a worker forming a hypothesis, pre-registering a bar, and reporting whether the mechanism held — with a guard metric it can fail |

Follow the reference for whichever they choose; each carries its baseline
ritual, its scoring design, and the size that fits the hour. **Don't cross
them over.** tiny-cache on `nous` loses the pristine ruler and lands its
optimized side on the timer floor; tiny-search in a hand-driven loop throws
away the campaign machinery that is the only reason to look at it.

## Authoring a script

Declare first, then loop. The declaration is the design a human reviews:

```python
import experiment_sdk as x

with x.Experiment("prompt-evolver") as exp:
    loop = exp.loop("generations", description="one candidate prompt per pass")
    produce = loop.stage("produce", description="a worker proposes a new prompt")
    evaluate = loop.stage(
        "eval", after=produce, description="score it against the judge; the chart plots this"
    )
    select = loop.stage("select", after=evaluate, description="keep it if it beat the best")

    # The image the human chose, checked against the catalog while planning.
    worker = x.require_image("claude-code")
    # Targets start with NOTHING: pass the connection ids they need (a
    # claude-code worker cannot call its model without its credential).
    connections = [c["id"] for c in x.list_connections()]

    best, best_score = None, float("-inf")
    for gen in exp.iterations(loop, max_iterations=20):
        with produce.run():
            candidate = x.spawn(
                f"Improve this prompt: {best!r}",
                x.s({"prompt": "string"}),
                template=worker,
                connections=connections,
            )
        with evaluate.run() as span:
            span.score = judge(candidate["prompt"])  # your own scoring
        with select.run():
            if span.score > best_score:
                best, best_score = candidate["prompt"], span.score
```

Rules that matter:

- **Every loop and stage carries a `description`** — one plain sentence on
  what happens there and what it reports. It shows on the node in the live
  graph, so the user can read the design off the UI instead of decoding ids
  like `verify`. Bare ids are for throwaway spikes only. And the id itself is
  the chart legend, so name stages for a reader who never saw the script —
  `speedup-per-seed`, `arm-decomposition` — not for the code (`seed-score`,
  `arm-score`, `verdict` are the exact three that once sent a user asking
  what their own chart meant).
- **The worker image comes from the catalog, never from a guess.** Resolve it
  with `x.require_image(<id>)` in the declaration section and pass that value
  as `template=`. Don't hardcode `claude-code` because it is the familiar one.
- **Spawned targets get only the connections you pass.** No `connections=`
  means no credentials at all — a claude-code target then fails its first
  model call and the invocation hangs until its liveness deadline. Pick the
  subset from `x.list_connections()` (ask the human which, like `dam-invoke`
  teaches) — usually at least the model-provider connection.
- **Scores are plain numbers, higher is better.** Set `span.score` on the
  stage that evaluates; the platform charts them but never interprets them.
- **Score the finest honest measurement, not the round** — one scored span per
  seed / sweep point / arm. See *Designing a score that means something* below;
  it is the difference between a chart and a single dot.
- **Candidates go to the Artifact Library.** Publish files with your artifact
  tools (`create_artifact`), then reference them: `span.artifact(artifact_id)`.
- **Spawns inside a span attach automatically** — the live view shows each
  invocation under its stage. Pass `span=` explicitly in fan-out code.
- **Undeclared stages are fine** (`exp.span("mutate")`) — the platform grows
  the graph and marks the stage as drift. Prefer declaring; drift is a signal
  to the human that the script deviated from its design.
- **Use `with Experiment(...)`** so a crash reports `failed` and a clean end
  reports `completed`.
- Keep the whole experiment in **one file** (it is captured and versioned).
- **A missing common tool is yours to solve, silently.** Prefer an equivalent
  that is already present (`git diff --no-index` compares files with no repo
  and no `diff` binary; `cmp -s` answers same-or-not), or install the tool if
  the pod allows it. Never surface the workaround to the user — "there is no
  diff binary, so hashes instead" is tool archaeology, not information.

### Designing a score that means something

A run's score line is the only quantitative thing most readers will look at,
and it is easy to produce one that is technically correct and answers nothing.
The failure modes below are all real ones, and they are decided at design time
— before the human approves the envelope, not after the numbers land.

- **Score per measurement, not per round.** The chart draws one series per
  stage, plotting each scored span in arrival order, so a stage that scores
  once per round on a one- or two-round run is a single dot with padded axis
  bounds. Emit a scored span per seed, per sweep point, or per arm instead:

  ```python
  with per_seed.run(iteration=seed) as span:
      span.score = speedup_for(seed)
  ```

  Round-level aggregates (the median, the best so far) are facts *about* the
  round, not a second series: put them in `span.attrs` or `exp.post_data(...)`.
  `iteration` must be a non-negative integer; it rides in the feed for labels
  and bespoke dashboards, and does not set the x position — so emit points in
  the order you want them read.
- **More rounds are not more confidence.** Repeating a *deterministic* change
  measures the harness's noise, not the effect's uncertainty. Two or three
  rounds give a confidence interval on the measurement; beyond that you are
  paying campaign prices for nothing. Spend the budget on seeds and sweep
  points, which vary something real.
- **Check the measurement is not measuring your instrument.** If the optimized
  side lands near the resolution of the thing doing the timing, the ratio is
  baseline ÷ one clock tick — a big, meaningless, wildly unstable number. The
  tell is per-seed spread with no code change between seeds (424× → 651× on
  identical code was exactly this). On the fast side, prefer a **batch
  measurement** — total wall time for N operations, reported as ops/sec or
  ns/op — over a per-operation percentile, and say in the run's caveats where
  the instrument's floor sits.
- **A fast measurement measures the machine's mood.** The other half of the
  same problem: once the optimized side is quick, the timed window gets short
  enough that anything else running on the pod shows up as signal. A worker
  pod with 2 CPUs, measuring a 4–80 ms loop while the harness ran its own
  concurrent agent processes, produced 437,992–1,436,541 ops/sec for the
  *identical* variant — a 3.3× spread with no code change, sitting
  underneath a real per-seed distribution and inflating it. Two defences,
  both cheap: make each measurement long enough to swamp the noise (or take
  at least 3 reps per seed and report their median), and require the measurement
  to run quiet — nothing else of the harness's own work executing at the same
  time. Then say in the caveats how much of the observed spread you could
  attribute to contention; a spread you have not bounded is not evidence
  about the code.
- **Sweep the parameter the effect depends on.** When the win is a function of
  size, load, or input scale, a single fixed point plus a yes/no bar throws
  away the finding. The same tiny-cache change was 1.7× at n=1 and 525× at
  n=20 000: sweeping n and scoring each point charts the mechanism (Θ(n)), and
  shows the crossover where the change starts to be worth making. A curve
  answers "when does this matter"; a dot answers "did the known win happen".
- **Put the ablations in the data layer.** If the campaign measured the
  decomposition — this change alone, that change alone, both together — score
  each arm rather than only the winner. Mechanism that lives only in a
  markdown report is mechanism that dies with the reader's patience.
- **Carry absolute numbers next to every ratio.** A speedup hides both ends: a
  reader cannot tell 174 µs → 0.33 µs from 17 ms → 33 µs, nor see that the
  fast end is instrument-bound. Put baseline and treatment, in their own unit,
  in `span.attrs`. And note that the stock chart's y axis is linear between the
  series' own min and max: across orders of magnitude the small points collapse
  onto the floor of the chart, so score the log or build a bespoke dashboard
  when the spread is that wide.
- **Set a pass bar that could fail.** A 10× bar cleared at 500× discriminates
  nothing — every plausible candidate passes, and the pre-registration becomes
  decoration. Put the bar where the answer is genuinely in doubt: near the
  theoretical floor ("how close to O(1) did we get?"), or drop the binary bar
  for a continuous objective against that floor.
- **The driver owns the headline number.** Compute it in the script from the
  structured result you demanded, never from the worker's prose. A worker's
  own `report.md` has shipped with a wrong baseline median and a false claim
  that its per-seed files did not exist; the driver had the right numbers in
  hand the whole time. Publish the worker's narrative as commentary, clearly
  labelled, and make the run's own summary the one derived from data.
- **A boolean is not a score series.** A pass/fail verdict belongs in
  `exp.post_data(...)` as a card the stock dashboard renders — the verdict
  plus each named check and its outcome — not on the chart. A run once
  scored its `verdict` stage with the median speedup: a redundant line that
  duplicated an existing series while the actual pass/fail hid in the attrs.
  If a verdict series is truly wanted, score `1.0` or `0.0` and nothing else.
- **Missing data must look missing.** Never map an invalid value onto a
  legible one: a `log2(effect) if effect > 0 else 0.0` guard renders garbage
  as "no change", which is a *finding*. Write no score at all, set an
  `invalid` attr with the reason, and let the gap in the series say what
  happened.

### A purpose-built worker: one Nous campaign per iteration

The same shape with a curated image instead of `claude-code`. The worker
already *is* the loop's machinery, so the stage is one spawn and your script
only decides what to try next and records the score.

**A Nous run's score axis is seeds, not rounds.** A campaign is expensive
enough that a run chains one or two of them, so a per-round score is a chart
with one or two dots — while the campaign itself measured the metric on every
seed of its confirming iteration, which is exactly the distribution the human
wants to read (does the metric hold on every seed, or is one seed carrying
the median?). So make the worker report its **per-seed measurements** and
score one span per seed. The round's median rides along as an attribute.

**Interview the human before authoring a Nous experiment.** A Nous campaign
pre-registers its own science, and a guessed parameter fails hours in, not at
`--plan`. Ask — don't default — for:

- **Target repo and research question / hypothesis** — what to optimize, in
  the human's words.
- **Primary metric, direction, and pass condition** (e.g. "median
  speedup ≥ 1.30 in ≥ 2/3 seeds") — the campaign's `ground_truth`; Nous
  commits to it before running. Sanity-check the bar against what the change
  plausibly does: one set at 10× and cleared at 500× discriminated nothing.
  Also check the metric survives the win — a latency percentile that lands on
  the timer's floor once optimized measures the clock, not the code (see
  *Designing a score that means something*).
- **Campaign iterations** (`max_iterations` *inside* the worker) and **seeds**
  for the confirming iteration — the seed count is also how many points the
  score chart gets, and the pass condition scales with it (3 seeds means a
  bar like "≥ 2/3", not "≥ 8/10").
- **Experiment rounds** (your loop's `max_iterations` — how many campaigns to
  chain) — total runtime multiplies through, so compute the TTL from these
  answers rather than assuming one.

**Default to about an hour, end to end.** Left to its natural size a campaign
runs all afternoon, and that size is almost never what the question needed:
the run that motivated this rule spent 2 h 07 m on two iterations, ten seeds
at five reps each and eight hypothesis arms — to confirm an effect that was
known in advance. Three seeds and one confirming iteration would have
produced the same verdict inside an hour. Overkill is the default failure
here, not under-measurement, so propose the small shape:

- **1 round** — one campaign per run unless they want a chain.
- **1–2 campaign iterations** — a short rehearsal plus one confirming pass.
- **≥ 3 seeds**, at ≥ 3 reps each — three of each is the floor and the
  default; enough to bound contention (see *Designing a score that means
  something*) without spending the hour on it. Go above the floor when the
  human asks, or when the metric is noisy enough that three seeds cannot
  separate the effect from the spread — and say which it is.
- **One primary metric and one hypothesis.** Every extra arm is extra minutes.

This is the *default*, not a cap: the human can ask for ten seeds, a real
multi-iteration search, or a chain of campaigns whenever the question earns
it, and then the estimate simply grows with their choice. What you must not do
is quietly pick the big shape for them. State the estimate with the proposal,
and when it breaks the hour, **cut scope, never the TTL** — fewer seeds, fewer
iterations, a narrower question. The TTL still gets generous slack over
whatever the estimate ends up being (a killed working pod wastes everything);
the hour budgets the *work*, not the deadline.

### You do not write the campaign's arms — but you do pin its design

The worker authors its own hypothesis bundle: the arms (`h-main`,
`h-ablation`, `h-super-additivity`, `h-control-negative`, `h-robustness`, and
campaign-specific ones like `h-dose-response`) come out of its DESIGN phase,
not out of your prompt. That is the point of the image, and it is why a Nous
round is one spawn instead of a loop you drive.

**It does not follow that you have no control.** `campaign.yaml` carries four
fields that steer the design hard, and an agent that only writes prose leaves
them on the table — then wrongly concludes it "can't force" a design it wants:

- **`research_question`** — phrase it as the shape of the answer you want. "Is
  X faster?" invites a yes/no; "does X's cost become independent of n?" invites
  a curve, and the designer reaches for a dose-response arm on its own.
- **`target_system.controllable_knobs`** — names the knobs the designer may
  vary. Put the sweep variable here or it may never be swept.
- **`ground_truth.direction_claim`** / `pass_condition` / `primary_metric` /
  `seeds` — pre-registered and rendered into the agent's prompt, so it cannot
  move the goalposts. A direction claim stated as a trend ("baseline cost grows
  ~linearly in n while the treatment stays flat") commits the campaign to
  measuring the trend.
- **`locked_parameters`** — hard-pinned values that MUST reappear identically
  in the bundle's `verified_parameters`; a mismatch fails validation **even
  under `--auto-approve`**. This is the actual enforcement mechanism: put the
  n grid, the rep count, and the seed list here and the campaign cannot
  quietly measure something else.

`target_system.description` is substituted verbatim into the model's prompts —
it is where baselines, exact CLI invocations, metric definitions and
statistical guardrails belong. What it is NOT for: dictating the bundle's
arms. The arm family is the tool's methodology and the reason its verdict is
defensible; a measured iteration already includes the full standard bundle.
Time-box with the schema's own knobs instead — `max_iterations`, `max_turns`
(per-phase tool-use caps, e.g. `{design: 40, execute_analyze: 80}`), and the
TTL sized from measured runs. `plot_specs` runs figure scripts after each
`findings.json`, and `pre_work_script` runs a deterministic exploration before
iteration 1 (a good place to measure the baseline). Full field list:
`nous schema campaign`, mirrored in the image's own
`.agents/skills/nous/reference/campaign-schema.md`.

Bake the answers into the campaign prompt so the worker doesn't re-decide
them. How the worker's results are laid out on disk — the stable verdict
files, per-seed measurements, and what to have it report — is documented in
[references/nous-evaluator.md](references/nous-evaluator.md); read it before
writing the spawn prompt or judging a finished campaign.

```python
import statistics

import experiment_sdk as x

CAMPAIGN = """Run a Nous campaign, unattended and to completion — no human
will reply to you. Target repo: {repo}. Hypothesis to test: {hypothesis}.
Optimize: {metric} (higher is better); pass condition: {pass_condition}.
Author campaign.yaml yourself with an objective block over that metric,
max_iterations: {campaign_iters}, seeds: {seeds}, run --auto-approve, and
stay alive until the campaign is DONE.
Locked parameter — resource envelope: you run inside a container with a hard
memory limit; exceeding it kills the whole campaign, not the offending
process. Run measurement arms SERIALLY (one baseline-or-treatment condition
at a time), tear each target-system instance down before starting the next,
and never hold more than one instance of the target system's daemons alive
at once. Serial arms are also better science: concurrent instances contend
for CPU and pollute latency numbers.
Locked parameter — quiet measurement: this pod has few CPUs, so anything
running during a timed window becomes part of the number. While measuring,
run nothing else of your own — no concurrent agents, no parallel builds, no
background analysis. Take at least 3 reps per seed and report the median of
reps, and size each timed window long enough that a scheduling hiccup cannot
dominate it. If you cannot keep the machine quiet, say so in your report
instead of reporting the number as clean.
Then report the objective score from best_found.json, the h-main arm status
from the last iteration's findings.json, and a summary from
meta_findings.json.
Publish as you go, not only at the end: the moment an iteration completes,
publish its findings.json (and any raw per-seed results worth keeping) as
artifacts, and publish report.md the moment it exists. You can be killed by
your deadline mid-campaign; whatever is unpublished at that moment is lost.
Report per_seed as well: for EVERY seed of the confirming iteration, read the
raw measurement files under runs/iter-<N>/results/<arm>/ and report its seed,
baseline and treatment values for the primary metric, in the metric's own
unit. Read those numbers from the raw files, never from report.md's prose or
tables. Report per_arm too — arm_type, status and effect for every arm you
measured, ablations included; the decomposition is the mechanism, and prose is
not where it survives.
For per_arm, effect is DEFINED as: that arm's OWN baseline value of {metric}
divided by that arm's OWN treatment value, measured separately per arm on the
same seeds. It is a ratio: >1 means the arm helped, 1.0 means no change, and
a control that changes nothing must come out ~1.0 — never 0, never blank,
never a value copied from another arm.
Report cost too, from llm_metrics_summary.json (or `nous cost <run_id>`):
total USD, total tokens, and LLM call count, plus the campaign's own run_id
so cost stays re-derivable. These files are stable and always exist — report
them even when the campaign fails.
Publish the winning change itself — cumulative.patch — as an artifact, so the
driver can apply it to its own copy and re-measure rather than take your
numbers on faith."""

with x.Experiment("nous-campaigns") as exp:
    loop = exp.loop("rounds", description="one Nous campaign per pass")
    campaign = loop.stage("campaign", description="the worker runs a whole campaign")
    seed_score = loop.stage(
        "speedup-per-seed", after=campaign,
        description="one point per measured seed; the chart plots these",
    )

    worker = x.require_image("nous")
    connections = [c["id"] for c in x.list_connections()]

    hypothesis = "..."  # from the interview
    for round_ in exp.iterations(loop, max_iterations=ROUNDS):
        with campaign.run() as span:
            result = x.spawn(
                CAMPAIGN.format(repo=REPO, hypothesis=hypothesis, metric=METRIC,
                                pass_condition=PASS_CONDITION,
                                campaign_iters=CAMPAIGN_ITERS, seeds=SEEDS),
                x.s({"status": "string", "summary": "string", "run_id": "string",
                     "per_seed": [{"seed": "integer", "baseline": "number",
                                   "treatment": "number"}],
                     "per_arm": [{"arm_type": "string", "status": "string",
                                  "effect": "number"}],
                     "cost": {"usd": "number", "tokens": "integer",
                              "llm_calls": "integer"},
                     "pr_url": "string?"}),
                template=worker,
                connections=connections,
                ttl_ms=TTL_MS,  # computed from the interview, not assumed
            )
            span.attrs["summary"] = result["summary"]
            span.attrs["status"] = result["status"]
        # Worker numbers are claims, not facts: validate before scoring
        # (coverage, positivity, distinct arms, sign agreement — see below).
        # Record problems instead of raising: bad evidence belongs on the
        # results page, and result_valid gates the verdict.
        problems = validation_problems(result)
        # One scored span per seed: a single campaign still draws a readable
        # distribution, and the spread is the scientific content.
        speedups = []
        for m in sorted(result["per_seed"], key=lambda m: m["seed"]):
            with seed_score.run(iteration=m["seed"]) as seed_span:
                seed_span.score = m["baseline"] / m["treatment"]  # your metric's direction
                # The ratio alone hides both ends — keep the absolutes.
                seed_span.attrs.update(seed=m["seed"], baseline=m["baseline"],
                                       treatment=m["treatment"], unit=METRIC_UNIT)
                speedups.append(seed_span.score)
        exp.post_data({f"round-{round_}": {
            "median": statistics.median(speedups),
            "seeds_passing": sum(1 for s in speedups if s >= PASS_BAR),
            "arms": result["per_arm"],  # or a stage of their own, one span per arm
            "cost": result["cost"],
            "status": result["status"],
            "result_valid": not problems,
            "problems": problems,
        }})
        hypothesis = next_hypothesis(result)  # your own choice of what to try
```

In a multi-round loop, **wrap the spawn** so one dead worker fails the round,
not the run: catch `x.InvocationFailed`, record `span.attrs["error"] =
str(e)` (the message carries the platform's reason — OOM, deadline, crash),
mark the span failed, and continue to the next round. An uncaught failure
kills the script and every remaining round with it.

Nine things this example is really teaching:

- **Define every number you demand.** A schema field typed `"number"` with no
  definition is an invitation to guess, and the worker will accept it: a run
  once returned `effect = -1.056` on all five arms because nobody said what
  `effect` was a number *of* — every downstream failure traced back to that
  one gap. For each numeric field, the prompt states the formula, the unit,
  the direction, and the value an inert control must produce (~1.0 for a
  ratio — never 0, never blank, never copied between arms).
- **Validate before you score.** Every worker-reported number is a claim
  until it survives a gate the driver runs before writing any span:
  - coverage — per-seed / per-n arrays match exactly the seeds and grid you
    pinned; timings are positive;
  - **distinct arms** — arms run different code and cannot agree to six
    decimals; identical effects are a constant, not a measurement;
  - **sign agreement** — an arm claiming "2× slower" while the raw numbers of
    the same run show "4706× faster" is irreconcilable and must fail loudly;
  - a plausibility ceiling — a headline past it (say 1000×) passes only with
    corroboration (checksums unchanged, ruler untouched), because that
    magnitude is where broken benchmarks live;
  - the worker's baseline within a few × of one the driver measured itself;
  - the campaign's own verdict — `h_main_status == "CONFIRMED"` from
    `findings.json`, so a numerically-passing run cannot hide a REFUTED arm.
  Record the problems in `post_data` instead of raising — bad evidence must
  be visible on the results page — and gate the verdict on `result_valid`.
- **Replicate when the driver can.** The strongest verification is not a
  check, it is re-measurement: the worker publishes `cumulative.patch`, and a
  driver that holds its own pristine copy of the target applies the patch,
  runs the tests and the bench itself, and computes the headline from its
  own numbers — the worker's figures become a cross-check, and every
  self-graded field (tests, checksums, ruler lock, timings) becomes a
  driver-confirmed one. Do this whenever the measurement runs on plain local
  tooling; skip it only when the measurement needs hardware or state the
  driver lacks.

- **The round is silent until it ends.** One campaign per round means one span
  running for hours with nothing to show — no points, no progress, and the
  measurement phase is the quietest part of all. Tell the human the expected
  silence before they press Start, and when you narrate a live run, say "still
  inside the campaign, N minutes in" rather than going quiet yourself. A
  monitoring check-in scheduled on optimistic timing is worse than none: it
  fires after the run has already finished and reports nothing.

- **The seeds are the score series.** One or two campaigns per run means the
  round is the wrong scoring unit; the per-seed spans are what make the chart
  readable and what answer the pass condition ("≥ 2/3 seeds"). Ask the worker
  for the raw per-seed numbers in its typed result — the metric keys and file
  names are campaign-specific and the pod is gone by the time you'd want to
  go looking (see [references/nous-evaluator.md](references/nous-evaluator.md)
  §1b), so a normalized `per_seed` array is the only durable form. Demand the
  numbers from the raw files, not from `report.md` — a campaign's own report
  has quoted a baseline median that its raw files contradict, and the driver's
  summary should be computed from the structured result either way.
- **Give a purpose-built worker an autonomous prompt.** Its own instructions
  (the image's `AGENTS.md`) may default to a conversational, ask-the-human
  flow. Say plainly that no human will reply and that it must run to
  completion, or it stalls waiting for an answer nobody sends.
- **Match the TTL to the real runtime — and know the clock starts at spawn.**
  `nous`-class work will run for hours if you let it, and the default liveness
  deadline is not a promise your loop should lean on. Estimate from **measured
  runs, not hope**: a healthy 2-iteration campaign on a small target measured
  ~60 min per iteration on a dev cluster — so the one-hour target means ONE
  confirming iteration, and a 2-iteration campaign is a ~2 h proposal, said as
  such. Set the TTL at roughly double the measured estimate: the clock also
  pays for pod cold start, queueing for compute room, and degraded stretches —
  a worker that cold-started into a cluster disturbance has crawled at a
  twentieth of its healthy pace and then been executed by a TTL sized for the
  healthy pace, losing everything. A heavy worker also holds real
  CPU/memory/disk per target, so keep the fan-out to a handful of arms, not
  dozens.
- **Everything on the worker dies with it — so publish per iteration.** The
  worker is reaped the moment it reports, hits its TTL, or its run is swept;
  make the prompt name what to report and which files to publish as artifacts
  (`report.md`, `meta_findings.json` — see the reference), and require each
  iteration's `findings.json` to be published **as it completes**, not in a
  final batch. Three consecutive campaigns have died mid-run (a starved node,
  an inactivity reap, a TTL) and each lost hours of finished measurements that
  publish-as-you-go would have kept.
- **Bound the campaign's own parallelism — for survival *and* for the
  numbers.** The worker's memory limit is a hard ceiling for everything the
  campaign starts — benchmark daemons included — and blowing it OOM-kills the
  whole container mid-iteration (a pm2 benchmark holding three ~1 GiB daemons
  at once died exactly this way). The same envelope protects the measurement:
  on a 2-CPU pod, the harness's own concurrent agents moved identical-code
  throughput by 3.3×. Lock both in the prompt: serial measurement arms, one
  target-system instance at a time, and nothing else of the worker's own work
  running while a timed window is open.

## Plan, then run — never run the loop yourself

1. Write the script in **its own folder, one per experiment** —
   `experiments/<name>/experiment.py`, bespoke dashboard beside it
   (`dashboard_path` resolves against the script's directory). An agent
   often hosts several experiments; a folder per lineage keeps scripts,
   dashboards, and run logs (`<script>.log`) from colliding.
2. Register the plan: `python3 experiments/<name>/experiment.py --plan`.
   This creates a **draft** Experiment — the user reviews the skeleton graph
   in the UI. (Running the script without a run context does the same
   and exits.)
3. **Announce the draft as an explanation, not a receipt.** The graph shows
   each node's `description` (write them — see the authoring rules), but your
   message still carries the design in one place — a small table, one row per
   stage:

   | Stage | What happens there | What it reports | When it reports |
   |---|---|---|---|

   Say in one line each: the loop and how many rounds it makes, what each
   stage does inside a round, which stage carries the score and what the
   number means (its direction and its baseline), and how the run can end.
   The stage ids in the table must match the graph exactly, so the user can
   map your explanation onto what they see.

   **The last column is not decoration.** A stage that wraps one long spawn
   shows nothing until it returns, so write the wait into the row ("nothing
   for ~45 min, then all 3 seed points at once") rather than leaving the user
   to discover a long silence and read it as a dead run. Then say the Start
   button is theirs and that nothing has run.
4. **Stop there.** The user presses **Start a new run** in the UI; the
   platform then instructs this agent to start the script in the background
   with `PLATFORM_EXPERIMENT_ID` set. Do not set that variable yourself.
5. Re-registering after edits updates the draft (the script is re-versioned);
   after a run, registering again creates a sibling experiment.
6. **Never modify the experiment inside a run's launch session** — no script
   or dashboard edits and no re-registration while a run is live. The run
   executes the frozen capture; iterate in the build conversation and the
   changes apply to the next run.

## What a run must surface

The platform charts scores on its own, but a bare score line answers almost
none of the questions the human brings to a finished run. Whatever the
mechanism — `span.attrs` per round, `exp.post_data(...)` for run-level facts
(the stock dashboard renders `feed.custom`), or a bespoke dashboard when
tables warrant one — make sure the run's presentation carries:

- **The improvement in context** — score against the baseline you measured,
  not a naked number. Bake the baseline into the run (measure it yourself
  where you can) so every later reading has its denominator.
- **The evidence table** — per-iteration / per-seed / per-arm comparison, so
  the human can see whether the median is carried by every seed or by one.
  This is the same distribution the score chart should already be plotting;
  score per measurement (see the authoring rules) and the table and the chart
  agree instead of the chart showing one dot next to a table of ten rows.
- **Time** — when the run started, elapsed, and per-round durations; the
  human approved a duration estimate, and the run should show how it tracked.
- **Token / cost consumption** — demand it in the typed result rather than
  hoping the worker volunteers it (a Nous campaign always has
  `llm_metrics_summary.json`; "when reported, pass it through" is how three
  runs shipped without a cost number).
- **Notes and caveats** — what the result does *not* claim ("3 seeds is a
  smoke run"), stated on the run itself rather than left in the chat.
- **Next steps** — what a follow-up run would change: more seeds, a wider
  search, the PR to open.
- **The report** — the worker's published report artifact, referenced from
  the span so the results page links it.

## Bespoke dashboards (optional)

Every experiment gets a stock live dashboard; build your own only when the
experiment warrants it (ask first). A bespoke dashboard is **just an HTML
file next to the script** — no artifact tools involved:

```python
exp = x.Experiment("evolver", dashboard_path="dashboard.html")
```

Plan registration captures it like the script (re-registering re-versions
the draft's dashboard artifact; the draft's script re-versions the same
way — that's the build history). Renaming the experiment forks a new
lineage. Each run automatically freezes its own script clone at start and
mints a single self-contained results page (renderer + final feed baked
in) when it ends — you never manage those run artifacts yourself.

**Extra run artifacts.** Anything else worth keeping attaches to the run
too: in a launch/monitoring session, publish with
`create_artifact(..., experiment_id=<the run's PLATFORM_EXPERIMENT_ID>)`;
agents spawned BY the experiment just publish normally — their artifacts
are attributed to the spawning run automatically. Attached artifacts show
in the run's panel next to the span-referenced ones.

The page must be fully self-contained HTML (no external requests — it
renders in a sealed iframe) implementing one contract:

```js
window.addEventListener("message", (e) => {
  if (e.data?.type === "experiment-feed") render(e.data.feed);
});
```

### The feed

Pushed on load and every few seconds while the run is live; the final feed
is baked in at the end. Shape (TypeScript-ish):

```ts
feed = {
  experiment: { id, name, status,        // draft|running|completed|failed|stopped
                skeleton: { stages: [{ id, after: string[], description? }],
                            loops:  [{ id, stages: string[], description? }] },
                drift: string[], error: string|null,
                executedAt, finishedAt, ... },
  stages: [{ id, declared, spansTotal, spansRunning, spansFailed,
             lastScore, bestScore }],
  scoreSeries: [{ stage, points: [{ iteration, score, spanId }] }],
  recentSpans: [{ spanId, stage, iteration, status,   // running|ok|error
                  score, artifactIds, attrs, startedAt, endedAt }],  // newest first, capped at 200
  invocations: [{ id, spanId, status }],
  artifactIds: string[],                // every span-referenced artifact
  custom: object|null,                  // whatever you post_data()
}
```

### Arbitrary data: `exp.post_data(...)`

Surface anything the standard feed doesn't carry — the best candidate so
far, extra series, tables:

```python
exp.post_data({"best_candidate": best, "temperature": temp_history})
```

Shallow-merges into `feed.custom` (pass `merge=False` to replace; ~128 KiB
cap on the whole blob). Per-span detail rides `span.attrs["key"] = value`
and arrives in `recentSpans[].attrs`. The stock dashboard renders
`feed.custom` as a simple key/value list, so `post_data` is useful even
without a bespoke dashboard.

## When NOT to use this

- One-shot fan-out with a typed result and no loop → use `dam-invoke`.
- Work that needs no live observation → just do the work.
