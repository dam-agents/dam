# Experiments

Last verified: 2026-08-18

## Overview

An **Experiment** is one execution of a loop script a **driver Agent** authors
in Python — a design→build→test→learn loop written as ordinary code over the
[Invocation](platform-topology.md) primitive — **observed live** by the
platform. The script declares its **Skeleton** (stages, loops) upfront, then
emits stage-tagged **Spans** (status, an opaque numeric score, Artifact
references) as it runs; Invocations spawned inside a span attach to it. The
platform's founding bet survives from the first design: it **never runs the
optimization loop and never interprets a Score** — the loop's shape lives in
code, and the code reports its shape.

### The bet

There is no platform-side conductor. The predecessor designs both died for
good reasons: an arms-racing subsystem forced work into a shape (competing
harnesses reporting scored runs) most loops don't have, and a platform-driven
conductor (#2784) would have baked loop shapes into the platform so every new
shape (tournament, retry-with-backoff, dynamic fan-out) meant a platform
change. Loops-as-code (#2821) put the shape in an ordinary script; this
subsystem adds the piece that pivot dropped — observability. The **experiment
SDK** (stdlib-only Python, baked into platform-base) is an instrumentation
layer: declaring the skeleton costs a handful of lines around code the driver
would write anyway, and everything the platform learns arrives as reported
data over the same waypoint-attributed per-agent HTTP surface the driver
already uses to spawn.

**Lenient skeleton.** The declared skeleton is a statement of intent, not a
straitjacket: a span naming an undeclared stage grows the graph and is flagged
as **drift**, never an error. Agent-authored scripts must not fail hours into
a run over a declaration mismatch; drift is signal for the human, not a fault.

## The experiment sandbox

Nothing about an Experiment requires a special Agent — Plan Registration is keyed
only on the calling agent's waypoint identity, so any Agent with the SDK can
register one. But an agent has to *know how*, and until it does the Experiments
destination has nothing to show and the user has nothing to click.

So creating one is a first-class flow: an **experiment sandbox** is an Agent
carrying the `experiment` [Agent Kind](knowledge-bases.md) whose Install Command
copies the `dam-experiment` authoring skill and an `/experiment-onboard` command
out of a path staged in the image, and appends a sandbox-purpose note to the
pod's user-level AGENTS.md so every session — not only the greeted first one —
opens knowing that "experiment" means a platform Experiment. AGENTS.md is the
source of truth and a symlink makes Claude Code read it, mirroring the image's
`/etc/AGENTS.md` pattern at `$HOME` level. The note rides a shared append
primitive in the agents module that skips sections already present, so a
replayed install or a later writer composes instead of duplicating or
clobbering. It rides the same kinded-create rail as a
Knowledge Base, differing only in the marker and the command; nothing is fetched
over the network, because the kit ships with the image. The skill used to be baked
into every Claude Code sandbox's seeded workspace — moving it behind the marker is
what makes the two things distinguishable. Sandboxes seeded before the move keep
their copy: the marker is not retroactive, and nothing is migrated.

**The marker is declared intent, not a capability gate.** It records that a
sandbox was made to run loops; it does not stop any other agent from registering a
plan. Both populations therefore belong on the destination, which lists **marked
sandboxes ∪ agents with at least one Experiment row** — a marked sandbox with
nothing in it yet is an empty container, and an unmarked agent that registered a
plan earns a container too. There is no backfill and nothing disappears.

Opening a fresh experiment sandbox **greets the user**: the UI hidden-sends
`/experiment-onboard` so the agent opens by asking what to optimize. It waits until the
sandbox reports that skill among its installed skills, so it never runs a command
the Install Command has not delivered yet — the skill is copied last precisely so
its presence implies the command and the purpose note both landed.

## Resources

Vocabulary in [`docs/ubiquitous-language.md`](../ubiquitous-language.md#experiments-bounded-context--rebase-in-progress-2942);
field-level shapes in the [contract](../../packages/api-server-api/src/modules/experiments/).

- **Experiment** — owner-scoped. Building and running are separate: the
  **draft** is source (persists; plan re-registrations update it, its script
  artifact's versions are the build history), and each **run** is an
  immutable capture started from it — its own row
  (`running → completed | failed | stopped`) carrying the draft's
  declaration plus its OWN script clone; live it renders the draft's
  dashboard, and the terminal transition mints its single-version results
  artifact. A draft never becomes a run; terminal runs never reopen.
- **Skeleton / Stage / Span** — the declared structure; one stage execution =
  one span, carrying status, optional Score (captured and charted, never
  normalized or ranked), Artifact Library references, and an opaque attrs bag.
- **Script Artifact** — the script source, versioned in the Artifact Library.
  Everything platform-managed for a lineage — draft script + dashboard,
  every run's script clone and results page — lives in the lineage's folder
  (`Experiments / <name>`), keeping the library root free of stock
  artifacts. Postgres never stores source; every run records the exact
  version it executed, and a `run-start` announcing a changed sha publishes
  the next version — divergence is visible history.
- **Dashboard Artifact** — the HTML renderer of the Trace Feed: a
  platform-shipped stock dashboard auto-published at plan registration, or a
  bespoke one the agent generated. Rendered in the sealed in-app iframe; data
  arrives only via postMessage (see [artifact-library](artifact-library.md)).
  The live surface is the panel that **docks itself in the driver's chat**:
  a build session shows the draft's panel (skeleton + "Start a new run"), a
  run session shows only its run. A live run renders the draft's dashboard
  (the renderer; data arrives live); on the terminal transition the platform
  mints the run's own single-version **results artifact** — the renderer
  plus a baked replay of the final feed over the same message contract — so
  the finished result is self-contained and shareable without any bridge.
  The Experiments destination groups lineages (status, runs, live invocations,
  per-run artifacts) under the sandbox running them and routes into that chat —
  the sandbox is the container because one holds many lineages, so there is no
  per-experiment page to route to.
- **Trace Feed** — the bounded JSON projection (per-stage aggregates,
  downsampled score series, recent spans, attached invocations) served over
  tRPC; the one contract shared by dashboards, the UI, and the SDK docs.

## Flow

```mermaid
sequenceDiagram
  participant U as user (UI)
  participant H as harness (driver pod)
  participant S as script (experiment SDK)
  participant API as api-server<br/>(Experiments)
  U->>H: chat: author the experiment
  H->>S: python exp.py --plan
  S->>API: POST /experiments/plan (skeleton + script)
  API->>API: draft Experiment; script + dashboard artifacts published
  U->>API: Start a run (new row + script clone)
  API->>H: runtime-channel event → launch prompt
  H->>S: python exp.py (background process)
  S->>API: run-start, span events (batched), spawns tagged with span ids
  API-->>U: live hint per event batch → UI refetches Trace Feed
  S->>API: finish (completed | failed)
```

**Plan registration.** Running the script in plan mode executes declarations
only; the SDK posts the skeleton plus the script capture (path, sha256, full
source) and the platform creates the `draft` — publishing the source into the
Artifact Library and attaching the stock dashboard (or the bespoke HTML the
SDK captured via `dashboard_path`). Re-registering the same `(driver, name)`
refreshes the draft in place — script and platform-authored stock dashboard
both re-version — the draft is the lineage's permanent buildable. **Start a
run** clones the draft's declaration and script into a fresh run row and
launches it; results only ever land on the run's own artifacts (script clone
at start, results artifact at the end), so the draft's stay clean for the
next build iteration.

**Ingestion and attribution.** The reporting routes live beside the
invocation endpoints on the harness port: the waypoint-authenticated `:id`
path segment is the caller, no body ever names the driver, and a foreign or
missing experiment reads as unknown. Events append only while the experiment
is `running` — Stop closes the trace, so a stopped loop dies on its next
call. Every accepted batch bumps the liveness clock.

**Every terminal transition has teeth.** Closing the trace alone would let a
loop parked inside a `spawn()` poll run to the invocation deadline, so going
terminal also fails the experiment's running Invocations (eagerly reaping
their targets) — which unblocks waiting `spawn()` calls at once — and new
spawns stamped with a non-running experiment's span are rejected, so a loop
that catches the failure and retries dies too. A loop doing pure local compute
exits at its next report; the released pin lets the idle checker reclaim a
truly silent one.

This applies to **all three** terminal paths — Stop, the script's own `finish`
(`completed` *and* `failed`), and the inactivity sweep — not Stop alone. The
ledger is closed in every case, so a surviving target can no longer report into
the run; leaving it alive only holds its pod and its owner's budget until the
invocation TTL, which is hours for a long campaign. `completed` is included
deliberately: a loop that returns without awaiting a spawn orphans its target
exactly like one that died mid-poll. The Agent Sweep is not a backstop here —
it reclaims a Sweepable target only once that target hibernates, and a template
may disable hibernation outright (the `nous` catalogue entry pins
`hibernationTimeout: "0s"` so a detached campaign is not killed mid-run),
leaving the invocation liveness deadline as the sole remaining bound. The reap
is best-effort on every path: a failed cancel never blocks the transition.

**The worker image is a design-time choice.** Which image a loop spawns decides
what the experiment can do, so the platform makes the catalogue part of
designing one rather than something the author must already know: the
`dam-experiment` skill requires reading `GET /images` (the same catalogue the
one-shot spawn flow offers) and presenting it to the human before any loop is
written, and forbids installing a framework inside a worker when a curated
image already ships it. Two checks keep a wrong id from surfacing as an empty
result hours in: `require_image()` resolves the id against the catalogue during
the declaration section, so plan mode fails while the human is still reviewing
the design, and the spawn route rejects an unknown `templateId` with a `400`
naming the ids that exist — the lenient-skeleton rule is about *stage* drift and
does not extend to naming an image that isn't there.

**A failed spawn says why.** Polling an invocation returns its status and, once
the target reports, the schema-validated result. A `failed` row additionally
carries the platform's own reason — deadline exceeded, target pod restarted
mid-turn, stopped with the run — because it is the one line of diagnosis the
platform holds and the loop cannot reconstruct: the target is already gone by
the time the driver sees the failure. A loop that only ever read a bare
`failed` would have to guess whether to retry, back off, or shrink its
workload.

**Span ↔ spawn attach.** A spawn made inside a span carries
`experimentSpanId` ("experimentId/spanId") on the invocation request; the
feed joins invocations back to their stage through it. The invocations
context stores it opaquely.

**Run-attached artifacts.** Artifacts can join a run outside the span flow:
the `create_artifact` MCP tool takes an optional `experiment_id` (the
driver's monitoring session names the run it was launched for), and a
publish by an invocation *target* is attributed automatically through the
invocation its own agent id keys. Both land on the run row
(`attached_artifact_ids`) and the Trace Feed unions them with the
span-referenced rollup, so the run panel and the baked results page list
them. Only the run's driver may attach explicitly (foreign ids read as
unknown), and drafts refuse attachment — results belong to runs.

## Completion and liveness

Starting a run stamps `executedAt`; the script's `finish` (or an unhandled exception
reported by the SDK) flips `running → completed | failed`. In run mode the
SDK also runs a **heartbeat**: a daemon thread with its own request path
posts a no-op `heartbeat` event (~60 s) so a healthy loop that is quiet —
blocked in a `spawn()`, deep in a local computation — keeps its activity
clock moving; the thread dies with the script process, which is exactly the
signal. The **inactivity sweep** is the backstop: a `running` row with no
accepted event within the configured window
(`EXPERIMENT_INACTIVITY_SECONDS`, default 15 min) is reaped to `failed` —
with heartbeats, that now specifically means the script process is gone
(crashed without reporting, pod lost). A wedged-but-alive script heartbeats
indefinitely and stays visibly `running` until the user stops it: the sweep
cannot tell stuck from slow, and Stop exists. Each
reap is an atomic conditional transition, so multi-replica races no-op, and
the sweep runs with a jittered start. A running Experiment also **pins** its
driver Agent against the idle checker's hibernation (the
`agent-platform.ai/experiment-active` annotation, subordinate to a user hard
stop); reaching any terminal state releases the pin — the sweep is therefore
also what un-pins a crashed run's driver.

## Domain events

Every change to an experiment raises a single event type on the in-process
bus — plan registrations, span batches, terminal transitions and sweep reaps
alike. It is advisory and non-durable, and its everyday consumer is the live
hint that keeps an open browser's Trace Feed current without polling.

Start, Stop, and Delete are different: each is a person choosing to use the
feature, so exactly those three carry the acting person and the action, and
are recorded as [Activity Events](usage-tracking.md). Everything the loop or
the platform raises on its own — the script's reports, a failed launch, the
inactivity sweep's reaps — names no actor, and the usage subscriber ignores
anything without one. A run the sweep failed and a run the script finished
look the same here: neither is a person doing something, and neither reaches
the activity log. The lineage's platform-written artifacts (dashboard, script
clone, results) are marked internal on publish, so they never count as
publishes either — [artifact-library](artifact-library.md) owns that rule.

## Where the code lives

- Contract (resources, Trace Feed, REST payloads, tRPC router):
  [`packages/api-server-api/src/modules/experiments/`](../../packages/api-server-api/src/modules/experiments/)
- Implementation (service, repository, sweep, stock dashboard):
  [`packages/api-server/src/modules/experiments/`](../../packages/api-server/src/modules/experiments/)
- Harness REST routes: [`packages/api-server/src/apps/harness-api-server/experiment-endpoints.ts`](../../packages/api-server/src/apps/harness-api-server/experiment-endpoints.ts)
- Python SDK: [`packages/experiment-sdk/`](../../packages/experiment-sdk/)
- Authoring kit staged in the image: [`packages/agents/claude-code/dam-skills/`](../../packages/agents/claude-code/dam-skills/)
- Shared kinded-create rail: [`packages/api-server/src/modules/agents/services/kinded-agent-create.ts`](../../packages/api-server/src/modules/agents/services/kinded-agent-create.ts)
- UI destination: [`packages/ui/src/modules/experiments/`](../../packages/ui/src/modules/experiments/)
