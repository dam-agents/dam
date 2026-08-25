# Nous output guide — for the driver that evaluates campaigns

How a Nous worker structures its results on disk, so a driver script (or the
sandbox agent judging a finished campaign) can extract outcomes reliably —
did the optimization work, by how much, confirmed across how many seeds.

**Driver framing.** These paths live inside the *worker* pod, and the worker
is reaped right after it reports. Anything not carried out in the
`report_result` payload or published as an artifact is gone. So use this
guide to write the spawn prompt: name the exact files the worker must read,
the stable fields it must report, and the artifacts it must publish
(`report.md`, `meta_findings.json`, per-iteration `findings.json`) before
finishing.

**Demand publish-as-you-go.** The prompt must require each iteration's
`findings.json` (and raw results worth keeping) to be published as artifacts
**the moment the iteration completes** — never only at the end. A worker can
die mid-campaign (TTL, OOM, a starved node, an inactivity reap; all three have
happened) and everything unpublished dies with it.

**Always demand the per-seed numbers.** The experiment's score chart plots
one point per seed, not per campaign (a run chains one or two campaigns —
per-round scoring draws a single dot), and the pass condition is itself
per-seed ("≥ 2/3 seeds"). The driver cannot fetch them later: the raw files
in §1b are the only exact source, their metric keys and filenames are
campaign-specific, and the pod holding them is gone. So make the prompt ask
for a normalized array — `{seed, baseline, treatment}` per seed of the
confirming iteration, in the metric's own unit — read from those raw files
and **not** from `report.md`'s prose or summary table, which are free text
and have been observed to disagree with the raw numbers.

There is **no central stats database**. Results are file-based in two tiers:

1. **Per-campaign artifacts** — raw, complete, campaign-specific schema.
   Root: `$NOUS_CAMPAIGN_PARENT/<run_id>/` (typically `~/nous-campaigns/<run_id>/`).
2. **Cross-campaign wiki** — distilled, portable, stable schema.
   Root: `~/.nous/wiki/`.

Use tier 2 for stable cross-run queries; drop to tier 1 when you need raw
per-seed numbers.

## 0. Discovery

```bash
# All campaigns (each has a state.json + campaign.yaml):
ls -d "$NOUS_CAMPAIGN_PARENT"/*/          # or: find "$NOUS_CAMPAIGN_PARENT" -name state.json

# Only fully-indexed campaigns (harvested into the wiki):
jq -r '.projects[].campaigns[].name' ~/.nous/wiki/registry.json
```

Check completion state before evaluating:

```bash
nous status <run_id> --line      # e.g. "... · DONE · iter 4 · 3 done / 1 failed · 7 principles"
```

A campaign is finished when the phase is `DONE`. `X done / Y failed` tells
you how many iterations produced findings vs. failed (failures are usually
infrastructure — see §6).

## 1. Per-campaign layout (`$NOUS_CAMPAIGN_PARENT/<run_id>/`)

| Path | What it is | Schema stability |
|---|---|---|
| `campaign.yaml` | The experiment definition: `research_question`, `locked_parameters`, `ground_truth` (pre-registered `primary_metric`, `direction_claim`, `pass_condition`, `seeds`), `observable_metrics`. | Stable (see `nous schema campaign`) |
| `state.json` | Orchestrator checkpoint: current `phase`, `iteration`. | Stable |
| `ledger.json` | One row per iteration: `family`, `h_main_result`, `prediction_accuracy`, `principles_extracted`, `status`/`error`. | Stable |
| `best_found.json` | Objective scores (`top_k[]`). | Stable |
| `meta_findings.json` | Cross-iteration synthesis + deployment `recommendation`. | Stable |
| `principles.json` | Extracted, reusable findings (quantitative claims live here). | Stable |
| `report.md` | Human-readable final report. | Prose |
| `runs/iter-<N>/findings.json` | Per-iteration results + verdict per arm. | **Stable keys**, free-text values |
| `runs/iter-<N>/results/<arm>/*.json` | **Raw per-seed measurements.** | **Campaign-specific** ⚠️ |
| `runs/iter-<N>/bundle.yaml` | The hypothesis (5 arms) + experiment plan for that iteration. | Stable-ish |
| `runs/iter-<N>/patches/*.patch` | The code change tested by each arm (the actual diff). | git patch |
| `llm_metrics.jsonl`, `llm_metrics_summary.json` | Token/cost accounting (NOT perf). | Stable |
| `retry_log.jsonl` | Infra retries (gateway/SDK). Use to distinguish real failure from flakiness. | Stable |

### 1a. `runs/iter-<N>/findings.json` — the stable verdict contract

Top-level keys: `arms`, `iteration`, `experiment_valid`,
`dominant_component_pct`, `discrepancy_analysis`, `bundle_ref`.

Each `arms[]` entry:

```json
{
  "arm_type": "h-main",              // h-main | h-ablation | h-super-additivity | h-control-negative | h-robustness (+ campaign-specific, e.g. h-dose-response)
  "predicted": "…free text…",
  "observed":  "…free text with numbers, e.g. 'baseline p50 41.245ms -> treatment 0.090ms, ratio 457x, 10/10 seeds' …",
  "status":    "CONFIRMED",          // CONFIRMED | REFUTED | PARTIALLY_CONFIRMED
  "error_type": null,
  "diagnostic_note": "…"
}
```

**Judge outcomes off `status`** (a clean enum). `observed`/`predicted` embed
the numbers but are natural language — do not regex them for critical logic;
prefer the raw results (§1b) for exact values. Authoritative schema:
`nous schema findings`.

### 1b. `runs/iter-<N>/results/<arm>/*.json` — raw per-seed measurements

Richest quantitative source. One file = one measured condition. Filenames
follow an executor-chosen convention, commonly `<baseline|treatment>-s<seed>.json`
(plus a `smoke.json` warmup). Example from the TCP_NODELAY campaign:

```json
{
  "mode": "rtt", "seed": 1, "nodelay": "both",
  "applied": { "server": true, "client": true },
  "payload_bytes": 1, "writes_per_exchange": 4, "gap_ms": 0, "iters": 200,
  "interactive_rtt_p50_ms": 0.092672, "interactive_rtt_p95_ms": 0.221303,
  "interactive_rtt_mean_ms": 0.119769, "interactive_rtt_min_ms": 0.072587,
  "interactive_rtt_max_ms": 0.726414
}
```

> ⚠️ **The metric keys, filenames, and arm folder names are campaign-specific.**
> The executor designs the measurement harness per campaign, so one campaign
> emits `interactive_rtt_p50_ms`, another `setup_latency_p50_ms` /
> `relay_throughput_mb_s`. **Do not hardcode metric names.** Instead:
>
> - Read `campaign.yaml → target_system.observable_metrics` and
>   `ground_truth.primary_metric` to learn which metric matters and its
>   direction (`ground_truth.direction_claim`, `pass_condition`).
> - Discover numeric fields dynamically (any key ending `_ms`, `_mb_s`,
>   `_p50`, etc.).
> - Group by the condition marker in the filename/body (`baseline` vs
>   `treatment`, `nodelay: off|both`, `applied`) and by `seed`.

### 1c. `best_found.json` — objective scores

```json
{ "top_k": [ { "candidate_id": "iter-2/h-main/0", "score": 1.0,
              "components": { "status": 1.0 }, "iteration": 2, "arm_id": "h-main" } ],
  "k": 5, "updated_at": "…" }
```

`score` is the campaign's `objective` composite (higher = better). Use it to
rank candidates across iterations.

## 2. Cross-campaign wiki (`~/.nous/wiki/`) — stable schema, best for aggregate eval

| Path | Contents |
|---|---|
| `registry.json` | Index of every indexed campaign: `projects[repo].campaigns[]` → `research_question`, `concepts[]`, `parameters[]`, `principles[]` (IDs), `frontiers[]`, `interactions[]`; plus project-level `entities[]` and `entity_clusters[]`. **Start here to enumerate.** |
| `campaigns/<run_id>/principles.json` | Quantitative claims in a consistent schema: `statement`, `confidence` (high/medium/low), `regime`, `mechanism`, `applicability_bounds`, `status`. |
| `campaigns/<run_id>/concepts.json` | Knowledge graph. `parameters[].evolution[]` = tuned-knob trajectory: `{iter, value, outcome, note}`. |
| `campaigns/<run_id>/summaries.json` | Per-iteration `{what_was_tried, what_was_found, why_it_matters}`. |
| `campaigns/<run_id>/frontiers.json` | Untested boundaries (next-experiment candidates). |
| `campaigns/<run_id>/interactions.json` | Untested combinations of confirmed approaches. |
| `campaigns/<run_id>/dead-ends.json` | Refuted approaches (empty if none). |
| `campaigns/<run_id>/summary.md` | Narrative digest. |
| `viz/<run_id>.html` | Interactive knowledge-graph visualization. |

The wiki `principles.json` is the most reliable place to read a portable,
human-and-machine digestible statement of "what worked and by how much"
without touching raw seed files.

## 3. Recommended evaluation procedure

1. **Enumerate** finished campaigns: `registry.json` (indexed) or glob
   `state.json` + check `DONE`.
2. **Read the pre-registration**: `campaign.yaml → research_question`,
   `ground_truth` (`primary_metric`, `direction_claim`, `pass_condition`,
   `seeds`), `observable_metrics`. This is the goalpost — the campaign
   committed to it before running.
3. **Pass/fail per arm**: `runs/iter-*/findings.json → arms[].status`
   (+ `best_found.json` for ranked scores). This is the stable contract.
4. **Exact effect size**: parse `runs/iter-*/results/<arm>/*.json`,
   discovering metric keys dynamically; compute your own
   baseline-vs-treatment deltas per seed and the seed pass count, then check
   against `ground_truth.pass_condition`.
5. **Portable claim + confidence**: wiki `campaigns/<run_id>/principles.json`.
6. **Cost context** (optional): `nous cost <run_id> --cache-stats`.

## 4. Outcome vocabulary

- Arm `status`: `CONFIRMED`, `REFUTED`, `PARTIALLY_CONFIRMED`.
- Ledger `h_main_result`: same enum (or `null` for baseline / failed iterations).
- Iteration `status`: absent = normal; `"FAILED"` with an `error` field = did
  not complete.

## 5. CLI accessors (no file parsing needed)

```bash
nous status  <run_id> --line     # phase / iteration / done-failed / principles
nous cost    <run_id> --cache-stats
nous reports <run_id>            # regenerate meta_findings deterministically (0 tokens)
nous schema  findings            # authoritative findings.json schema (also: campaign, bundle)
nous lineage <run_id>            # per-iteration derivation chain + cumulative.patch availability
```

## 6. Gotchas for an evaluator

- **Failed iterations exist.** An iteration can fail on infrastructure
  (gateway `>60s silence`, API errors) and produce **no `findings.json` and
  only partial `results/`**. Skip them; they are not scientific refutations.
  Confirm via `ledger.json` (`status: FAILED`) and `retry_log.jsonl`.
- **`results/` schema is not a contract** (see §1b). `findings.json[].status`,
  `best_found.json`, `ledger.json`, and wiki `principles.json` ARE stable —
  prefer them.
- **`observed`/`predicted`/`report.md` are free text.** Extract numbers from
  raw `results/` files, not from prose, when precision matters.
- **Rehearsal vs real.** iter-1 is often `mode: rehearsal` (fewer `iters`,
  calibration). Weight real iterations; the rehearsal may be
  `PARTIALLY_CONFIRMED` by design. A rehearsal can legitimately carry
  `score: 0.0` in `best_found.json` while the log reads as a win — the
  scientific claim is deferred to the multi-seed iteration.
- **Loopback caveat.** Measurements are typically on `127.0.0.1`; absolute
  numbers reflect loopback, not WAN. Effect *direction/ratio* is the
  transferable result. Frontiers files flag where this was and wasn't tested.
- **Seeds & thresholds.** `pass_condition` usually requires the effect in
  most seeds (≥2/3, ≥8/10 — read it off `ground_truth`, don't assume the
  denominator) AND a bounded regression on a guard metric — evaluate both,
  not just the median.
