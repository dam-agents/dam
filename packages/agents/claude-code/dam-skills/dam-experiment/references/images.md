# Worker images: which to use, and why

Read this before agreeing an image with the human. The catalogue
(`x.list_images()`) is authoritative for **what exists in this deployment**;
this file says **which of those to spawn as an experiment worker, and when**.
Where the two disagree, the catalogue wins — an id missing from it cannot be
spawned here, whatever this file says about it.

## Supported as experiment workers

| Image | Use it for | Credentials |
|---|---|---|
| `claude-code` | **The default.** Any round an agent with tools can do | None beyond the sandbox's own — reuse the driver's grant |
| `codex` | Same, on OpenAI's coding agent | Needs an OpenAI credential granted to this sandbox |
| `pi-agent` | Same, when the round should run on a specific provider | Needs that provider's credential |
| `bob` | Same, on IBM's Bob Shell | Needs a Bob API key |
| `nous` | Hypothesis-driven optimization of a target repo | Any model provider |

Everything else in the catalogue is **defined below but not supported yet** —
do not spawn it as a worker. If the human asks for one, say it is not supported
as an experiment worker yet and offer the closest supported option.

## The general-purpose agents

`claude-code`, `codex`, `pi-agent` and `bob` are all the same shape of worker:
a general coding agent with tools and a filesystem, told what to do by your
prompt. The round is "an agent does the task and reports a typed result", and
your loop supplies all the intelligence about what to try next. Pick one of
these unless the goal matches `nous` below.

**Default to `claude-code`.** It needs no credential the sandbox does not
already have: the driver is itself a Claude Code agent, so the provider
connection it already holds is the one a `claude-code` target needs, and
passing `x.list_connections()` through is enough.

The others are the same worker on a different provider, and each needs a
credential **granted to this sandbox first** — the platform injects it on the
wire, so the pod never holds a key, but a target spawned without the grant
fails its first model call and then hangs until its liveness deadline. So:

- `codex` — an OpenAI credential.
- `pi-agent` — the credential for whichever provider it should run on (it
  supports many; the choice is the human's).
- `bob` — a Bob API key.

Before proposing one of these, check `x.list_connections()` for the matching
grant. If it is absent, say so and offer `claude-code` instead of spawning a
worker that cannot reach a model. Choose a non-default provider only when the
human wants *that* provider's agent in the loop — not for variety.

## `nous` — hypothesis-driven optimization

**Optimizes** a target repo against a metric the campaign commits to up front.

**How it searches** — a deterministic orchestrator drives two Claude roles
through plan → build & test → analyze → learn against a repo it clones,
patches, and measures. It pre-registers its pass condition (`ground_truth`)
before running, so a campaign either meets it or reports that it did not.

**Pick it when** the goal is "make X faster / better in repo Y, and tell me
whether it actually worked". **Don't** when there is no target repo, no
measurable metric, or no build to run — the campaign has nothing to test.

**You must supply** (interview the human — see the skill's Nous section): the
repo, the hypothesis, the metric and direction, the pass condition, the
campaign's internal iteration count, seeds, and how many rounds your loop
chains.

**Cost shape** — as long as you let it, so don't. **Default to a one-hour
campaign**: one round, 1–2 internal iterations, 3 seeds, one hypothesis;
~20–30 min per iteration at that size. A bigger run is the human's call to
make, never yours to assume: propose the hour, and when an estimate breaks it,
cut seeds and iterations rather than the deadline. Set `ttl_ms` at roughly
double the estimate — this is the image most likely to be killed by a deadline
left at its default, and a killed pod wastes the entire round.

**Spawn notes** — it never hibernates (`hibernationTimeout: "0s"`), so a
terminal transition or the liveness deadline is what ends it; nothing else will
reclaim it. Give it an autonomous prompt, lock its resource envelope, and name
the files to report — see the skill's Nous section and
[nous-evaluator.md](nous-evaluator.md).

## Defined, but not supported as experiment workers yet

These exist in the catalogue and work as interactive sandboxes, but are not
validated as spawned experiment workers. Do not put them in a loop yet.

All of them share one trait worth knowing: they are **conversational,
claude-code-driven workloads, not bare CLIs**. You state a goal in chat and the
agent authors the driver script, dataset, and evaluator itself. That is exactly
why they need validating before a loop spawns them unattended — an unattended
prompt has to carry everything a chat would have supplied.

- **`gepa`** — reflective prompt & text optimization. A task model runs
  candidate texts, an evaluator scores them, and a reflection model reads the
  execution traces to propose improvements, keeping a Pareto frontier. For
  optimizing any textual parameter — prompts, instructions, configs — against a
  scorer. Needs a dataset and an evaluator.
- **`openevolve`** — evolutionary code optimization (an open-source
  AlphaEvolve): generate many variants of the target code, score each against a
  measurable objective, keep the best, repeat.
- **`shinkaevolve`** — the same idea, sample-efficient: an ensemble of models
  proposes mutations and island archives keep a diverse population, aimed at
  fewer evaluations per unit of progress. Prefer it over `openevolve` when each
  evaluation is expensive.
- **`adaevolve`** — multi-island adaptive search (UCB, migration, paradigm
  breakthroughs) that tunes its own search parameters as it goes; aimed at fast
  early gains on a short budget.
- **`evox`** — a self-evolving paradigm that co-adapts solution generation and
  experience management, evolving the search strategy itself; aimed at stronger
  long-horizon gains. Same image as `adaevolve`, differing only in the search
  preset it is pinned to.
- **`k-search`** — LLM-driven GPU kernel optimization, benchmarking candidate
  kernels on Modal cloud GPUs. Needs the Modal connection.
- **`k-search-local`** — the same image benchmarking on an in-cluster NVIDIA
  GPU. Disabled by default: without a GPU node and a GPU-capable sandbox
  runtime class it never schedules.
- **`claude-code-vm`** — `claude-code` in a full VM, with docker and k3s inside
  the sandbox. For work that must run containers or a cluster of its own;
  heavier to start than the container-backed default.
