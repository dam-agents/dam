---
name: skydiscover
description: >-
  Run SkyDiscover's AdaEvolve and EvoX search strategies via the
  `skydiscover-run` CLI. Use when the user wants to optimize / evolve a
  function, program, or algorithm to improve a metric (speed, accuracy, size,
  error rate), author the SkyDiscover run inputs (evaluator, optional initial
  program with EVOLVE-BLOCK markers), pick the search model, or launch /
  monitor / resume / report on a search run.
---

# SkyDiscover — LLM-driven code & algorithm optimization

SkyDiscover (Berkeley Sky lab) runs LLM-driven search over programs: an LLM
proposes candidate programs, an **evaluator** scores each one, and the search
loops toward better solutions. It fits objectives that are **measurable as a
number**: make a function faster, more accurate, smaller, lower-error — across
open-ended problems (math, systems, algorithm design).

> Upstream: https://github.com/skydiscover-ai/skydiscover

## This is a SkyDiscover agent pod

`skydiscover-run` is **pre-installed** (on `PATH`); the model endpoint and
your own Claude model are reached through the platform's credential gateway —
**no API key lives in this pod**. Never ask the user for a key, never write
one to disk, never `pip install skydiscover` yourself.

The pod is preset to one of SkyDiscover's two own strategies via
`$SKYDISCOVER_SEARCH` (that's what the user picked in the catalog):

| Preset | `--search` | Best at |
|---|---|---|
| AdaEvolve | `adaevolve` | multi-island adaptive search; fast early gains on short budgets (≲50 iterations) |
| EvoX | `evox` | self-evolving search strategy; stronger long-horizon gains (≳50 iterations) |

Both are installed, so you can suggest the other when the budget clearly fits
it — the user decides. The wrapped external backends
(`openevolve|gepa|shinkaevolve|*_native`) are **not** installed here.

Candidate code runs in the SkyDiscover venv (`$SKYDISCOVER_VENV`); numpy and
scipy are pre-baked. Install whatever else a run needs (PyPI egress is
allowed):

```sh
uv pip install --python "$SKYDISCOVER_VENV/bin/python" pandas
```

The venv is ephemeral but the uv cache is on persistent `$HOME`, so reinstall
extras on resume (fast, from cache). Install what the **evolved** code will
reach for up front, not just the initial program's imports.

The pod-level workflow — the mandatory pre-launch gate, per-run directories,
backgrounding runs, resume-on-wake, and the hard guardrails — is defined in
this pod's system context (`AGENTS.md`). **This skill is the setup-and-CLI
reference**; follow `AGENTS.md` for *how* to operate a run in this environment.

## Step 1 — set up the search model

The search loop calls an **OpenAI-compatible** endpoint that the attached
model-provider connection injects as `OPENAI_BASE_URL` + `OPENAI_API_KEY`.
Always discover the catalog first — a model name the endpoint doesn't serve
fails every proposal:

```sh
# Through the egress gateway (do NOT bypass the proxy — the gateway injects the
# real credential and authorizes egress to the endpoint host). Strip a trailing
# /v1 first so the path is right whether or not the base already includes it:
base="${OPENAI_BASE_URL%/}"; base="${base%/v1}"
curl -fsS "$base/v1/models" \
  -H "Authorization: Bearer ${OPENAI_API_KEY:-placeholder}" | jq -r '.data[].id'
```

Then wire the run with three rules:

- **Plain model ids only, always with `--api-base "$base/v1"`** — that routes
  through the OpenAI-compatible client against the injected endpoint.
  Vendor-prefixed ids (`gemini/…`, `anthropic/…`) or a bare `-m` without
  `--api-base` route through vendor SDKs/endpoints that demand keys this pod
  doesn't hold.
- **Export a non-empty key before launching**:
  `export OPENAI_API_KEY="${OPENAI_API_KEY:-placeholder}"`. The injected value
  is often an empty placeholder by design — the gateway overwrites the auth
  header on the wire, but the client refuses to send a request with no key at
  all.
- If the endpoint can't list models, fall back to a pinned known-good id (for
  IBM LiteLLM: `aws/claude-sonnet-4-6` — but see the sampling-params quirk
  below before using it for the loop).

**Known quirk — sampling params:** SkyDiscover's LLM client sends both
`temperature` and `top_p` on every call, and **some** proxied backends
reject that combination with a deterministic 400 ("temperature and top_p
cannot both be specified"). It is per-model, not per-vendor — observed on
IBM LiteLLM: `aws/claude-sonnet-4-6` and `azure/gpt-5.5` reject it,
`aws/claude-opus-5` and the `rits/…` models accept it. So don't trust a
list: **probe the chosen model with a cheap completion passing both
`temperature` and `top_p`** before launching. The retry loop cannot fix a
deterministic 400: if every proposal call fails this way, kill the run and
relaunch on a model that passed the probe. Only reuse `--checkpoint` state
if some iterations actually completed; a run that never got past the first
proposal is cleaner started fresh.

**Known quirk — EvoX's auxiliary models bypass `-m`:** EvoX's label
generation (`gpt-5-mini`) and search-strategy evolution (`gpt-5`) read their
model ids from EvoX's **shipped strategy yaml**
(`site-packages/skydiscover/search/evox/config/search.yaml`), not from
`-m`/`--api-base`. Against an endpoint that doesn't serve those ids you'll
see 403 retry warnings ("setting labels to empty strings", "Failed to
generate search algorithm") — the solution loop keeps going, but the
self-evolving strategy layer is dead, eroding EvoX's long-horizon advantage
over AdaEvolve. **Workaround:** copy the shipped yaml into the task dir,
replace its model ids with endpoint-served ones, and point
`search.database.config_path` at the copy via a run config (`-c
task/config.yaml`) — and the config's `search:` block **must carry
`type: "evox"`**: without it the parser defaults to `topk`, builds the wrong
database-config class, and silently discards `config_path` (the `--search
evox` flag alone doesn't back-fill it and would replace a mismatched
database config wholesale). Verify the fix took — after a couple of
iterations the `gpt-5`/`gpt-5-mini` 403 retries must be gone from the run
log; if they persist, the strategy layer is still on the shipped yaml. Even then the strategy layer's LLM-generated code can
crash on upstream bugs (`name 'EvolveProgram' is not defined`-class errors)
— still non-fatal for the solution loop, but if the run wedges, apply the
stall guardrail (kill + resume from the latest checkpoint). Mention the
degradation when a user picks evox; never kill a run over the warnings
alone.

**Model ensemble** (optional): a weighted mix goes in a config YAML instead of
`-m` — `--api-base` still applies to all of them, so every name must be served
by the endpoint:

```yaml
llm:
  models:
    - name: "<fast-model-id>"
      weight: 0.7
    - name: "<strong-model-id>"
      weight: 0.3
```

Pass it with `-c task/config.yaml`.

## Step 2 — author the run inputs

A run needs an **evaluator** and an **initial program** — both are required
CLI arguments. Keep both under the run's `task/` dir.

**`evaluator.py`** — scores a candidate. SkyDiscover calls
`evaluate(program_path)` and selects on `combined_score` (higher = better):

```python
def evaluate(program_path):
    score = run_and_grade(program_path)   # you define this: run the candidate, measure the objective
    return {
        "combined_score": score,   # THE selection signal
        "artifacts": {},           # optional extras surfaced to the proposal LLM
    }
```

Extra metrics are fine for visibility, but only `combined_score` drives
selection — every evaluator must return it.

**Keep the score discriminating across the whole range you care about.**
`1/(1+MSE)` saturates once MSE ≪ 1 — every good candidate rounds to 1.0000,
late iterations have no gradient, and the search stops searching while still
spending. For convergent numerical objectives prefer a log-scaled error
(e.g. a clamped `-log10(MSE)` mapped to (0, 1]) or minimax error, which stay
discriminating down to machine precision.

**Constrain the candidate space, or the search will cheat.** The search
optimizes the score you wrote, not the task you meant: an evaluator that
scores "approximate sin(x)" without *enforcing* "…as a polynomial" will
happily crown `return math.sin(x)`. Encode every structural constraint as a
hard reject (score 0 with an explanatory `error`) — banned imports/calls,
required form — and treat a **perfect or too-good score as a finding to
verify, never a result to report**: read the winning candidate's source
before trusting it. The Step 3 smoke-eval must include at least one
**cheat case** (the degenerate solution scoring 0), not just the baseline
and a known-good candidate. (The default config enables
cascade evaluation and logs a warning when `evaluate_stage1` is absent —
that's a harmless fallback to direct evaluation; define `evaluate_stage1`
only when you actually want a cheap pre-filter stage.)

**`initial.py`** — the starting program; for a from-scratch problem, a
minimal stub. Bound the mutable region with markers:

```python
# EVOLVE-BLOCK-START
def solve(x):
    return x            # SkyDiscover rewrites only what's between the markers
# EVOLVE-BLOCK-END
```

## Step 3 — smoke-eval, then launch (see the pre-launch gate in AGENTS.md)

Before any full run, smoke-test the evaluator against the initial program and
confirm it scores a known input sensibly:

```sh
cd task && python -c "from evaluator import evaluate; print(evaluate('initial.py'))"
```

Then present a cost estimate, get the user's go-ahead, and launch backgrounded
with `-o` on the persisted workspace (see `AGENTS.md`).

## CLI reference

```
skydiscover-run INITIAL_PROGRAM EVALUATOR --search <type> \
  -i <N> -m <model-id> --api-base <url> -o <dir> \
  [-c <yaml>] [--checkpoint <dir>] [--codebase <dir>]
```

| Flag | Meaning |
|---|---|
| `INITIAL_PROGRAM` | required — the starting program (`EVOLVE-BLOCK` markers; a minimal stub for from-scratch problems) |
| `EVALUATOR` | required — the `evaluate(program_path)` file |
| `--search` | strategy — default to `$SKYDISCOVER_SEARCH` (`adaevolve` or `evox`; unset → `adaevolve`); only those two work in this pod |
| `-i, --iterations` | the run's iteration budget — always bound; on resume, set to the *remainder* of the approved total |
| `-m, --model` | plain model id served by the endpoint (Step 1); an ensemble goes in the config YAML instead |
| `--api-base` | the OpenAI-compatible endpoint (`"$base/v1"`) — **always pass it** in this pod |
| `-o, --output` | output dir — **always** an explicit path on `$SKYDISCOVER_OUTPUT_ROOT`, outside the target repo |
| `-c, --config` | YAML config (model ensemble, `search.*` tuning) — flags win over it |
| `--checkpoint` | resume from a prior `output/checkpoints/checkpoint_<N>` dir |
| `--codebase` | path to a codebase dir — enables agentic generation (the LLM reads/searches it before writing code); costlier per iteration, only with the user's explicit OK |

**Resume:** relaunch with `--checkpoint output/checkpoints/checkpoint_<N>`
(the highest-numbered one). The checkpoint number is the iterations already
done — set `-i` to the approved total minus that, never more; a bigger total
is a budget increase, a new re-gated decision.

**Checkpoint cadence differs by strategy**: `adaevolve` writes one per
iteration; `evox` writes every 10 iterations plus one at run completion —
so a *completed* short evox run has a resume point, but one interrupted
mid-flight before iteration 10 does not. A run interrupted
before its first checkpoint has nothing to resume from — relaunching
restarts from scratch and re-spends the lost iterations, which exceeds the
originally approved spend: say so and get a fresh go-ahead. For short evox
runs, warn up front that a hibernation before iteration 10 loses the run.

**Triage errors by class, not by count.** Deterministic 4xx bodies (403
"team not allowed…", 400 "temperature and top_p…") mean a wrong model or
config — retries can't fix them, rewire and relaunch. Connection-class
errors ("upstream connect error", "no healthy upstream", "connection
timeout") mean the endpoint is unreachable right now — a VPN or network-path
drop, not a config problem: the run's own retries usually ride it out, and a
run that died on them resumes from the latest checkpoint once the endpoint
answers again. Never rewire models over a transient.

**Monitoring:** tail `run.log`; read `output/best/best_program_info.json` and
list `output/checkpoints/` to count completed iterations. Leave the live dashboard (`monitor.enabled`) off and skip
`skydiscover-viewer` — this pod exposes no UI ports. A run doesn't advance
faster because you look at it — poll infrequently, and if it stops advancing,
follow the stall guardrail in `AGENTS.md`.

## Outputs

Under `-o`:
- `best/` — `best_program.py` and `best_program_info.json` (score, iteration,
  lineage): the source of truth for "best so far".
- `checkpoints/checkpoint_<N>/` — the resume points; the numbering is the
  iterations completed.
- `logs/` — the search's own log (your `run.log` mirrors stdout/stderr), plus
  a per-run iteration-stats `.jsonl` at the output root.

## Worked example — approximate sin(x) on [0, π]

A self-contained objective: evolve a polynomial to approximate `math.sin` with
minimum mean-squared error. (Also the CI/local smoke fixture — not a
user-facing "demo".)

`task/initial.py`:

```python
# EVOLVE-BLOCK-START
def approx(x):
    return x            # SkyDiscover improves this toward sin(x) on [0, π]
# EVOLVE-BLOCK-END
```

`task/evaluator.py`:

```python
import importlib.util
import math

def evaluate(program_path):
    spec = importlib.util.spec_from_file_location("candidate", program_path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    xs = [i * math.pi / 50 for i in range(51)]
    mse = sum((mod.approx(x) - math.sin(x)) ** 2 for x in xs) / len(xs)
    return {"combined_score": 1.0 / (1.0 + mse)}
```

Run it (after Step 1 resolved `$base` and a model id):

```sh
export OPENAI_API_KEY="${OPENAI_API_KEY:-placeholder}"
skydiscover-run task/initial.py task/evaluator.py \
  --search "${SKYDISCOVER_SEARCH:-adaevolve}" \
  -i 10 -m <model-id> --api-base "$base/v1" \
  -o "$SKYDISCOVER_OUTPUT_ROOT/sin-approx/output"
```

`combined_score` rises toward 1.0 as the MSE falls; pull the winner from
`output/best/best_program.py`.

## Reporting (and optional PR)

Report the best candidate's `combined_score`, the objective metric, and the
evolved code (from `output/best/`). If the user wants the change landed
and a GitHub connection is granted, open a PR with the evolved file via `gh` —
which works through the connection, never a held token (see `AGENTS.md`).
