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
across hibernation, so `nous resume` recovers a long run.

## Image

Built **FROM the `claude-code` image** (`ARG BASE_IMAGE=platform-claude-code`)
so it inherits the `claude` CLI, the model gateway, and CA trust. On top it adds:

- Python 3.11 + the `nous` package in a venv at `/opt/nous-venv`, installed with
  `uv` **straight from the public GitHub repo** (pinned via `ARG NOUS_REF`,
  default `v0.4.0`), with the venv on `PATH`. No source vendoring.
- `NOUS_ALLOW_AUTO_APPROVE=1` so `--auto-approve` runs are unconditional in this
  pod (the design/findings human gates auto-pass).
- `NOUS_CAMPAIGN_PARENT=/home/agent/nous-campaigns` (on the persist:true `$HOME`
  mount) so campaign artifacts survive hibernation and stay out of target repos
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
- **Every run** → `nous run --auto-approve` launched as a **background process**
  (PID in `run.pid`, output in `campaign.log`) so the agent stays conversational
  and can poll `nous status` while it runs.

### Hibernation & resume

The pod scales to zero when the session goes idle (no active turn, queued
prompt, or open terminal/SSH session — see
[agent-lifecycle](../../../docs/architecture/agent-lifecycle.md)), which kills a
background `nous run`. Artifacts persist on `$HOME`, so the agent **resumes on
the next turn** (`nous resume --auto-approve`) when it finds a dead `run.pid`
whose campaign isn't `DONE`. For uninterrupted long runs, keep a **terminal or
SSH session open** — that pins the pod awake so the background run completes
without hibernation gaps.

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

## Harness modes

| Mode | Entrypoint | Behavior |
|---|---|---|
| **chat** | inherited claude-code (`claude-agent-acp`) | Claude Code with `nous` installed, the `nous` skill, and the Nous-oriented `AGENTS.md` — chat "run a campaign on …" and Claude drives the `nous` CLI (auto-approve, background, resume-on-wake). The primary path. |
| **terminal** | inherited claude-code | The Claude Code TUI in a terminal (same harness as the base image). For a hands-on shell, use **SSH** — it drops into a plain login shell with `nous` on `PATH`. An open terminal or SSH session also pins the pod awake, useful for uninterrupted long runs. |

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
on `merge-nous`. The template is enabled by default in `values.yaml`
(`experimental: true`).

## Known follow-ups (not yet wired)

- **Schedule-driven unattended resume**: today a long campaign progresses while
  the session is engaged (resume-on-wake) or while a terminal/SSH session pins
  the pod awake. Mapping a platform *schedule trigger* → a "resume any running
  campaigns" turn would give true overnight progress across hibernations; Nous
  also ships a stubbed "Routines" payload builder for this.
- **MCP**: Nous ships a read-only MCP server (`bin/nous-mcp`). Registering it in
  the chat harness would make campaign data `@`-referenceable; left out of this
  cut to avoid perturbing Claude Code startup. (The campaign-authoring/CLI
  reference is already shipped as the `nous` skill.)
