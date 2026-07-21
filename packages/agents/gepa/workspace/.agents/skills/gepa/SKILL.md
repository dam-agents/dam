---
name: gepa
description: >-
  Run GEPA (Genetic-Pareto), the reflective text-optimization library, by
  authoring Python driver scripts around `gepa.optimize`. Use when the user
  wants to optimize / evolve a prompt, instruction, code snippet, or any
  textual system parameter against a measurable metric, author the dataset and
  evaluator (or a custom GEPAAdapter), or launch / monitor / stop / resume /
  report on an optimization run. Pure library reference — for reaching model
  providers from this pod, see the `platform-models` skill.
---

# GEPA — reflective text optimization

GEPA (Genetic-Pareto) evolves the text components of a system against a
metric: a **task model** executes each candidate on training examples, an
**evaluator** scores the results, and a **reflection model** reads the full
traces to diagnose failures and propose improved text — while a Pareto
frontier keeps the best candidates across rounds. It fits objectives that are
**measurable as a number**: answer accuracy, rubric scores, error rates.

> Upstream: https://github.com/gepa-ai/gepa — pinned PyPI release in
> `$GEPA_VENV`
> (`python -c 'from importlib.metadata import version; print(version("gepa"))'`
> for the exact version; this reference is written against 0.1.4).

**GEPA has no CLI — it is a library.** Every run is a `driver.py` you author
that calls `gepa.optimize(...)`, run with the venv `python` (first on
`PATH`); never `pip install gepa` yourself, it's pre-installed.

**This skill is the pure library reference.** Everything platform-specific
lives elsewhere: how this pod reaches model providers (credentials, gateway,
probing) is the **`platform-models` skill**; how to operate runs in this pod
(pre-launch gate, run directories, backgrounding, resume-on-wake, guardrails,
extra venv deps) is the pod's system context (**`AGENTS.md`**).

## Step 1 — pick the two models

GEPA talks to models through **LiteLLM**: `task_lm` and `reflection_lm` are
LiteLLM model strings (e.g. `openai/<id>`, `anthropic/<id>`) — or plain
Python callables, which is how tests stub them out (see the worked example).

**Pick two different models on purpose**: `task_lm` runs once per (candidate
× example) — cheap and fast wins; `reflection_lm` runs once per iteration and
does the actual reasoning — use the strongest model available.

How to discover which providers/models this pod can reach, wire the
credentials, and probe both models before writing the driver is defined in
the **`platform-models` skill** — follow it now, then come back with a
working `task_lm` + `reflection_lm` (+ `reflection_lm_kwargs`).

## Step 2 — author the driver

### Path A: prompt optimization with the built-in `DefaultAdapter`

No adapter code needed. Supply `task_lm`, a dataset, and (optionally) an
evaluator; the single component of `seed_candidate` becomes the **system
prompt** the task model runs with. Dataset items are dicts with exactly these
keys:

```python
{"input": "<user message>", "answer": "<expected answer>", "additional_context": {}}
```

The default evaluator (`ContainsAnswerEvaluator`) scores 1.0 when `answer`
appears verbatim in the response — fine for extraction/QA tasks. For anything
else, pass a custom `evaluator` callable returning an `EvaluationResult`;
**rich `feedback` text is what the reflection model learns from**, so say
*why* the score is what it is:

```python
from gepa.adapters.default_adapter.default_adapter import EvaluationResult

def evaluator(data, response: str) -> EvaluationResult:
    score = ...  # 0.0 – 1.0, higher is better
    return EvaluationResult(score=score, feedback="<why this score>")
```

A minimal driver:

```python
import gepa
# ... model wiring per the platform-models skill ...

result = gepa.optimize(
    seed_candidate={"system_prompt": "<the starting prompt>"},
    trainset=trainset,            # list of dataset items (reflection minibatches)
    valset=valset,                # held-out items (Pareto scores); defaults to trainset
    task_lm=task_lm,
    evaluator=evaluator,          # omit for ContainsAnswerEvaluator
    reflection_lm=reflection_lm,
    reflection_lm_kwargs=reflection_lm_kwargs,
    max_metric_calls=300,         # THE budget — what the user approved
    run_dir="run_dir",            # checkpoint/resume + gepa.stop sentinel
    display_progress_bar=False,   # tqdm garbles nohup logs
)
print(result.best_candidate)
print(result.val_aggregate_scores[result.best_idx])
```

As few as ~3 training examples work to start; 10–50 with a held-out `valset`
is the comfortable range.

**Reflection reads only the `trainset` — `valset` only scores.** A failure
mode that appears solely in held-out validation examples never enters the
reflective feedback, so GEPA cannot fix it (worse: with a perfectly-scoring
trainset, `skip_perfect_score` skips proposals entirely and the run idles to
its budget). Put an example of **every failure mode you want optimized** into
the `trainset`; keep `valset` for honest measurement.

### Path B: anything else — a custom `GEPAAdapter`

To optimize text inside a *system you run yourself* (an agent's instructions,
a pipeline's code snippet, a config), author a `GEPAAdapter` subclass with two
methods, then pass `adapter=` **instead of** `task_lm`/`evaluator`:

- `evaluate(batch, candidate, capture_traces)` — instantiate the system with
  the candidate's texts, run it on the batch, return an `EvaluationBatch` of
  scores + outputs (+ trajectories when `capture_traces=True`).
- `make_reflective_dataset(candidate, eval_batch, components_to_update)` —
  distill the trajectories into `{"Inputs", "Generated Outputs", "Feedback"}`
  records the reflection model reads.

Crib from the shipped adapters in `gepa/adapters/` (`default_adapter`,
`generic_rag_adapter`, `dspy_adapter`, `langchain_adapter`, `mcp_adapter`,
`terminal_bench_adapter`, …) — read them from the installed package:
`python -c "import gepa, os; print(os.path.dirname(gepa.__file__))"`.
`seed_candidate` may hold **multiple named components**; GEPA evolves them
round-robin. There is also `gepa.optimize_anything.optimize_anything`, a
single-metric convenience wrapper for free-form text artifacts.

## Step 3 — smoke-eval, then launch

Before any full run, score the **seed candidate** on a couple of examples
without optimizing, and confirm the baseline looks sensible to the user:

```python
from gepa.adapters.default_adapter.default_adapter import DefaultAdapter
adapter = DefaultAdapter(model=task_lm, evaluator=evaluator)  # or your custom adapter
batch = adapter.evaluate(trainset[:2], {"system_prompt": "<seed>"}, capture_traces=True)
print(batch.scores, batch.trajectories[0]["feedback"])
```

This costs a handful of task-model calls and catches the silent failure mode
(evaluator scores the wrong thing) before the budget burns. Then present the
cost estimate, get the go-ahead, and launch backgrounded per the pre-launch
gate in `AGENTS.md`.

## `gepa.optimize` reference (the knobs that matter here)

| Parameter | Meaning |
|---|---|
| `seed_candidate` | `dict[str, str]` — named text component(s) to evolve; **required** |
| `trainset` / `valset` | dataset items; `valset` drives Pareto scoring (defaults to `trainset`) |
| `task_lm` + `evaluator` | Path A — mutually exclusive with `adapter` |
| `adapter` | Path B — a `GEPAAdapter`; pass `task_lm=None`, `evaluator=None` |
| `reflection_lm` (+ `reflection_lm_kwargs`) | the strong model proposing improvements; kwargs carry `api_base`/`api_key` |
| `max_metric_calls` | **the budget** — total task-evaluations across the run; `optimize` raises `ValueError` without a stop condition, and this is the one to use |
| `max_reflection_cost` / `stop_callbacks` | optional extra stoppers (USD cap on reflection; `TimeoutStopCondition`, `NoImprovementStopper`, … from `gepa.utils`) — layered on top of, never instead of, the approved budget |
| `run_dir` | checkpoint dir: state saves here, an existing state **resumes automatically**, and a `gepa.stop` file in it stops the run gracefully |
| `reflection_minibatch_size` | examples per reflection step (default 3) |
| `display_progress_bar` | keep `False` for backgrounded runs |
| `seed` | RNG seed for reproducibility |

Budget intuition: each optimization iteration costs roughly
`reflection_minibatch_size` × 2 task-evaluations (before/after) plus one
full-`valset` pass when a candidate improves, plus one reflection call. With
the default minibatch of 3 and a 20-example valset, `max_metric_calls=300`
buys on the order of 10–20 iterations.

## Outputs

Under `run_dir/`:
- `gepa_state.bin` — the checkpoint; its presence is what makes a rerun resume.
- `run_log.txt` — iteration-by-iteration log (the thing to tail for progress).
- `candidates.json` — every candidate proposed so far, in proposal order.
- `generated_best_outputs_valset/` — best outputs per validation example.

The driver's `gepa.optimize` returns a `GEPAResult`: `best_candidate` (the
winning text(s)), `best_idx`, `val_aggregate_scores` (per-candidate mean
validation score), and `to_dict()` for a JSON-safe dump.

## Worked example — instruction following on a toy QA set

A self-contained Path-A objective: evolve a system prompt until the task
model answers containment-style questions correctly. (Also the CI/local smoke
fixture — with the two LMs stubbed as plain callables it runs with **zero**
network calls; not a user-facing "demo".)

```python
import gepa

trainset = [
    {"input": "What is the capital of France? Reply tersely.",
     "answer": "Paris", "additional_context": {}},
    {"input": "What is 2 + 2? Reply tersely.",
     "answer": "4", "additional_context": {}},
    {"input": "What color is the sky on a clear day? Reply tersely.",
     "answer": "blue", "additional_context": {}},
]

result = gepa.optimize(
    seed_candidate={"system_prompt": "You are a helpful assistant."},
    trainset=trainset,
    task_lm=task_lm,              # platform-models wiring (or a stub callable in CI)
    reflection_lm=reflection_lm,
    reflection_lm_kwargs=reflection_lm_kwargs,
    max_metric_calls=60,
    run_dir="run_dir",
)
print(result.best_candidate["system_prompt"])
```

Stubbing for the no-network smoke: `task_lm` may be any
`(messages) -> str` callable, and `reflection_lm` any `(prompt) -> str`
callable whose reply wraps the proposed instruction in a ``` block (that's
the format the default proposer parses).

## Reporting (and optional PR)

Report the best candidate's aggregate validation score against the seed's,
the winning text from `result.best_candidate`, and where the run artifacts
live. If the optimized text belongs in a repo and a GitHub connection is
granted, open a PR with the change via `gh` — which works through the
connection, never a held token (see `AGENTS.md`).
