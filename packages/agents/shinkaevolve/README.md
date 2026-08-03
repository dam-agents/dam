# ShinkaEvolve agent

Runs [**ShinkaEvolve**](https://github.com/SakanaAI/ShinkaEvolve) — Sakana AI's
sample-efficient evolutionary program-optimization framework: an ensemble of
LLMs proposes program mutations, an evaluator scores each candidate against a
measurable objective, and island archives keep a diverse population of the
best, iterating until it finds a winner — as a platform agent type.

This is a **conversational, claude-code-driven workload**, not a bare CLI. You
point it at a target repo and a measurable objective in chat ("evolve this
function to run faster on this input set"); it clones the repo, authors the
task inputs, runs the evolution, and reports the winning variant (and can open
a PR with it).

## Required connections

- **Model provider** (required) — an OpenAI- and Anthropic-compatible endpoint
  (an IBM-LiteLLM-class connection). A single such connection powers both the
  conversation and ShinkaEvolve's evolution loop; a pure-OpenAI provider only
  covers the loop and leaves the agent itself without a model.
- **GitHub** — needed to clone a private target repo or to open a PR with the
  evolved code. A report-only run against a public repo needs no GitHub access.

## Image

Built **FROM the `claude-code` image** (`ARG BASE_IMAGE=platform-claude-code`)
so it inherits the Claude harness, the model gateway, and CA trust — the pod
holds no credentials. On top it adds Python 3.11 + the `shinka-evolve` package
in a venv at `/opt/shinka-venv` (installed with `uv` from PyPI, pinned via
`ARG SHINKA_VERSION`). Both harnesses (chat and terminal) are inherited
unchanged from the base; ShinkaEvolve customizes behavior via `AGENTS.md` + the
`shinkaevolve` skill, not the harness scripts.

How the pod reaches models without holding keys (the `local/` model-ID format,
the embeddings default) is defined once in the `shinkaevolve` skill's Step 1.

## Build

```sh
mise run agents:shinkaevolve:image           # plain docker build (pip-installs shinka-evolve)
mise run cluster:build-agent                 # rebuild + restart agent pods in the dev cluster
```

Override the pinned release with `SHINKA_VERSION`:

```sh
SHINKA_VERSION=0.0.7 mise run agents:shinkaevolve:image
```

`values-local.yaml` points the shinkaevolve template at the locally-built
`platform-shinkaevolve:latest` but keeps it `enabled: false`; flip that to
`true` to show it in the local catalog.

## CI / publishing

The shinkaevolve image is published by CI (`.github/workflows/cd.yml`): the
matrixed `build-workloads` job runs after `merge-agents` — it builds `FROM`
claude-code, so it pulls its base by the same per-commit tag — and
`merge-workloads` publishes the multi-arch manifest to the public
`quay.io/dam-agents/shinkaevolve` (no `imagePullSecret`). Registering the
component in `scripts/resolve-image.sh`'s `WORKLOADS` list is what enrolls it
in that matrix. The template is enabled in `values.yaml` under "Pre-configured
Images" (`category: preconfigured`, `experimental: true`).
