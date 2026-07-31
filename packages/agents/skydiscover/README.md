# SkyDiscover agent (AdaEvolve & EvoX)

Runs [**SkyDiscover**](https://github.com/skydiscover-ai/skydiscover) — the
Berkeley Sky lab's unified framework for LLM-driven code & algorithm
optimization: an LLM proposes candidate programs, an evaluator scores each
against a measurable objective, and the search loops toward better solutions —
as a platform agent type.

One image backs **two curated presets**, SkyDiscover's own search strategies:

- **AdaEvolve** (`--search adaevolve`) — multi-island adaptive search (UCB,
  migration, paradigm breakthroughs); adapts search parameters on the fly for
  fast early gains on short budgets.
- **EvoX** (`--search evox`) — a self-evolving paradigm that co-adapts
  solution generation and experience management, evolving the search strategy
  itself for stronger long-horizon gains.

Each preset is its own template over this single image, differing only in the
injected `SKYDISCOVER_SEARCH` env (the agent defaults every run's `--search`
to it) — the same one-image/N-templates pattern as k-search/k-search-local.
SkyDiscover's *wrapped* backends (`--search openevolve|gepa|shinkaevolve` and
the `*_native` variants) are deliberately **not** installed — those ship as
their own workload images (openevolve, gepa, shinkaevolve packages).

This is a **conversational, claude-code-driven workload**, not a bare CLI. You
point it at a target repo (or a from-scratch problem) and a measurable
objective in chat ("evolve this function to run faster on this input set");
it authors the run inputs, runs the search, and reports the winning program
(and can open a PR with it).

## Required connections

- **Model provider** (required) — an OpenAI- and Anthropic-compatible endpoint
  (an IBM-LiteLLM-class connection). A single such connection powers both the
  conversation and SkyDiscover's search loop; a pure-OpenAI provider only
  covers the loop and leaves the agent itself without a model.
- **GitHub** — needed to clone a private target repo or to open a PR with the
  evolved code. A report-only run against a public repo needs no GitHub access.

## Image

Built **FROM the `claude-code` image** (`ARG BASE_IMAGE=platform-claude-code`)
so it inherits the Claude harness, the model gateway, and CA trust — the pod
holds no credentials. On top it adds Python 3.11 + the `skydiscover` package
in a venv at `/opt/skydiscover-venv` (installed with `uv` from PyPI, pinned
via `ARG SKYDISCOVER_VERSION`) — base package only: AdaEvolve and EvoX need no
extras, the `external` extra (wrapped backends) is deliberately absent, and
the heavy `math` extra is runtime-installed per run when a task needs it. Both
harnesses (chat and terminal) are inherited unchanged from the base;
SkyDiscover customizes behavior via `AGENTS.md` + the `skydiscover` skill, not
the harness scripts.

How the pod reaches models without holding keys (plain model ids +
`--api-base`, the placeholder-key idiom) is defined once in the `skydiscover`
skill's Step 1.

## Build

```sh
mise run agents:skydiscover:image            # plain docker build (pip-installs skydiscover)
mise run cluster:build-agent                 # rebuild + restart agent pods in the dev cluster
```

Override the pinned release with `SKYDISCOVER_VERSION`:

```sh
SKYDISCOVER_VERSION=0.1.0 mise run agents:skydiscover:image
```

`values-local.yaml` points the adaevolve/evox templates at the locally-built
`platform-skydiscover:latest` but keeps them `enabled: false`; flip one to
`true` to show it in the local catalog.

## CI / publishing

The skydiscover image is published by CI (`.github/workflows/cd.yml`): the
matrixed `build-workloads` job runs after `merge-agents` — it builds `FROM`
claude-code, so it pulls its base by the same per-commit tag — and
`merge-workloads` publishes the multi-arch manifest to the public
`quay.io/dam-agents/skydiscover` (no `imagePullSecret`). Registering the
component in `scripts/resolve-image.sh`'s `WORKLOADS` list is what enrolls it
in that matrix. Both templates (`adaevolve`, `evox`) are enabled in
`values.yaml` under "Pre-configured Images" (`category: preconfigured`,
`experimental: true`).
