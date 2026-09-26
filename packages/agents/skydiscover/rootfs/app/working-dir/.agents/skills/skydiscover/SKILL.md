---
name: skydiscover
description: >-
  Run SkyDiscover's AdaEvolve and EvoX search strategies via the
  `skydiscover optimize` CLI. Use when the user wants to optimize / evolve a
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

`skydiscover` is **pre-installed** (on `PATH`); its `optimize` subcommand
runs the search. The model endpoint and your own Claude model are reached
through the platform's credential gateway — **no API key lives in this pod**.
Never ask the user for a key, never write one to disk, never
`pip install skydiscover` yourself.

The CLI's other subcommands are not for this pod: `skydiscover viewer` needs a
UI port the pod doesn't expose, and **never run `skydiscover init`** — it is
SkyDiscover's separate Synthesize module, and it writes a skill, agent roles
and hooks into the project's `.claude/` (your own Claude Code config).

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

- **Pass `-m "openai/<id>"` for an id the endpoint lists, always with
  `--api-base "$base/v1"`.** SkyDiscover reads the part before the first `/`
  as a provider: it strips a provider it knows (`openai`, `azure`, `gemini`,
  `anthropic`, `mistral`, `vllm` and a few more) and sends the rest. The `openai/` prefix makes it send the listed
  id verbatim (`openai/aws/claude-sonnet-4-6` goes out as
  `aws/claude-sonnet-4-6`) to `--api-base`, with `OPENAI_API_KEY`. Without
  it, a listed id like `azure/gpt-5` goes out as `gpt-5` and fails every
  proposal with a 403. One `Unknown model '<id>': no provider matched`
  warning at startup is harmless: it comes from printing the active models,
  after the prefix is gone. Without `--api-base`, an id SkyDiscover can't place
  refuses to start ("requires an explicit api_base"), and one it can place
  (`gpt-…`, `claude-…`, `gemini-…`) goes to that vendor's public API instead
  of the injected endpoint.
- **Export a non-empty key before launching**:
  `export OPENAI_API_KEY="${OPENAI_API_KEY:-placeholder}"`. The injected value
  is often an empty placeholder by design — the gateway overwrites the auth
  header on the wire, but the client refuses to send a request with no key at
  all.
- If the endpoint can't list models, fall back to a pinned known-good id (for
  IBM LiteLLM: `-m openai/aws/claude-sonnet-4-6`).

**Sampling params:** at the pinned ref SkyDiscover sends `top_p` only when
a config explicitly sets it (upstream fixed the old always-send-both
behavior that used to 400 on Bedrock-hosted Claude) — so there is no
temperature+top_p conflict to probe for and no per-model denylist. A
deterministic 4xx on sampling params can still happen two ways: a config
YAML that sets `top_p` explicitly (the old conflict returns on some
backends — leave it unset), or a model family that rejects `temperature`
outright (reasoning models). Retries never fix a deterministic 4xx: adjust
the config or switch models. Only reuse `--checkpoint` state if some
iterations actually completed; a run that never got past the first proposal
is cleaner started fresh.

**EvoX's auxiliary models bypass `-m` by default:** EvoX's label
generation (`gpt-5-mini`) and search-strategy evolution (`gpt-5`) read their
model ids from EvoX's shipped strategy yaml, not from `-m`, and call them on
`$OPENAI_BASE_URL`. If Step 1's catalog doesn't list both ids, EvoX probes
them at startup, logs "Guide LLM (label generation) at … is not reachable"
and "Meta-search LLM (search strategy evolution) at … is not reachable", and
runs without its self-evolving strategy layer — the solution loop keeps
going, but that erodes EvoX's long-horizon advantage over AdaEvolve. **Fix:**
launch evox with a run config (`-c task/config.yaml`) that makes the strategy
layer use the `-m` models:

```yaml
search:
  type: "evox"
  share_llm: true
```

Verify it took: neither "is not reachable" warning may appear in `run.log`.
Even then the strategy layer's LLM-generated code can fail validation or
crash on upstream bugs ("Failed to generate search algorithm",
"Search-strategy evolution failed … continuing with the current strategy")
— non-fatal for the solution loop, but if the run wedges, apply the stall
guardrail (kill + resume from the latest checkpoint). Mention the
degradation when a user picks evox; never kill a run over the warnings
alone.

**Model ensemble** (optional): a weighted mix goes in a config YAML instead of
`-m` — `--api-base` still applies to all of them, so every name must be served
by the endpoint, with the same `openai/` prefix:

```yaml
llm:
  models:
    - name: "openai/<fast-model-id>"
      weight: 0.7
    - name: "openai/<strong-model-id>"
      weight: 0.3
```

Pass it with `-c task/config.yaml`.

## Step 2 — author the run inputs

A run needs an **evaluator**; an **initial program** is optional on the CLI
(omitting it takes the from-scratch path) — but in this pod author one
anyway, even a minimal stub, so the search starts from a known baseline and
the smoke-eval has something to score. Keep both under the run's `task/`
dir.

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
cd task && "$SKYDISCOVER_VENV/bin/python" -c "from evaluator import evaluate; print(evaluate('initial.py'))"
```

Then present a cost estimate, get the user's go-ahead, and launch backgrounded
with `-o` on the persisted workspace (see `AGENTS.md`).

## CLI reference

```
skydiscover optimize [INITIAL_PROGRAM] EVALUATOR --search <type> \
  -i <N> -m openai/<model-id> --api-base <url> -o <dir> \
  [-c <yaml>] [--checkpoint <dir>] [--agentic]
```

| Flag | Meaning |
|---|---|
| `INITIAL_PROGRAM` | optional on the CLI (omitting it takes the from-scratch path) — but author one anyway in this pod, even a minimal stub, so the smoke-eval has a baseline (`EVOLVE-BLOCK` markers) |
| `EVALUATOR` | required — the `evaluate(program_path)` file |
| `--search` | strategy — default to `$SKYDISCOVER_SEARCH` (`adaevolve` or `evox`; unset → `adaevolve`); only those two work in this pod |
| `-i, --iterations` | the run's iteration budget — always bound; on resume, set to the *remainder* of the approved total |
| `-m, --model` | `openai/<id>` for an id the endpoint serves (Step 1); an ensemble goes in the config YAML instead |
| `--api-base` | the OpenAI-compatible endpoint (`"$base/v1"`) — **always pass it** in this pod |
| `-o, --output` | output dir — **always** an explicit path on `$SKYDISCOVER_OUTPUT_ROOT`, outside the target repo |
| `-c, --config` | YAML config (model ensemble, `search.*` tuning, `checkpoint_interval`) — flags win over it |
| `--checkpoint` | resume from a prior `output/checkpoints/checkpoint_<N>` dir |
| `--agentic` | off by default; see below |

**Agentic mode (`--agentic`)** turns each proposal into a short tool loop:
before it answers, the model can call `read_file` and `search` (a regex grep)
over the codebase root — the initial program's directory, or
`agentic.codebase_root` in the config (point it at the run's `repo/` clone
when the evolved code depends on the code around it). Each tool round is
one more LLM call, up to `agentic.max_steps` (default 5) per proposal, so
count that in the cost estimate. Leave it off unless the target needs that
context.

**Resume:** relaunch with `--checkpoint output/checkpoints/checkpoint_<N>`
(the highest-numbered one). The checkpoint number is the iterations already
done — set `-i` to the approved total minus that, never more; a bigger total
is a budget increase, a new re-gated decision.

**Checkpoint cadence**: both strategies write one every
`checkpoint_interval` iterations (default 10) plus one at run completion —
so a *completed* short run has a resume point, but one interrupted
mid-flight before iteration 10 does not. A run interrupted
before its first checkpoint has nothing to resume from — relaunching
restarts from scratch and re-spends the lost iterations, which exceeds the
originally approved spend: say so and get a fresh go-ahead. For short runs,
warn up front that a hibernation before iteration 10 loses the run (a
config's `checkpoint_interval: 1` gives a resume point per iteration).

**Triage errors by class, not by count.** Deterministic 4xx bodies (403
"team not allowed…", 400 unsupported-parameter — e.g. `temperature` on a
reasoning model, or an explicitly configured `top_p` on some backends) mean
a wrong model or config — retries can't fix them, rewire and relaunch. Connection-class
errors ("upstream connect error", "no healthy upstream", "connection
timeout") mean the endpoint is unreachable right now — a VPN or network-path
drop, not a config problem: the run's own retries usually ride it out, and a
run that died on them resumes from the latest checkpoint once the endpoint
answers again. Never rewire models over a transient.

**Monitoring:** tail `run.log`; read `output/best/best_program_info.json` and
list `output/checkpoints/` to count completed iterations. Leave the live dashboard (`monitor.enabled`) off and skip
`skydiscover viewer` — this pod exposes no UI ports. A run doesn't advance
faster because you look at it — poll infrequently, and if it stops advancing,
follow the stall guardrail in `AGENTS.md`.

## Outputs

Under `-o`:
- `best/` — `best_program.py` and `best_program_info.json` (score, iteration,
  lineage): the source of truth for "best so far".
- `checkpoints/checkpoint_<N>/` — the resume points; the numbering is the
  iterations completed.
- `logs/` — the search's own log (your `run.log` mirrors stdout/stderr).
  AdaEvolve also writes an iteration-stats `.jsonl` at the output root; EvoX
  keeps its strategy-evolution state under `search/`.

## Worked example — approximate sin(x) on [0, π]

A self-contained objective: evolve a polynomial to approximate `math.sin`
with minimum mean-squared error — with the guard sections above applied: a
structural gate (or the search just returns `math.sin(x)`) and a log-scaled
score (or every good candidate saturates to 1.0).

`task/initial.py`:

```python
# EVOLVE-BLOCK-START
def approx(x):
    return x            # SkyDiscover improves this toward sin(x) on [0, π]
# EVOLVE-BLOCK-END
```

`task/evaluator.py`:

```python
import ast
import math

def evaluate(program_path):
    src = open(program_path).read()
    # hard gate: pure arithmetic only — no imports, attributes, or calls,
    # or the winning move is simply `return math.sin(x)`
    for node in ast.walk(ast.parse(src)):
        if isinstance(node, (ast.Import, ast.ImportFrom, ast.Attribute, ast.Call)):
            return {"combined_score": 0.0, "error": "not a pure polynomial"}
    # single namespace: separate globals/locals would hide module-level
    # constants from function bodies (hoisted coefficients → silent NameError)
    ns = {"__builtins__": {}}
    exec(compile(src, program_path, "exec"), ns)
    xs = [i * math.pi / 50 for i in range(51)]
    mse = sum((ns["approx"](x) - math.sin(x)) ** 2 for x in xs) / len(xs)
    # log-scaled: still discriminating at mse ~1e-22, where 1/(1+mse) is 1.0
    score = (min(max(-math.log10(mse), -1.0), 30.0) + 1.0) / 31.0 if mse > 0 else 1.0
    return {"combined_score": score, "mse": mse}
```

Smoke-eval with the mandatory cheat case (must score 0) next to the baseline:

```sh
cd task && "$SKYDISCOVER_VENV/bin/python" -c "
from evaluator import evaluate
print('baseline:', evaluate('initial.py'))
open('/tmp/cheat.py','w').write('import math\ndef approx(x):\n    return math.sin(x)\n')
print('cheat   :', evaluate('/tmp/cheat.py'))"
```

Run it (with the model id Step 1 picked; launch it backgrounded, per
`AGENTS.md`):

```sh
base="${OPENAI_BASE_URL%/}"; base="${base%/v1}"
export OPENAI_API_KEY="${OPENAI_API_KEY:-placeholder}"
skydiscover optimize task/initial.py task/evaluator.py \
  --search "${SKYDISCOVER_SEARCH:-adaevolve}" \
  -i 10 -m "openai/<model-id>" --api-base "$base/v1" \
  -o "$SKYDISCOVER_OUTPUT_ROOT/sin-approx/output"
```

`combined_score` climbs with every decade of MSE improvement (no
saturation); pull the winner from `output/best/best_program.py` — and read
it before trusting it, per the guard section.

## Reporting (and optional PR)

Report the best candidate's `combined_score`, the objective metric, and the
evolved code (from `output/best/`). If the user wants the change landed
and a GitHub connection is granted, open a PR with the evolved file via `gh` —
which works through the connection, never a held token (see `AGENTS.md`).
