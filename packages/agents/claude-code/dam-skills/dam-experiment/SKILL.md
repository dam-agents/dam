---
name: dam-experiment
description: Author a DAM Experiment — a Python loop script (produce/eval/select, genetic algorithms, benchmark sweeps) the platform observes live with a graph, per-stage progress, and score charts. Use when asked to create, plan, or run an experiment, an optimization loop, or an iterate-and-score campaign. Provides the python experiment_sdk (Experiment/stage/span + spawn) and the plan → "Start a new run" workflow.
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
surface — `x.spawn(...)`, `x.list_images()`, `x.list_connections()`, and the
`x.s(...)` schema shorthand — so one script both drives and reports.

## Authoring a script

Declare first, then loop. The declaration is the design a human reviews:

```python
import experiment_sdk as x

with x.Experiment("prompt-evolver") as exp:
    loop = exp.loop("generations")
    produce = loop.stage("produce")
    evaluate = loop.stage("eval", after=produce)
    select = loop.stage("select", after=evaluate)

    # Targets start with NOTHING: pass the connection ids they need (a
    # claude-code worker cannot call its model without its credential).
    connections = [c["id"] for c in x.list_connections()]

    best, best_score = None, float("-inf")
    for gen in exp.iterations(loop, max_iterations=20):
        with produce.run():
            candidate = x.spawn(
                f"Improve this prompt: {best!r}",
                x.s({"prompt": "string"}),
                template="claude-code",
                connections=connections,
            )
        with evaluate.run() as span:
            span.score = judge(candidate["prompt"])  # your own scoring
        with select.run():
            if span.score > best_score:
                best, best_score = candidate["prompt"], span.score
```

Rules that matter:

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
3. **Stop there.** The user presses **Start a new run** in the UI; the
   platform then instructs this agent to start the script in the background
   with `PLATFORM_EXPERIMENT_ID` set. Do not set that variable yourself.
4. Re-registering after edits updates the draft (the script is re-versioned);
   after a run, registering again creates a sibling experiment.
5. **Never modify the experiment inside a run's launch session** — no script
   or dashboard edits and no re-registration while a run is live. The run
   executes the frozen capture; iterate in the build conversation and the
   changes apply to the next run.

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
