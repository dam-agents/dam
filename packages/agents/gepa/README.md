# GEPA agent

Runs [**GEPA**](https://github.com/gepa-ai/gepa) (Genetic-Pareto) — the
reflective text-optimization framework: a task model executes candidate texts
on training examples, an evaluator scores them, and a reflection LLM reads the
full execution traces to diagnose failures and propose improvements, keeping a
Pareto frontier of the best candidates across rounds — as a platform agent
type. Its tagline: if you can measure it, you can optimize it — prompts,
instructions, code snippets, configs, any textual parameter.

This is a **conversational, claude-code-driven workload**, not a bare CLI —
GEPA itself ships none; it's a Python library driven by
`gepa.optimize(...)`. You state the optimization goal in chat ("optimize this
prompt against these examples"); the agent authors the driver script, the
dataset, and the evaluator (or a custom `GEPAAdapter`), runs the optimization,
and reports the winning candidate (and can open a PR with it).

## Required connections

- **Model provider** (required) — GEPA's loop talks to models through
  LiteLLM, so providers are interchangeable: any connection that injects env
  LiteLLM understands works (an OpenAI-compatible proxy via
  `OPENAI_BASE_URL`, a vendor key like `ANTHROPIC_API_KEY`, …). The loop uses
  **two models** from that one connection: a cheap `task_lm` executing the
  candidates and a strong `reflection_lm` proposing improvements. A
  connection that also serves the Claude harness (an IBM-LiteLLM-class proxy
  or an Anthropic API key) powers both the conversation and the loop; a
  loop-only provider leaves the agent itself without a model.
- **GitHub** — needed to clone a private target repo or to open a PR with the
  optimized text. A report-only run needs no GitHub access.

## Image

Built **FROM the `claude-code` image** (`ARG BASE_IMAGE=platform-claude-code`)
so it inherits the Claude harness, the model gateway, and CA trust — the pod
holds no credentials. On top it adds Python 3.11 + the `gepa` package in a
venv at `/opt/gepa-venv` (installed with `uv` from PyPI, pinned via
`ARG GEPA_VERSION`), together with the runtime set of its `full` extra —
litellm (GEPA's only LLM client), datasets, tqdm, cloudpickle — minus the
mlflow/wandb tracking stacks the agent is instructed never to enable. Both harnesses (chat and terminal) are
inherited unchanged from the base; GEPA customizes behavior via `AGENTS.md` +
the `gepa` skill, not the harness scripts.

Reference material is split into two skills to keep the upstream knowledge
portable: the `gepa` skill is the pure library reference, and the
`platform-models` skill defines once how the pod reaches models without
holding keys (the provider-agnostic discover → wire → probe procedure).

## Build

```sh
mise run agents:gepa:image                   # plain docker build (pip-installs gepa)
mise run cluster:build-agent                 # rebuild + restart agent pods in the dev cluster
```

Override the pinned release with `GEPA_VERSION`:

```sh
GEPA_VERSION=0.1.4 mise run agents:gepa:image
```

`values-local.yaml` points the gepa template at the locally-built
`platform-gepa:latest` but keeps it `enabled: false`; flip that to `true` to
show it in the local catalog.

## CI / publishing

The gepa image is published by CI (`.github/workflows/cd.yml`): the matrixed
`build-workloads` job runs after `merge-agents` — it builds `FROM`
claude-code, so it pulls its base by the same per-commit tag — and
`merge-workloads` publishes the multi-arch manifest to the public
`quay.io/dam-agents/gepa` (no `imagePullSecret`). Registering the component in
`scripts/resolve-image.sh`'s `WORKLOADS` list is what enrolls it in that
matrix. The template is enabled in `values.yaml` under "Pre-configured Images"
(`category: preconfigured`, `experimental: true`).
