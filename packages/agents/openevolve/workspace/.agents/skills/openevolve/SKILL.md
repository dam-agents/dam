---
name: openevolve
description: >-
  Run OpenEvolve, the evolutionary coding agent, to optimize code against a
  measurable objective via the `openevolve-run` CLI. Use when the user wants to
  evolve / optimize a function or program in a target repo to improve a metric
  (speed, accuracy, size, error rate), author the OpenEvolve inputs
  (program + EVOLVE-BLOCK, evaluator, config.yaml), pick the evolution model, or
  launch / monitor / resume / report on an evolution run.
---

# OpenEvolve — evolutionary code optimization

OpenEvolve is an open-source AlphaEvolve: an LLM mutates a program, an
**evaluator** scores each variant against an objective, and a MAP-Elites
database keeps a diverse population of the best — iterating until it converges or
hits a budget. It fits objectives that are **measurable as a number**: make a
function faster, more accurate, smaller, lower-error.

> Upstream: https://github.com/algorithmicsuperintelligence/openevolve

## This is an OpenEvolve agent pod

`openevolve-run` is **pre-installed** (on `PATH`); the model endpoint and your
own Claude model are reached through the platform's credential gateway — **no API
key lives in this pod**. Never ask the user for a key, never write one to disk,
never `pip install openevolve` yourself.

Candidate code runs in the OpenEvolve venv (`$OPENEVOLVE_VENV`) — `openevolve` +
numpy only. Install whatever else a run needs (PyPI egress is allowed; `scipy` is
the usual one for numerical work):

```sh
uv pip install --python "$OPENEVOLVE_VENV/bin/python" scipy
```

The venv is ephemeral but the uv cache is on persistent `$HOME`, so reinstall on
resume (fast, from cache). An unavailable import just scores that mutation
`combined_score = 0` and the run continues — so install what the **evolved** code
will reach for up front (e.g. scipy for numerical work), not just the initial
program's imports. See `AGENTS.md` ("Run dependencies").

The pod-level workflow — the mandatory pre-launch gate, per-run directories,
backgrounding runs, resume-on-wake, and the hard guardrails — is defined in this
pod's system context (`AGENTS.md`). **This skill is the setup-and-CLI
reference**; follow `AGENTS.md` for *how* to operate a run in this environment.

## Step 1 — set up the evolution model

The evolution loop calls an **OpenAI-compatible** endpoint that the attached
model-provider connection injects as `OPENAI_BASE_URL` + `OPENAI_API_KEY`.
OpenEvolve does **not** validate model names — a name the endpoint doesn't serve
burns the full retry budget every iteration — so always discover the catalog
first:

```sh
# Through the egress gateway (do NOT bypass the proxy — the gateway injects the
# real credential and authorizes egress to the endpoint host). Strip a trailing
# /v1 first so the path is right whether or not the base already includes it:
base="${OPENAI_BASE_URL%/}"; base="${base%/v1}"
curl -fsS "$base/v1/models" \
  -H "Authorization: Bearer $OPENAI_API_KEY" | jq -r '.data[].id'
```

Pick a **fast** model (cheap — most iterations) and a **strong** model
(occasional higher-quality steps), and write a **weighted ensemble** — this is
OpenEvolve's native task-based model switching. If the endpoint can't list
models, fall back to a pinned known-good id (for IBM LiteLLM: `aws/claude-sonnet-4-6`).

`config.yaml` model section — note the two env-var rules (validated against
`openevolve.config`):

- **`api_base` must be set inside the file** at the `llm` level. Ensemble models
  inherit it at load time; the `--api-base` CLI flag does **not** reach models in
  an `llm.models` list. Write the resolved `$OPENAI_BASE_URL` literally (the
  shell expands it when you generate the file).
- **`api_key` stays the literal `${OPENAI_API_KEY}`.** OpenEvolve interpolates
  `${VAR}` for `api_key` only, at load; the gateway swaps the placeholder for the
  real credential on the wire.

```sh
cat > config.yaml <<YAML
max_iterations: 100              # the agreed TOTAL budget — single source of truth; set to what the user approved
checkpoint_interval: 10          # leave a resumable checkpoint on shorter runs (default 100)
diff_based_evolution: true       # requires EVOLVE-BLOCK markers in program (default)
llm:
  api_base: "${OPENAI_BASE_URL}" # shell-expanded to the literal endpoint URL
  api_key: "\${OPENAI_API_KEY}"  # literal; OpenEvolve interpolates, gateway swaps on the wire
  models:
    - name: "<fast-model-id>"    # high weight — the bulk of iterations
      weight: 0.8
    - name: "<strong-model-id>"  # low weight — occasional higher-quality mutations
      weight: 0.2
evaluator:
  cascade_evaluation: false      # single-stage evaluate(); default true needs evaluate_stage1
  timeout: 120
YAML
```

## Step 2 — author the three inputs

**`program`** — the initial code. Bound the mutable region with markers:

```python
# EVOLVE-BLOCK-START
def solve(x):
    return 0.0   # OpenEvolve rewrites only what's between the markers
# EVOLVE-BLOCK-END
```

Markers are strongly recommended. If you omit them, set `diff_based_evolution:
false` (and keep the file small) — marker-less diff mode wastes iterations on
"No valid diffs found".

**`evaluator`** — `evaluate(program_path) -> dict`. It imports/runs the candidate
and returns a metrics dict that **must include `combined_score`** (a float, by
convention in `[0, 1]`, higher = better). `combined_score` is the single key
OpenEvolve optimizes; **if it's absent, OpenEvolve averages all numeric metrics**
and silently optimizes the wrong thing. Extra metrics are fine for visibility but
only `combined_score` drives selection.

```python
def evaluate(program_path):
    import importlib.util
    spec = importlib.util.spec_from_file_location("cand", program_path)
    cand = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(cand)
    error = measure_error(cand)            # your objective, computed here
    return {"combined_score": 1.0 / (1.0 + error), "error": error}
```

For a cheap pre-filter before the full evaluation, add an `evaluate_stage1` and
set `cascade_evaluation: true`; otherwise keep `cascade_evaluation: false`.

## Step 3 — smoke-eval, then launch (see the pre-launch gate in AGENTS.md)

Before any full run, do a **1–2 iteration smoke-eval** and confirm the evaluator
scores a known input sensibly, then present a cost estimate and get the user's
go-ahead. Then launch backgrounded with an explicit `--output` on the persisted
workspace (see `AGENTS.md`).

## CLI reference

```
openevolve-run <program> <evaluator> -c config.yaml -o <output> -i <N> \
  [-t <target-score>] [--checkpoint <dir>] [-l INFO]
```

| Flag | Meaning |
|---|---|
| `<program> <evaluator>` | positional: initial program file, evaluator file |
| `-c, --config` | config YAML |
| `-o, --output` | output dir — **always** an explicit path on `$OPENEVOLVE_OUTPUT_ROOT`, outside the target repo |
| `-i, --iterations` | iterations **this invocation** runs (not an absolute cap) — **always bound**; config default is 10000 |
| `-t, --target-score` | stop once `combined_score` reaches this |
| `--checkpoint <dir>` | resume full state from `output/checkpoints/checkpoint_<N>` (continues iteration numbering) |
| `-l, --log-level` | `INFO` for the per-iteration progress lines |

> On a `--checkpoint` resume `-i` adds that many **more** iterations, so pass the
> remaining budget (`max_iterations − checkpoint_N`), not the original `-i`.

(`--api-base` / `--primary-model` / `--secondary-model` exist but do **not**
override an `llm.models` ensemble loaded from the config — configure models in
`config.yaml`, per Step 1.)

**Monitoring:** tail `run.log` for `Iteration {n}: ... Metrics: ...` lines and
`Saved checkpoint at iteration {n}`. A run doesn't advance faster because you
look at it — poll infrequently.

## Outputs

Under `<output>/`:
- `best/best_program.*` — the winning variant; `best/best_program_info.json` — its
  metrics (report `combined_score` and the objective metric from here).
- `checkpoints/checkpoint_<N>/` — resumable full state (drives `--checkpoint`).
- `logs/` — run logs.

## Worked example — approximate sin(x) on [0, π]

A self-contained objective: evolve a polynomial to approximate `math.sin` with
minimum mean-squared error. (Also the CI/local smoke fixture — not a user-facing
"demo".)

`program.py`:

```python
import math
# EVOLVE-BLOCK-START
def approx(x):
    return x            # OpenEvolve improves this toward sin(x) on [0, π]
# EVOLVE-BLOCK-END
```

`evaluator.py`:

```python
import importlib.util, math

def evaluate(program_path):
    spec = importlib.util.spec_from_file_location("cand", program_path)
    cand = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(cand)
    xs = [i * math.pi / 50 for i in range(51)]
    mse = sum((cand.approx(x) - math.sin(x)) ** 2 for x in xs) / len(xs)
    return {"combined_score": 1.0 / (1.0 + mse), "mse": mse}
```

Run it (after Step 1 wrote `config.yaml`):

```sh
openevolve-run program.py evaluator.py -c config.yaml -o "$PWD/output" -i 30 -l INFO
```

`combined_score` rises toward 1.0 as `mse` falls; the winner lands in
`output/best/best_program.py`.

## Reporting (and optional PR)

Report from `output/best/best_program_info.json`: the final `combined_score`, the
objective metric, and the evolved code. If the user wants the change landed and a
GitHub connection is granted, open a PR with the evolved file via `gh` — which
works through the connection, never a held token (see `AGENTS.md`).
