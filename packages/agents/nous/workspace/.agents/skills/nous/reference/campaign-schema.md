# Campaign.yaml — full field reference

This is a curated copy of `nous schema campaign`. The **live CLI output is
authoritative** — run `nous schema campaign` (or `--format yaml`/`--format json`)
to confirm against the installed version before relying on a field. Unknown
top-level properties are rejected.

There are two other artifact schemas: `nous schema bundle` (a DESIGN hypothesis
bundle) and `nous schema findings` (EXECUTE_ANALYZE results).

## Required fields

- **`research_question`** _string_ — the guiding, falsifiable question.
- **`target_system`** _object_
  - `name` _string_ (required) — human-readable system name.
  - `description` _string_ (required) — **this field is substituted into the
    LLM's prompts.** Put all domain context here: architecture, exact paths,
    baselines, data-schema gotchas, statistical guardrails.
  - `repo_path` _string|null_ — target git repo; experiments run in isolated
    worktrees off it.
  - `observable_metrics` _array_ — measurable outputs (latency, throughput, error rate).
  - `controllable_knobs` _array_ — what can be changed (algorithms, configs, limits).
  - `live_target` _bool_ — if true, run directly in `repo_path` with **no**
    per-iteration worktree. For probing a running system/dataset with no code to
    evolve; bundles must contain no `code_changes` arms.
  - `worktree_extras` _array_ — relative paths to symlink into each experiment
    worktree (gitignored assets the executor needs: venvs, prefetched data,
    build artifacts, prior-iteration outputs).
- **`prompts`** _object_
  - `methodology_layer` _string_ (required) — path to generic Nous methodology prompts.
  - `domain_adapter_layer` _string|null_ — **NOT IMPLEMENTED (#89).** Setting it
    warns and is ignored. Put domain context in `target_system.description` instead.

## Spec-fidelity (front-load these for defensible, auto-approvable runs)

- **`locked_parameters`** _object_ — `key: value` knobs hard-pinned for the
  campaign. Each MUST appear identically in `bundle.experiment_spec.verified_parameters`;
  mismatch is a hard validation failure **regardless of `--auto-approve`**.
  Idiomatic keys: `model`, `concurrency_per_tenant`, `duration_seconds`,
  `warmup_seconds`, `total_kv_blocks`, plus anything whose deviation invalidates
  the experiment.
- **`locked_workload`** _object_ — canonical workload structure that
  `bundle.inputs/<workload>.yaml` must match (per-tenant input/output
  distributions, concurrency). Same hard-fail semantics. Deliberate deviations
  require `bundle.workload_changes_from_canonical`.
- **`ground_truth`** _object_ — pre-registered, immutable claim:
  `direction_claim`, `pass_condition`, `primary_metric`, `baselines`, `seeds`,
  `workload`, `pre_registered`. Rendered into the agent's prompt so it can't move goalposts.
- **`theory_references`** _array_ — external theorems/laws/identities used to
  ground the ground truth (the "independent thermometer").

## Iteration & scheduling

- **`max_iterations`** _int_ — cap (default 10; CLI `--max-iterations` overrides).
- **`iterations`** _array_ — per-iteration overrides consulted by index. v1
  supports `mode`: `rehearsal` (minimal-scope apparatus + feasibility check,
  surfaces friction as `brief_amendments.md`) vs `real` (full run). Idiom:
  iter-1 rehearsal, iter-2+ real.
- **`max_turns`** _object_ — per-phase tool-use turn cap: `design` (default 80),
  `execute_analyze` (default 120), `report` (default 25).

## Models & SDK

- **`models`** _object_ — per-phase model: `design` (default `claude-opus-4-6`),
  `execute_analyze` (default `claude-sonnet-4-6`), `report` (default `claude-sonnet-4-6`).
  **In this pod, do not rely on those defaults** — the model gateway fronts an
  upstream whose catalog usually doesn't include them, and a missing model hangs
  the run. Always set `models` explicitly to gateway-served IDs; see "Selecting
  models" in `SKILL.md`.
- **`sandbox`** _string_ — `bypass` (default; needed because campaigns write
  outside the launched cwd) or `default` (only if the campaign lives entirely
  under the launched cwd — rare).
- **`sdk_options`** _object_ — per-phase reasoning effort (`design`,
  `execute_analyze`); omit to use SDK default ("high").
- **`sdk_timeouts`** _object_ — `silence_threshold_seconds` (default 600) and
  `turn_silence_threshold_seconds` (scalar or per-phase map
  `{design:600, execute_analyze:120, report:240}`) for the hung-subprocess watchdog.

## Async notifications (channels)

- **`channels`** _array_ — **Phase A (Phase B reply-parsing planned).** Route
  human gate notifications to external platforms. Each iteration, at each gate
  (DESIGN and FINDINGS), Nous posts a markdown summary card so reviewers can
  monitor progress without sitting at the terminal. The gate still blocks on
  terminal input (Phase B will accept Slack replies). Configuration:

  ```yaml
  channels:
    - kind: slack
      webhook_url: https://hooks.slack.com/services/YOUR/WEBHOOK/URL
    
    - kind: webhook
      url: https://example.com/nous/gate
      headers:
        Authorization: Bearer YOUR_TOKEN
  ```
  
  - `slack` — POST to Slack webhook (`text` field contains markdown).
  - `webhook` — generic HTTP POST (`{"markdown": "..."}` body + custom headers).
  - Best-effort: timeouts, 5xx, DNS failures log warnings but **do NOT** break
    the gate or campaign. Notification is supplemental.

## Scoring & reproducibility

- **`objective`** _object_ — composite scoring: `weights` (metric→weight, sum 1.0),
  `metric_extractors`, `deploy_threshold` (default 0.1). Drives the deployment
  recommendation in `meta_findings.json`.
- **`objective_preset`** _string_ — `compound-return-style` | `latency-style`
  (mutually exclusive with `objective`).
- **`plot_specs`** _array_ — declarative figure scripts run after `findings.json`;
  read `NOUS_RESULTS_DIR`, write `NOUS_FIGURES_DIR`.
- **`pre_work_script`** _string_ — deterministic exploration run before iter-1
  DESIGN; stdout JSON → `pre_work.json` context for the designer.
- **`reproducibility_metadata`** _object_ — **auto-populated at INIT** (repo
  commit, hardware-config sha, language versions, lockfile shas, gpu mem util).
  User-readable, not user-set; to pin a commit, check it out before running.

## Knowledge inheritance & misc

- **`warm_start`** _object_ — inherit `principles.json` + `handoff.md` from a
  prior campaign on the same repo (`prior_run_id`), with drift detection.
- **`derived_from`** _object_ — inherit a prior campaign's worktree code state
  (`campaign`, `iteration`=`final` or N) by applying its `cumulative.patch` as a
  preflight to every experiment worktree.
- **`validation`** _object_ — `iter_root_extensions` (extra allowed files at iter
  root) and `required_iter_root` (files that MUST exist after EXECUTE_ANALYZE).
- **`metadata`** _object_ — user tags/goal, copied to the work dir at init.
- **`run_id`** _string_ — work-dir name (CLI `--run-id` overrides).

---

## Starter campaign.yaml (annotated)

```yaml
research_question: >
  With total input length held fixed, does increasing the cached prefix portion
  reduce TTFT under moderate load?

run_id: blis-fast
max_iterations: 2

target_system:
  name: "BLIS — LLM Inference Serving Simulator"
  description: >
    BLIS is a discrete-event simulator for LLM inference serving. It models
    request arrivals, scheduling, and KV-cache management. Baselines, exact CLI
    args, metric definitions, and statistical guardrails go here.
  repo_path: ./repo
  observable_metrics: [ttft, throughput, p95_latency]
  controllable_knobs: [prefix_fraction, concurrency, cache_policy]

# Schedule a cheap rehearsal first, then the real run.
iterations:
  - mode: rehearsal
  - mode: real

# Hard-pin everything whose deviation would invalidate the experiment.
locked_parameters:
  model: meta-llama/Llama-3-8B
  concurrency_per_tenant: 8
  duration_seconds: 120
  warmup_seconds: 20
  total_kv_blocks: 4096

ground_truth:
  pre_registered: true
  primary_metric: "P50(ttft)"
  direction_claim: "P50(ttft) decreases as prefix_fraction increases at fixed total length"
  pass_condition: "direction holds in median across 10 seeds AND in >=7 of 10 seeds"
  seeds: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]

# Pin to gateway-served IDs — discover them, don't trust the defaults above
# (see "Selecting models" in SKILL.md). IDs here are illustrative.
models:
  design: "claude/aws/claude-opus-4-8"
  execute_analyze: "claude/aws/claude-sonnet-4-6"
  report: "claude/aws/claude-sonnet-4-6"

prompts:
  methodology_layer: "prompts/methodology"
  domain_adapter_layer: null
```
