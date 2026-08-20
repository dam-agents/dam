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
`x.list_connections()`, and the `x.s(...)` schema shorthand — so one script
both drives and reports.

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

- **"Show me an example to optimize"** → the tiny-cache starter
  ([references/tiny-cache-starter.md](references/tiny-cache-starter.md)):
  describe it in two or three sentences and offer to set it up. Show, don't
  run.
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
  The pass condition — what counts as success — is agreed before the run.
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
- **Expected duration, stated in human terms.** "~40 min per campaign
  iteration, two iterations, one round — about 2.5 h with queue slack" is a
  deciding factor, not a footnote: the human may cut seeds or rounds to fit
  the time they have, so give them the per-unit cost that makes that trade
  legible. The `ttl_ms` you set is derived from this number — never the other
  way around.
- **The resource envelope** the worker runs in, when the workload is heavy
  enough for it to matter (see the Nous section's locked envelope).

Present it as a short list of decisions, not prose, and let them change any
line. Silence is not approval: if they have not answered, ask again rather
than picking a default and proceeding.

## No target? The bundled starter

A user who wants to see how experiments work but has nothing to optimize gets
**tiny-cache** — a deliberately slow cache with a behavioral suite and a
deterministic benchmark, shipped inside this skill at
[examples/tiny-cache/](examples/tiny-cache/). Follow
[references/tiny-cache-starter.md](references/tiny-cache-starter.md) for the
baseline ritual and the loop design — the worker harness is the user's pick,
as always.

## Authoring a script

Declare first, then loop. The declaration is the design a human reviews:

```python
import experiment_sdk as x

with x.Experiment("prompt-evolver") as exp:
    loop = exp.loop("generations")
    produce = loop.stage("produce")
    evaluate = loop.stage("eval", after=produce)
    select = loop.stage("select", after=evaluate)

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

### A purpose-built worker: one Nous campaign per iteration

The same shape with a curated image instead of `claude-code`. The worker
already *is* the loop's machinery, so the stage is one spawn and your script
only decides what to try next and records the score.

**Interview the human before authoring a Nous experiment.** A Nous campaign
pre-registers its own science, and a guessed parameter fails hours in, not at
`--plan`. Ask — don't default — for:

- **Target repo and research question / hypothesis** — what to optimize, in
  the human's words.
- **Primary metric, direction, and pass condition** (e.g. "median
  speedup ≥ 1.30 in ≥ 8/10 seeds") — the campaign's `ground_truth`; Nous
  commits to it before running.
- **Campaign iterations** (`max_iterations` *inside* the worker: rehearsal +
  confirm is 2–3; a real search is more) and **seeds** for the confirming
  iteration.
- **Experiment rounds** (your loop's `max_iterations` — how many campaigns to
  chain) — total runtime multiplies through, so compute the TTL from these
  answers rather than assuming one.

Bake the answers into the campaign prompt so the worker doesn't re-decide
them. How the worker's results are laid out on disk — the stable verdict
files, per-seed measurements, and what to have it report — is documented in
[references/nous-evaluator.md](references/nous-evaluator.md); read it before
writing the spawn prompt or judging a finished campaign.

```python
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
Then report the objective score from best_found.json, the h-main arm status
from the last iteration's findings.json, and a summary from
meta_findings.json."""

with x.Experiment("nous-campaigns") as exp:
    loop = exp.loop("rounds")
    campaign = loop.stage("campaign")

    worker = x.require_image("nous")
    connections = [c["id"] for c in x.list_connections()]

    hypothesis = "..."  # from the interview
    for round_ in exp.iterations(loop, max_iterations=ROUNDS):
        with campaign.run() as span:
            result = x.spawn(
                CAMPAIGN.format(repo=REPO, hypothesis=hypothesis, metric=METRIC,
                                pass_condition=PASS_CONDITION,
                                campaign_iters=CAMPAIGN_ITERS, seeds=SEEDS),
                x.s({"score": "number", "status": "string", "summary": "string",
                     "pr_url": "string?"}),
                template=worker,
                connections=connections,
                ttl_ms=TTL_MS,  # computed from the interview, not assumed
            )
            span.score = result["score"]
            span.attrs["summary"] = result["summary"]
        hypothesis = next_hypothesis(result)  # your own choice of what to try
```

In a multi-round loop, **wrap the spawn** so one dead worker fails the round,
not the run: catch `x.InvocationFailed`, record `span.attrs["error"] =
str(e)` (the message carries the platform's reason — OOM, deadline, crash),
mark the span failed, and continue to the next round. An uncaught failure
kills the script and every remaining round with it.

Four things this example is really teaching:

- **Give a purpose-built worker an autonomous prompt.** Its own instructions
  (the image's `AGENTS.md`) may default to a conversational, ask-the-human
  flow. Say plainly that no human will reply and that it must run to
  completion, or it stalls waiting for an answer nobody sends.
- **Match the TTL to the real runtime — and know the clock starts at spawn.**
  `nous`-class work runs for hours; the default liveness deadline is not a
  promise your loop should lean on. Budget ~30–45 min per campaign iteration,
  multiply by the iteration count, and add slack: a spawn that queues for
  compute room spends its deadline waiting. A heavy worker also holds real
  CPU/memory/disk per target, so keep the fan-out to a handful of arms, not
  dozens.
- **Everything on the worker dies with it.** The worker is reaped right after
  it reports; make the prompt name what to report and which files to publish
  as artifacts (`report.md`, `meta_findings.json` — see the reference) or the
  evidence is unrecoverable.
- **Bound the campaign's own parallelism.** The worker's memory limit is a
  hard ceiling for everything the campaign starts — benchmark daemons
  included — and blowing it OOM-kills the whole container mid-iteration (a
  pm2 benchmark holding three ~1 GiB daemons at once died exactly this way).
  Lock a resource envelope in the prompt: serial measurement arms, one
  target-system instance at a time.

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
   bare stage ids ("rounds → propose → verify → measure") that mean nothing
   the user hasn't been told, so your message carries the meaning — a small
   table, one row per stage:

   | Stage | What happens there | What it reports |
   |---|---|---|

   Say in one line each: the loop and how many rounds it makes, what each
   stage does inside a round, which stage carries the score and what the
   number means (its direction and its baseline), and how the run can end.
   The stage ids in the table must match the graph exactly, so the user can
   map your explanation onto what they see. Then say the Start button is
   theirs and that nothing has run.
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
- **Time** — when the run started, elapsed, and per-round durations; the
  human approved a duration estimate, and the run should show how it tracked.
- **Token / cost consumption**, when the worker reports it (a Nous campaign's
  meta findings carry cost data — pass it through).
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
                skeleton: { stages: [{ id, after: string[] }],
                            loops:  [{ id, stages: string[] }] },
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
