---
name: nous
description: >-
  Drive Nous, the hypothesis-driven experimentation framework, to investigate
  software systems with the scientific method via the `nous` CLI. Use when the
  user wants to run a Nous campaign, author or scaffold a campaign.yaml, kick
  off / monitor / resume / stop / report on hypothesis-driven experiments, or
  systematically investigate why a system (LLM server, DB optimizer, scheduler,
  router, cache) behaves the way it does through controlled experiments.
---

# Nous — hypothesis-driven experimentation

Nous runs the **scientific method on software systems**. An AI planner formulates
falsifiable hypotheses about a target system, designs controlled experiments,
an executor runs them, and Nous extracts reusable **principles** from the
results — whether the hypothesis is confirmed or refuted. Knowledge accumulates
across iterations so the same mistake is not repeated.

It fits systems with **observable metrics, controllable knobs, reproducible
execution, and decomposable mechanisms**: LLM serving, query optimizers,
schedulers, routers, caches, load balancers.

> Repo: https://github.com/AI-native-Systems-Research/agentic-strategy-evolution

## This is a Nous agent pod

`nous` is **pre-installed** in this pod (pinned, on `PATH`) and `claude` is
authenticated through the platform's credential gateway — Nous's Claude Agent
SDK calls work **with no API key in this pod**. Never ask the user for a
credential, never write one to disk, and never `pip install` Nous yourself.

The pod-level workflow (per-campaign directories, unique run ids, always
`--auto-approve`, running campaigns in the background, resume-on-restart) is
defined in this pod's system context (`AGENTS.md`). **This skill is the CLI and
campaign-authoring reference**; follow `AGENTS.md` for *how* to drive a campaign
in this environment.

## The loop

Each iteration is a deterministic state machine; the LLM only acts inside the
phases, never the orchestration:

```
INIT → DESIGN → HUMAN_DESIGN_GATE → EXECUTE_ANALYZE → HUMAN_FINDINGS_GATE → DONE → (next iteration)
```

- **DESIGN** (planner, Opus by default) — authors a `bundle.yaml`: a hypothesis
  with multiple falsifiable arms (see below) plus an experiment plan.
- **HUMAN_DESIGN_GATE** — approve the design before expensive compute runs.
- **EXECUTE_ANALYZE** (executor, Sonnet by default) — runs each arm in an
  isolated git worktree, collects metrics, classifies prediction errors.
- **HUMAN_FINDINGS_GATE** — approve findings before they enter the knowledge base.

This pod always runs `--auto-approve` (both gates auto-pass) so campaigns run
unattended to completion. Front-loading `locked_parameters` is what keeps a run
defensible — see below.

## Quick start (full workflow)

```bash
# 0. Verify the CLI (already installed and gateway-authenticated here).
nous --help

# NOTE: NOUS_CAMPAIGN_PARENT is already exported in this pod (campaign artifacts
# land on the persistent $HOME). Per AGENTS.md, give each campaign its own
# directory under it and clone the target repo inside that directory.

# 1. Scaffold a heavily-commented starting campaign.
nous create-campaign --to ./campaign.yaml \
  --target-name "Your System" \
  --research-question "What mechanism drives the primary bottleneck?" \
  --target-repo-path ./repo

# 2. (Edit campaign.yaml — see "Authoring a campaign" below, and `nous schema`.)
nous schema campaign            # authoritative field reference

# 3. Run it (auto-approve; backgrounded per AGENTS.md).
nous run campaign.yaml --auto-approve --max-iterations 3

# 4. Watch progress live.
nous status campaign.yaml --watch

# 5. After it finishes: report, cost, and a paper-grade artifact tarball.
nous report campaign.yaml
nous cost   campaign.yaml --cache-stats
nous package campaign.yaml
```

## Worked example: a BLIS campaign end-to-end

A concrete campaign against **BLIS** (the `inference-sim` discrete-event
LLM-serving simulator) — the whole arc: clone, author, run, then harvest the
findings into the wiki.

```bash
# 1. Per-campaign dir + clone the target into it (see AGENTS.md for the convention).
run_id="blis-prefix-ttft"
dir="$NOUS_CAMPAIGN_PARENT/$run_id"
mkdir -p "$dir"
git clone https://github.com/inference-sim/inference-sim.git "$dir/repo"   # BLIS
```

`$dir/campaign.yaml`:

```yaml
research_question: >
  With total input length held fixed, does increasing the prefix portion
  (cached tokens) reduce TTFT under moderate load?

run_id: blis-prefix-ttft
max_iterations: 2

target_system:
  name: "BLIS — LLM Inference Serving Simulator"
  description: >
    BLIS is a discrete-event simulator for LLM inference serving.
    It models request arrivals, scheduling, and KV-cache management.
  repo_path: /home/agent/nous-campaigns/blis-prefix-ttft/repo   # the clone above (absolute)
  # Declare what the target emits — omitting this makes DESIGN burn extra Opus
  # time exploring the repo to discover the metrics.
  observable_metrics: [ttft_p50_ms, throughput, scheduling_delay_p99_ms]
  controllable_knobs: [prefix_fraction, concurrency, cache_policy]

# Cheap rehearsal first (apparatus + regime sanity), then the full real matrix —
# catches parse/regime issues before paying for the whole seed sweep.
iterations:
  - mode: rehearsal
  - mode: real

# Required for this pod's auto-approved runs — hard-pin what would invalidate the
# experiment (see "Authoring a campaign"). Without it the run refuses to start.
locked_parameters:
  model: meta-llama/Llama-3-8B
  concurrency_per_tenant: 8
  duration_seconds: 120
  warmup_seconds: 20

ground_truth:
  pre_registered: true
  primary_metric: "P50(ttft)"
  direction_claim: "P50(ttft) decreases as prefix fraction increases at fixed total length"
  pass_condition: "direction holds in median across seeds AND in >=7 of 10 seeds"
  seeds: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]

# Pin models the GATEWAY serves — discover them, don't trust Nous's defaults
# (which usually aren't in the catalog, and a missing model hangs the run).
# These IDs are illustrative; resolve the real ones per "Selecting models".
models:
  design: "claude/aws/claude-opus-4-8"            # opus
  execute_analyze: "claude/aws/claude-sonnet-4-6" # sonnet
  report: "claude/aws/claude-sonnet-4-6"          # sonnet

prompts:
  methodology_layer: "prompts/methodology"
  domain_adapter_layer: null
```

```bash
# 2. Run it auto-approved, in the background (see AGENTS.md), and follow progress.
cd "$dir"
nohup nous run campaign.yaml --auto-approve --max-iterations 2 > campaign.log 2>&1 &
echo $! > run.pid
nous status "$run_id" --watch

# 3. When it finishes, harvest the findings into the wiki (see "Post-campaign knowledge").
/post-campaign "$dir"
```

## Authoring a campaign

`nous schema campaign` is the single source of truth. The **minimal** required
shape:

```yaml
research_question: >
  One falsifiable sentence. e.g. "With total input length fixed, does increasing
  the cached prefix portion reduce TTFT under moderate load?"

run_id: my-campaign           # working-dir name under $NOUS_CAMPAIGN_PARENT
max_iterations: 2

target_system:
  name: "My System"
  description: >              # THIS field is substituted into the LLM's prompts.
    What the system does, its architecture, exact paths, baselines, data-schema
    gotchas, and statistical guardrails. Put domain context HERE.
  repo_path: ./repo           # experiments run in isolated worktrees off this
  observable_metrics: [latency, throughput, error_rate]   # optional, auto-discovered if omitted
  controllable_knobs: [batch_size, cache_policy]          # optional

prompts:
  methodology_layer: "prompts/methodology"   # generic Nous methodology prompts
  domain_adapter_layer: null                 # NOT IMPLEMENTED — leave null; put domain context in target_system.description
```

Key authoring discipline (see [`reference/campaign-schema.md`](reference/campaign-schema.md) for the full field list):

- **`locked_parameters`** / **`locked_workload`** — hard-pin every knob whose
  deviation would invalidate the experiment (model, concurrency, duration,
  warmup, KV blocks, workload distributions). Mismatches are hard validation
  failures **even under `--auto-approve`**. In this pod every campaign runs
  auto-approved, so this inventory is mandatory — a campaign with no
  `locked_parameters` will refuse to run. Front-load it; adding locks reactively
  after each review round turns a 2-week campaign into a 5-round dance.
- **`iterations: [{mode: rehearsal}, {mode: real}]`** — schedule iter-1 as a
  cheap *rehearsal* (does the apparatus parse? does the regime engage the
  mechanism?) and iter-2+ as full *real* runs.
- **`live_target: true`** (under `target_system`) — for probing a *running*
  system (cluster, service, non-git dataset) with no code to evolve. No
  per-iteration worktree; bundles must contain no `code_changes` arms. The
  target must be reachable from this pod's egress rules.
- **`ground_truth`** — pre-register `direction_claim`, `pass_condition`,
  `primary_metric`, and `seeds` before any iteration so the agent can't move the goalposts.
- **`models`** — **always set this explicitly** (see below). Per-phase:
  `design`, `execute_analyze`, `report`.

### Selecting models (don't trust the defaults)

Nous's built-in defaults are `claude-opus-4-6` / `claude-sonnet-4-6`, but the
model gateway in this pod fronts a specific upstream whose catalog usually
**doesn't** include those exact IDs — and a campaign that requests a model the
gateway can't serve **hangs**. So discover the catalog and pin `models:` to it:

```sh
# Newest opus + sonnet the gateway resolves (exported into this harness's env):
echo "opus=$ANTHROPIC_DEFAULT_OPUS_MODEL  sonnet=$ANTHROPIC_DEFAULT_SONNET_MODEL"
# Authoritative full catalog (works even if those vars are unset):
curl --noproxy '*' -fsS 'http://127.0.0.1:24180/v1/models?limit=1000' | jq -r '.data[].id'
```

Use the IDs **verbatim** (they may be namespaced, e.g.
`claude/aws/claude-opus-4-8`): `design` → newest **opus**, `execute_analyze` and
`report` → newest **sonnet**. If a tier is absent, fall back to the most capable
model the catalog does list (opus → sonnet → anything).

### Author *with* the user (assume they're a Nous beginner)

Assume the user has never run a Nous campaign and doesn't know its knobs. **Don't
silently pick everything and launch** — propose, explain briefly, confirm, then
run. A good flow:

1. **Gather what you can decide yourself.** Read
   [`reference/campaign-schema.md`](reference/campaign-schema.md) for the full
   field set, and discover the gateway model catalog (above, "Selecting models")
   so you already know which model IDs are usable — never make the user supply a
   model. Skim the target repo for likely `observable_metrics` /
   `controllable_knobs`.
2. **Draft a full `campaign.yaml` from what you inferred** — research question,
   `target_system.description`, gateway-served `models`, a rehearsal+real
   `iterations` schedule, and a first pass at `locked_parameters`.
3. **Ask the user to make the vague parts concrete**, in plain language and one
   short round — e.g. *how many real iterations* (more = more confidence, more
   cost/time), *how long each run / how many seeds*, *which knob they actually
   care about*, *which parameters must stay fixed*. Explain the tradeoff behind
   each question rather than dumping schema jargon on them.
4. **Show the final `campaign.yaml` and get an explicit go-ahead before
   `nous run`.** Call out the rough cost/time and the model IDs you pinned. Never
   launch a campaign the user hasn't seen and confirmed.

## The five hypothesis arms

Every DESIGN bundle tests one mechanism from multiple angles:

| Arm | Purpose |
|---|---|
| `H-main` | Validates the primary mechanism |
| `H-ablation` | Isolates individual component contributions |
| `H-super-additivity` | Detects interaction effects between components |
| `H-control-negative` | Confirms specificity (the effect shouldn't appear here) |
| `H-robustness` | Tests generalization across conditions |

Fast-fail rules skip wasted compute on ablations/robustness when `H-main` is refuted.

## Running, monitoring, controlling

```bash
# Unattended run — REQUIRES locked_parameters declared (safety precondition).
# The only mode in this pod; NOUS_ALLOW_AUTO_APPROVE=1 is set in the image.
nous run campaign.yaml --auto-approve --max-iterations 10 --timeout 1800 --max-cli-retries 50

# Skip DESIGN with a pre-authored hypothesis bundle.
nous run campaign.yaml --bundle ./bundle.yaml --auto-approve

# Resume an interrupted campaign (timeout/crash/pod restart) at the last checkpoint.
nous resume campaign.yaml --auto-approve

# Live status (STUCK marker after ~5 min silence); single-line for prompts.
nous status campaign.yaml --watch
nous status campaign.yaml --line

# Halt a running campaign cleanly at the next phase boundary.
nous stop campaign.yaml --reason "regime looks wrong"
nous stop campaign.yaml --immediate     # abort mid-turn within seconds

# Cost / cache analytics, regenerate the report.
nous cost   campaign.yaml --cache-stats
nous report campaign.yaml
```

Notes:
- `--agent sdk` is the **default** backend (Claude Agent SDK, gateway-authenticated
  here). `--agent inline` emits prompts to stdout for an enclosing agent framework.
- Default per-phase timeout is 1800s (30 min); `--max-cli-retries` default 10,
  `-1` = unbounded.
- If `--auto-approve` refuses to proceed, the run is missing required
  `locked_parameters` — declare the locks first. (`NOUS_ALLOW_AUTO_APPROVE=1` is
  already set in this image, so that gate is not the cause here.)

**Reading liveness (don't be fooled):** `nous status --line` gives phase/iteration;
for fine-grained progress watch the executor log mtime under `runs/iter-N/` (e.g.
`runs/iter-N/inputs/executor_log.jsonl`) and the result-file count — they advance
continuously during EXECUTE_ANALYZE. A backgrounded run's `campaign.log` only
writes at phase transitions, so it looks frozen mid-phase — don't read "no new log
lines" as "stuck". The `STUCK` marker is a ~5-min-silence heuristic that fires
during legitimate long batches: treat it as "look closer", not "it died". Phases
are long (DESIGN ~10–15 min) — poll infrequently with wide spacing; looking more
often doesn't make it go faster.

## Reporting progress to Slack/Telegram (the channel bridge)

Nous's native `channels:` feature POSTs a markdown summary at every DESIGN/FINDINGS
gate — and it fires under `--auto-approve` (the notify runs before the gate
auto-passes), so it serves as unattended progress reporting. In this pod, don't
point it at an external webhook (that needs egress allowlisting + a secret on
disk); point it at the in-pod **channel bridge**, which relays each summary to
the agent's bound Slack/Telegram thread via the platform's `send_channel_message`
— no external egress, no secret.

The agent wires this in **automatically when a channel is bound** to the agent
(it checks `describe_channel` before each run); you don't have to ask. See
`AGENTS.md` for the operate-in-this-pod steps (incl. resume-on-restart).

One bridge serves the whole pod — it's stateless per request (each POST carries
its own `channel` + text and does a fresh MCP call), so every campaign and
session shares the single `127.0.0.1:8765` listener. Launches are idempotent and
a duplicate start is a harmless no-op (the bridge exits cleanly if the port is
already taken). Bridges in *other* agent pods are isolated — `127.0.0.1` is
pod-local, and each posts only to its own agent's bound channel.

```bash
# Start the shared bridge (idempotent — one per pod):
nohup nous-channel-bridge > "$NOUS_CAMPAIGN_PARENT/.bridge.log" 2>&1 &
```

```yaml
# …then in campaign.yaml (channel=slack or channel=telegram to match the binding):
channels:
  - kind: webhook
    url: http://127.0.0.1:8765/gate?channel=slack
```

How it holds together: `NO_PROXY=127.0.0.1` (set in the image) keeps Nous's POST
local; the bridge's own call to the MCP endpoint routes back out through the
egress gateway and is authorized by the pod's mesh identity (no token). Delivery
is best-effort — a hiccup logs a warning and never blocks the campaign. See
`AGENTS.md` for the operate-in-this-pod steps (incl. resume-on-restart).

## Output artifacts

Under `$NOUS_CAMPAIGN_PARENT/<run_id>/`:

- `state.json` — orchestrator checkpoint (drives `resume`)
- `principles.json` — accumulated, reusable knowledge across iterations
- `ledger.json` — decision/event ledger; `handoff.md` — human-readable summary
- `runs/iter-N/bundle.yaml` — the iteration's hypothesis + experiment plan
- `runs/iter-N/findings.json` — results, validation, prediction-error taxonomy
- `meta_findings.json` — cross-iteration synthesis & deployment recommendation

## Post-campaign knowledge (the wiki)

When a campaign finishes, harvest its `ledger.json` / `principles.json` into a
cross-campaign **wiki** at `~/.nous/wiki/` so knowledge compounds across runs.
These are Claude Code slash commands shipped with this agent (in
`~/.claude/commands/`); the rendering scripts live at `~/scripts/`:

```bash
# Extract knowledge, index it into the registry, generate an interactive HTML viz.
/post-campaign ~/nous-campaigns/<run_id>

# Re-render one campaign's interactive HTML knowledge graph.
/visualize-campaign <campaign-name>

# Render the cross-campaign knowledge graph — campaigns, entities, concepts,
# entity clusters, heuristic opportunity scores. Deterministic, no LLM calls.
/visualize-registry

# Recommend high-value next experiments from everything indexed so far.
/suggest-next <repo-path-or-name> "your research question"
```

The wiki commands turn raw `ledger.json` / `principles.json` into structured
knowledge — **dead-ends** (refuted approaches), **frontiers** (boundary
conditions), and untested **interactions** — plus interactive HTML
visualizations. Knowledge **compounds**: `/suggest-next` draws on findings from
*all* indexed campaigns to point the next campaign at the highest-value open
questions.

> The viz commands invoke `python scripts/<name>.py`; run them from `$HOME`
> (where the shipped `scripts/` live) or call `~/scripts/<name>.py` directly.
> The scripts read/write only under `~/.nous/wiki/`.

## Full CLI surface (13 subcommands)

Run `nous <cmd> --help` for exact flags. Grouped by purpose:

**Lifecycle — run & control**
- `nous run <campaign>` — run end-to-end. Flags: `--max-iterations`, `--model`,
  `--run-id`, `--auto-approve`, `--timeout` (default 1800s), `--max-cli-retries`
  (default 10, `-1`=unbounded), `--agent {sdk,inline}` (default `sdk`),
  `--sandbox {bypass,default}`, `--bundle` (skip DESIGN), `--problem-md`, `--handoff-md`.
- `nous resume <target>` — pick up an interrupted run at the last checkpoint
  (`--max-iterations`, `--model`, `--auto-approve`, `--timeout`, `--max-cli-retries`, `--agent`).
- `nous stop <target>` — halt cleanly at the next phase boundary; `--reason`,
  `--immediate` (abort mid-turn within seconds).

**Author & inspect**
- `nous create-campaign --to <path>` — scaffold a commented `campaign.yaml`
  (`--target-name`, `--target-description`, `--research-question`, `--run-id`,
  `--target-repo-path`, `--force`).
- `nous schema [campaign|bundle|findings]` — print the authoritative artifact
  schema (`--format {md,json,yaml}`).
- `nous validate {design|execution} --dir <DIR>` — validate a work-dir against
  the schema (the same gate the orchestrator runs internally).

**Monitor & report**
- `nous status <target>` — phase/iteration/principles snapshot; `--watch`,
  `--line`, `--interval`.
- `nous cost <target>` — token/cost totals; `--cache-stats` for cache hit-rate.
- `nous report <target>` — (re)generate the **LLM** markdown findings report
  (`--model`, `--agent`, `--timeout`; costs tokens).
- `nous reports <target>` — re-emit `meta_findings.json` **deterministically,
  zero LLM tokens**; works on legacy/aborted runs. (Note the trailing `s` — different command.)

**Provenance & reproducibility**
- `nous lineage <target>` — derivation chain + per-iteration `cumulative.patch`
  availability (what `derived_from` inherited); `--json`.
- `nous replay <target> --iter <N>` — replay a specific recorded iteration from its artifacts.
- `nous package <target>` — tarball work_dir + `reproduce.sh` + Dockerfile +
  README for paper artifact evaluation; `--output`.

**Housekeeping**
- `nous clean` — remove stale `nous-exp-*` worktrees/branches. `--orphaned`
  (default: prune worktrees whose owning run is dead), `--target-repo`,
  `--campaign`, `--dry-run`.

`<target>` is generally a `campaign.yaml`, a work_dir, or a `run_id` resolvable
under `$NOUS_CAMPAIGN_PARENT`.

## When NOT to use Nous

Skip it for one-off tweaks, systems with no observable metrics, or
non-reproducible environments. Nous pays off when the question is a real
*mechanism* question and you want defensible, cumulative findings.
