# Nous agent

Runs [**Nous**](https://github.com/AI-native-Systems-Research/agentic-strategy-evolution)
— a hypothesis-driven experimentation framework — as a platform agent type.
Nous is a deterministic Python orchestrator (`nous run campaign.yaml`) that
drives two Claude agent roles through a structured experiment loop against a
target system it clones, builds, patches, and measures.

## Why this maps cleanly onto the platform

Nous's own docs ask you to run it "inside a network-namespaced container" with
bounded egress and authenticated Claude access. The platform *is* that
container: the agent pod holds **no** credentials, and Nous's Claude Agent SDK
calls authenticate through the Envoy credential gateway — the same keyless path
the `claude-code` harness uses. `git`/`gh` for cloning and publishing target
repos go through the same gateway. The per-agent PVC persists campaign state
across pod restarts, so `nous resume` recovers a long run.

The same inheritance makes agent telemetry work without any image change: the
template sets `telemetry: true`, and when the telemetry backend is installed
(`clickstack.enabled`) the pod receives the standard Claude Code OTLP env.
Both of Nous's dispatch paths — the Claude Agent SDK (which builds its
subprocess env from `os.environ`) and the legacy `claude -p` fallback — pass
that env through to the harness, so every planner/executor turn of a campaign
exports token/cost/duration telemetry with trusted per-agent attribution.
Gate summaries go through the OpenAI-format endpoint instead of the Claude
CLI and are the one dispatch path that does not export.

## Image

Built **FROM the `claude-code` image** (`ARG BASE_IMAGE=platform-claude-code`)
so it inherits the `claude` CLI, the model gateway, and CA trust. On top it adds:

- Python 3.11 + the `nous` package in a venv at `/opt/nous-venv`, installed with
  `uv` **straight from the public GitHub repo** (pinned via `ARG NOUS_REF`,
  default `v0.4.0`), with the venv on `PATH`. No source vendoring.
- A build-time patch ([`patch-campaign-schema.py`](./patch-campaign-schema.py))
  that adds the `channels:` property to the installed `campaign.schema.yaml`.
  Nous's runtime reads `campaign.channels` at every gate, but the v0.4.0 schema
  omits the property while forbidding unknown top-level keys, so any campaign
  using channels is rejected at pre-flight ([Nous issue #296](https://github.com/AI-native-Systems-Research/agentic-strategy-evolution/issues/296))
  — which would break the channel bridge below. The patch is idempotent and
  self-verifying; it no-ops once a Nous release ships the property.
- `NOUS_ALLOW_AUTO_APPROVE=1` as the default so `--auto-approve` runs are
  unconditional in this pod (the design/findings human gates auto-pass). The
  agent overrides it to `0` per-run for **on-demand approval**, where each gate
  is instead relayed to a bound Slack/Telegram channel (see `AGENTS.md`).
- `NOUS_CAMPAIGN_PARENT=/home/agent/nous-campaigns` (on the persist:true `$HOME`
  mount) so campaign artifacts survive pod restarts and stay out of target repos
  (Nous issue #239).
- A Nous-oriented [`AGENTS.md`](./AGENTS.md) as the chat-mode system context,
  plus the [`nous` skill](./workspace/.agents/skills/nous/SKILL.md) (CLI +
  campaign-authoring reference) shipped into the workspace.
- The Nous **wiki** slash commands (`post-campaign`, `index-wiki`,
  `visualize-campaign`, `visualize-registry`, `suggest-next`) vendored verbatim
  from the upstream repo into `~/.claude/commands/`, with their render scripts in
  `~/scripts/`. They turn finished campaigns' `ledger.json`/`principles.json`
  into a cross-campaign knowledge graph under `~/.nous/wiki/` so findings
  compound across runs.

## How the agent operates (chat mode)

Both harnesses are inherited unchanged from the claude-code base; nous
customizes behavior through [`AGENTS.md`](./AGENTS.md) + the skill, not the
harness scripts. The chat harness drives `nous` per `AGENTS.md`:

- **New conversation** → lists existing campaigns (running / not running) and
  offers a status pull or a resume.
- **Per campaign** → its own directory under `$NOUS_CAMPAIGN_PARENT`, named by a
  unique web-safe `run_id` (repo + question, `-2`/`-3` on collision); the target
  repo is cloned into `<run_id>/repo`, never in the pod root. `campaign.yaml`
  always declares `locked_parameters`.
- **Every run** → launched as a **background process** (PID in `run.pid`, output
  in `campaign.log`, chosen mode in `run.mode`) so the agent stays conversational
  and can poll `nous status` while it runs. Approval is a per-campaign choice:
  **auto-approve** by default, or — when a Slack/Telegram channel is bound —
  **on-demand approval** (`NOUS_ALLOW_AUTO_APPROVE=0`), where each gate pauses and
  is relayed to the channel for the user to approve.
- **Experiment trial** → when launched as an arm of a platform Experiment
  (the Trial prompt carries the autonomous-trial directive), the interactive
  doctrine is suspended: the agent self-authors the campaign, runs
  `--auto-approve`, keeps its turn alive until `DONE`, and reports one
  `record_run` per iteration (composite score from `best_found.json`) before
  `finish_arm` — see `AGENTS.md` → "Experiment trial sessions".

### Never hibernates; resume-on-restart

The nous template ships this agent with hibernation **disabled** (idle timeout
`0` — see [agent-lifecycle](../../../docs/architecture/agent-lifecycle.md)), so an
idle session does **not** scale the pod to zero. A background `nous run` runs to
completion on its own; no one needs to keep a terminal or SSH session open. Should
the pod restart for another reason (image upgrade, node eviction, OOM, crash),
artifacts persist on `$HOME`, so the agent **resumes on the next turn**
(`nous resume --auto-approve`) when it finds a dead `run.pid` whose campaign isn't
`DONE`.

### Progress to Slack/Telegram — the channel bridge

[`nous-channel-bridge.py`](./nous-channel-bridge.py) (shipped to
`/usr/local/bin/nous-channel-bridge`) lets a campaign report into the agent's
bound Slack/Telegram thread using Nous's **own** `channels:` feature — without
external egress or a webhook secret on disk. Nous's gate notifier POSTs each
DESIGN/FINDINGS summary (it fires even under `--auto-approve`) to a `webhook`
channel at `http://127.0.0.1:8765/gate?channel=slack`; the bridge relays it to
the platform's per-agent `send_channel_message` MCP tool. It works because the
image sets `NO_PROXY=127.0.0.1` (so Nous's POST stays local), the bridge's MCP
call routes back through the egress gateway like the harness's own MCP calls, and
the per-agent MCP endpoint authorizes by the pod's **mesh identity** (no token —
ADR-041). Stdlib-only; the agent launches it on demand (see `AGENTS.md`). Needs a
channel bound to the agent; delivery is best-effort.

The same bridge doubles as the **approval channel** for on-demand mode: with
`NOUS_ALLOW_AUTO_APPROVE=0` the relayed card is an approval request the user
answers from the thread rather than a fire-and-forget progress summary, so a
bound channel is a prerequisite for on-demand approval (not just reporting).

Each summary is itself an OpenAI-format LLM call (`OPENAI_BASE_URL`). Under
LiteLLM that hits the proxy's intercept CA and a model-id `403`, so the image
extends the base model-gateway shim ([`nous-model-gateway.sh`](./nous-model-gateway.sh)):
after the base repoints `ANTHROPIC_BASE_URL` at the in-pod gateway, it does the
same for `OPENAI_BASE_URL` when that is unset or a LiteLLM endpoint. It's sourced
by the chat/terminal harness and the SSH login profile, so the whole shell env —
and everything `nous` spawns — carries the gateway URL (a deliberately-distinct
OpenAI endpoint is left alone).

## Harness modes

| Mode | Entrypoint | Behavior |
|---|---|---|
| **chat** | inherited claude-code (`claude-agent-acp`) | Claude Code with `nous` installed, the `nous` skill, and the Nous-oriented `AGENTS.md` — chat "run a campaign on …" and Claude drives the `nous` CLI (auto-approve, background, resume-on-restart). The primary path. |
| **terminal** | inherited claude-code | The Claude Code TUI in a terminal (same harness as the base image). For a hands-on shell, use **SSH** — it drops into a plain login shell with `nous` on `PATH`. |

## Build

```sh
mise run agents:nous:image          # plain docker build (pip-installs nous from GitHub)
mise run cluster:build-agent        # rebuild + restart agent pods in the dev cluster
```

The build pip-installs Nous from its public GitHub repo — no local clone or
vendoring. Override the pinned release with `NOUS_REF`:

```sh
NOUS_REF=main mise run agents:nous:image     # track a branch
NOUS_REF=v0.4.1 mise run agents:nous:image   # or a different tag
```

`values-local.yaml` enables the nous template against the locally-built
`platform-nous:latest`.

## CI / publishing

The nous image is published by CI (`.github/workflows/cd.yml`): `build-nous`
(per-arch) runs after `merge-agents` — nous builds `FROM` claude-code, so it
pulls its base by the same per-commit tag — and `merge-nous` publishes the
multi-arch manifest to `quay.io/dam-agents/nous`. The `publish` (Helm) job waits
on `merge-nous`. The template is enabled by default in `values.yaml` under
"Pre-configured Images" (`category: preconfigured`, `experimental: true`).

## Known follow-ups (not yet wired)

- **Schedule-driven unattended resume**: now that this pod doesn't hibernate, a
  backgrounded campaign already runs to completion unattended. A platform
  *schedule trigger* → a "resume any running campaigns" turn would still add
  belt-and-suspenders recovery after a non-idle pod restart (upgrade, eviction,
  crash); Nous also ships a stubbed "Routines" payload builder for this.
- **MCP**: Nous ships a read-only MCP server (`bin/nous-mcp`). Registering it in
  the chat harness would make campaign data `@`-referenceable; left out of this
  cut to avoid perturbing Claude Code startup. (The campaign-authoring/CLI
  reference is already shipped as the `nous` skill.)
