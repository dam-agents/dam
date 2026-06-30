# OpenEvolve agent

Runs [**OpenEvolve**](https://github.com/algorithmicsuperintelligence/openevolve)
— an open-source AlphaEvolve: an evolutionary coding agent that improves code by
generating many variations, scoring each against a measurable objective, and
keeping the best, iterating until it finds a winner — as a platform agent type.

This is a **conversational, claude-code-driven workload**, not a bare CLI. You
point it at a target repo and a measurable objective in chat ("evolve this
function to run faster on this input set"); it clones the repo, sets up the
evolution, runs it, and reports the winning variant (and can open a PR with it).

## Required connections

- **Model provider** (required) — an OpenAI- and Anthropic-compatible endpoint
  (an IBM-LiteLLM-class connection). A single such connection powers both the
  conversation and OpenEvolve's optimization loop; a pure-OpenAI provider only
  covers the loop and leaves the agent itself without a model.
- **GitHub** — needed to clone a private target repo or to open a PR with the
  evolved code. A report-only run against a public repo needs no GitHub access.

## Image

Built **FROM the `claude-code` image** (`ARG BASE_IMAGE=platform-claude-code`) so it
inherits the Claude harness, the model gateway, and CA trust — the pod holds no
credentials. On top it adds Python 3.11 + the `openevolve` package in a venv at
`/opt/openevolve-venv` (installed with `uv` from PyPI, pinned via
`ARG OPENEVOLVE_VERSION`). Both harnesses (chat and terminal) are inherited
unchanged from the base; OpenEvolve customizes behavior via `AGENTS.md` + the
`openevolve` skill, not the harness scripts.

## Build

```sh
mise run agents:openevolve:image            # plain docker build (pip-installs openevolve)
mise run cluster:build-agent                 # rebuild + restart agent pods in the dev cluster
```

Override the pinned release with `OPENEVOLVE_VERSION`:

```sh
OPENEVOLVE_VERSION=0.2.27 mise run agents:openevolve:image
```

`values-local.yaml` enables the openevolve template against the locally-built
`platform-openevolve:latest`.

## CI / publishing

The openevolve image is published by CI (`.github/workflows/cd.yml`):
`build-openevolve` runs after `merge-agents` — it builds `FROM` claude-code, so
it pulls its base by the same per-commit tag — and `merge-openevolve` publishes
the multi-arch manifest to the public `quay.io/dam-agents/openevolve` (no
`imagePullSecret`). The template is enabled in `values.yaml` under "Pre-configured
Images" (`category: preconfigured`, `experimental: true`).
