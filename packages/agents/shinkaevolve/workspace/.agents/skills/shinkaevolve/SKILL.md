---
name: shinkaevolve
description: >-
  Run ShinkaEvolve, the sample-efficient evolutionary program-optimization
  framework, via the `shinka_run` CLI. Use when the user wants to evolve /
  optimize a function, program, or algorithm in a target repo to improve a
  metric (speed, accuracy, size, error rate), author the ShinkaEvolve task
  inputs (initial program + EVOLVE-BLOCK, evaluate.py), pick the evolution
  model, or launch / monitor / resume / report on an evolution run.
---

# ShinkaEvolve — evolutionary program optimization

ShinkaEvolve (Sakana AI) pairs LLMs with evolutionary search: an ensemble of
LLMs proposes program mutations, an **evaluator** scores each candidate, and
island archives keep a diverse population of the best — iterating for a budget
of generations. It fits objectives that are **measurable as a number**: make a
function faster, more accurate, smaller, lower-error.

> Upstream: https://github.com/SakanaAI/ShinkaEvolve

## This is a ShinkaEvolve agent pod

`shinka_run` is **pre-installed** (on `PATH`); the model endpoint and your own
Claude model are reached through the platform's credential gateway — **no API
key lives in this pod**. Never ask the user for a key, never write one to disk,
never `pip install shinka-evolve` yourself.

Candidate code runs in the ShinkaEvolve venv (`$SHINKA_VENV`). Install whatever
else a run needs (PyPI egress is allowed; `scipy` is the usual one for
numerical work):

```sh
uv pip install --python "$SHINKA_VENV/bin/python" scipy
```

The venv is ephemeral but the uv cache is on persistent `$HOME`, so reinstall
on resume (fast, from cache). Install what the **evolved** code will reach for
up front, not just the initial program's imports.

The pod-level workflow — the mandatory pre-launch gate, per-run directories,
backgrounding runs, resume-on-wake, and the hard guardrails — is defined in
this pod's system context (`AGENTS.md`). **This skill is the setup-and-CLI
reference**; follow `AGENTS.md` for *how* to operate a run in this environment.

## Step 1 — set up the evolution models

The evolution loop calls an **OpenAI-compatible** endpoint that the attached
model-provider connection injects as `OPENAI_BASE_URL` + `OPENAI_API_KEY`.
Always discover the catalog first — a model name the endpoint doesn't serve
fails every mutation:

```sh
# Through the egress gateway (do NOT bypass the proxy — the gateway injects the
# real credential and authorizes egress to the endpoint host). Strip a trailing
# /v1 first so the path is right whether or not the base already includes it:
base="${OPENAI_BASE_URL%/}"; base="${base%/v1}"
curl -fsS "$base/v1/models" \
  -H "Authorization: Bearer $OPENAI_API_KEY" | jq -r '.data[].id'
```

Then write each chosen model as a **`local/` model ID** — this is the only
format that works in this pod (three rules baked into it):

```
local/<model-id>@${base}/v1?api_key_env=OPENAI_API_KEY
```

- `local/` routes through ShinkaEvolve's OpenAI-compatible provider using
  **chat-completions** — bare vendor names (`gpt-5-mini`, …) route through
  vendor SDKs that demand vendor keys, and the native OpenAI provider uses the
  Responses API, which proxies typically don't serve.
- `?api_key_env=OPENAI_API_KEY` makes it send the injected key; the gateway
  swaps the placeholder for the real credential on the wire.
- Shell-expand `${base}` when you compose the flag — the URL must be literal.

Pass an **ensemble** (a fast model plus an occasional strong one) as a JSON
list; ShinkaEvolve's bandit sampler learns which model earns its cost. If the
endpoint can't list models, fall back to a pinned known-good id (for IBM
LiteLLM: `aws/claude-sonnet-4-6`).

Two settings that must never stay on their defaults here:

- `evo.llm_models` — defaults to OpenAI/Gemini names that fail startup
  validation without vendor keys. Always set it to your `local/` IDs.
- `evo.embedding_model` — defaults to `text-embedding-3-small` (OpenAI).
  Disable it (`--set evo.embedding_model=null`; also disables the
  embedding-based novelty gate), or point it at an embedding model the
  endpoint actually serves, using the same `local/` format.

(`evo.meta_llm_models` / `evo.prompt_llm_models` enable optional meta-analysis
and prompt-evolution roles — off unless explicitly set; if you set them, use
`local/` IDs there too.)

## Step 2 — author the task directory

A task dir holds exactly two required files: `initial.<ext>` and `evaluate.py`.

**`initial.<ext>`** — the starting program. Bound the mutable region with
markers and keep a stable entrypoint the evaluator calls:

```python
# EVOLVE-BLOCK-START
def advanced_algo():
    return 0.0, ""        # ShinkaEvolve rewrites only what's between the markers
# EVOLVE-BLOCK-END

def run_experiment(random_seed=None, **kwargs):
    """Entrypoint the evaluator calls; keep its signature stable."""
    return advanced_algo()
```

Python is the default; ShinkaEvolve also evolves go / julia / fortran / cpp /
cuda / rust / swift / json candidates (`--set evo.language=<lang>` and a
matching `initial.<ext>`; the evaluator then runs the candidate via
`subprocess` and writes `metrics.json` + `correct.json` itself).

**`evaluate.py`** — scores a candidate. For Python candidates, call
`run_shinka_eval` (it handles importing the candidate, repeat runs, and
persisting results where the evolution loop expects them):

```python
import argparse
from shinka.core import run_shinka_eval

def get_kwargs(run_idx):
    return {"random_seed": run_idx}

def aggregate_fn(results):
    scores = [r[0] for r in results]
    return {
        "combined_score": sum(scores) / len(scores),  # THE selection signal
        "public": {},       # metrics shown to the mutation LLM
        "private": {},      # metrics kept out of the LLM prompt
        "extra_data": {},
        "text_feedback": "",
    }

def main(program_path, results_dir):
    metrics, correct, err = run_shinka_eval(
        program_path=program_path,
        results_dir=results_dir,
        experiment_fn_name="run_experiment",
        num_runs=1,
        get_experiment_kwargs=get_kwargs,
        aggregate_metrics_fn=aggregate_fn,
    )

if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--program_path", required=True)
    p.add_argument("--results_dir", required=True)
    a = p.parse_args()
    main(a.program_path, a.results_dir)
```

`combined_score` (higher = better) is what selection ranks on; extra metrics
are fine for visibility but only `combined_score` drives the archive.

## Step 3 — smoke-eval, then launch (see the pre-launch gate in AGENTS.md)

Before any full run, smoke-test the evaluator against the initial program and
confirm it scores a known input sensibly:

```sh
python evaluate.py --program_path task/initial.py --results_dir /tmp/smoke
```

Then present a cost estimate, get the user's go-ahead, and launch backgrounded
with `--results_dir` on the persisted workspace (see `AGENTS.md`).

## CLI reference

```
shinka_run --task-dir <dir> --results_dir <dir> --num_generations <N> \
  [--set <ns>.<field>=<value> ...] [--config-fname <yaml>] \
  [--max-evaluation-jobs <n>] [--max-proposal-jobs <n>] [--max-db-workers <n>]
```

| Flag | Meaning |
|---|---|
| `--task-dir` | dir containing `evaluate.py` + `initial.<ext>` |
| `--results_dir` | output dir — **always** an explicit path on `$SHINKA_OUTPUT_ROOT`, outside the target repo; reusing it **resumes** the run |
| `--num_generations` | the run's **total** generation budget (`0..N-1`) — always bound; authoritative over any config |
| `--set ns.field=value` | repeatable overrides; namespaces `evo` / `db` / `job`; lists/dicts as JSON, `null` clears an optional field |
| `--config-fname` | YAML with the same `evo`/`db`/`job` namespaces — use for long values (e.g. a multiline `evo.task_sys_msg`) instead of shell-escaping |
| `--max-evaluation-jobs` / `--max-proposal-jobs` | concurrency of evaluations / LLM proposals |

Precedence: YAML < `--set` < `--results_dir` / `--num_generations` (always
authoritative).

Useful `--set` knobs: `evo.task_sys_msg='<task-specific guidance for the
mutation LLM>'` (the highest-leverage lever — refine it between batches from
what the run learned), `evo.language=<lang>`, `db.num_islands=<n>`.

**Resume:** relaunching the identical command detects `programs.sqlite` in
`--results_dir`, restores the population, and runs only the generations still
missing from the total — so pass the same `--num_generations` on resume; a
bigger number is a budget increase, a new re-gated decision.

**Monitoring:** tail `run.log`; count persisted generations with
`sqlite3 results/programs.sqlite 'SELECT COUNT(DISTINCT generation) FROM programs;'`
(inspect the schema with `.tables` / `.schema` first — it's an internal
format). A run doesn't advance faster because you look at it — poll
infrequently, and if it stops advancing, follow the stall guardrail in
`AGENTS.md`.

## Outputs

Under `--results_dir`:
- `programs.sqlite` — the population: every candidate with its metrics and
  lineage. The best program = the row with the highest `combined_score`.
- Per-generation folders — each holds the candidate `main.<ext>` and its
  evaluation `results/` (metrics, correctness).
- `prompts.sqlite` — prompt-evolution state (when enabled).

## Worked example — approximate sin(x) on [0, π]

A self-contained objective: evolve a polynomial to approximate `math.sin` with
minimum mean-squared error. (Also the CI/local smoke fixture — not a
user-facing "demo".)

`task/initial.py`:

```python
import math

# EVOLVE-BLOCK-START
def approx(x):
    return x            # ShinkaEvolve improves this toward sin(x) on [0, π]
# EVOLVE-BLOCK-END

def run_experiment(random_seed=None, **kwargs):
    xs = [i * math.pi / 50 for i in range(51)]
    mse = sum((approx(x) - math.sin(x)) ** 2 for x in xs) / len(xs)
    return 1.0 / (1.0 + mse), f"mse={mse:.6f}"
```

`task/evaluate.py`: the Step 2 template verbatim (its `aggregate_fn` averages
the returned scores into `combined_score`).

Run it (after Step 1 resolved `$base` and a model id):

```sh
shinka_run --task-dir task --results_dir results --num_generations 10 \
  --set evo.llm_models='["local/<model-id>@'"$base"'/v1?api_key_env=OPENAI_API_KEY"]' \
  --set evo.embedding_model=null
```

`combined_score` rises toward 1.0 as the MSE falls; pull the winner from
`programs.sqlite`.

## Reporting (and optional PR)

Report the best candidate's `combined_score`, the objective metric, and the
evolved code (from the top-scoring row in `programs.sqlite`, or its
generation folder's `main.<ext>`). If the user wants the change landed and a
GitHub connection is granted, open a PR with the evolved file via `gh` — which
works through the connection, never a held token (see `AGENTS.md`).
