# Bob Agent

Platform agent running [Bob Shell](https://internal.bob.ibm.com/docs/shell) — IBM's general-purpose AI shell assistant. Built on the platform-base image, speaking ACP natively, with a per-instance Envoy egress sidecar that injects the Bob API key on outbound traffic.

## Stack

| Component | Source | Purpose |
|---|---|---|
| Harness | `bobshell` 2.0.2 (installed from the `bob-shell` COS bucket tarball) | `bob acp` is the ACP agent for chat sessions; `bob chat` is the TUI for terminal sessions |
| Settings bootstrap | `bob-settings.mjs` | Translates the platform's `BOB_*` env pins into `~/.bob/settings/settings.json` and re-asserts the platform instructions rules link; runs before either surface starts |
| Storage | `/home/agent` PVC | Bob's task history lives in SQLite under `~/.bob/db/bob.db`; settings under `~/.bob/settings/`; survives pod restarts |

## ACP

`bob acp` is a first-class ACP server over stdio, so agent-runtime spawns it directly — there is no translation shim. What it advertises on `initialize`:

```
loadSession: true
sessionCapabilities: { list, delete, resume, close }
promptCapabilities: { embeddedContext, image }
mcpCapabilities: { http, sse }
authMethods: [{ id: "sso" }]
```

Consequences for the platform:

- **Session ids are Bob task ids.** `session/new` returns `taskState.rootTaskId`, so the platform's session id and Bob's task id are the same string — nothing to map or persist.
- **History is native.** `session/list` (paged, `cwd`-filtered), `session/load` (full replay including tool calls, diffs and the last plan state) and `session/resume` (no replay) come straight from Bob's task store.
- **`cwd` must be absolute.** `session/list` rejects a relative `cwd` outright. The platform's clients all send `cwd: "."`, but agent-runtime rewrites every `cwd` in a frame to the pod's work dir before it reaches the harness, so Bob only ever sees an absolute path. That rewrite is load-bearing for this agent.
- **Attachments and images ride the prompt.** `embeddedContext` and `image` are supported, so nothing has to be staged into the workspace first.
- **Extra updates are ignored, not fatal.** Bob emits `plan` and `available_commands_update` frames the UI's projection drops on its `default` branch.
- **The replay arrives after the load response.** Bob answers `session/load` first and streams the conversation afterwards, the reverse of what the runtime's cold fill expects: the first load of an old session answers empty and its history lands a beat later as live updates, which the transcript keeps. This is why agent-runtime re-attaches a cold session with `session/resume` (which Bob advertises and which replays nothing) rather than `session/load` — a load there would replay the whole task into a transcript that already holds it.

The one ACP capability Bob does not implement is `session/set_model` — model selection goes through settings (below), modes through `session/set_mode`.

MCP servers still arrive the platform way, as a runtime-channel contribution written to `~/.bob/settings/mcp.json` (see [`runtime-manifest.yaml`](runtime-manifest.yaml)), not through `session/new.mcpServers`.

## Authentication

Bob expects `BOBSHELL_API_KEY` in the pod env (2.0 renamed it to `BOB_API_KEY`, but the old name is a supported alias — Bob copies it over and errors only if both are set to different values). On the platform the agent only ever sees a **placeholder** — the real key is materialized at the Envoy sidecar, never in the agent container.

1. **Open Settings → Providers → Bob Shell** and paste your Bob API key. The provider preset creates a secret pinned to `api.us-east.bob.ibm.com` (unchanged in 2.0) with `Authorization: Apikey {value}` injection plus a twin entry on the same host that handles the `?key=` URL parameter Bob appends to several admin endpoints. `BOBSHELL_API_KEY` is seeded as `dummy-placeholder` — the literal content is irrelevant because Envoy overwrites the wire value, but it must not start with `sk-`/`pk-` or Bob's bundle would silently downgrade to the legacy `prod.ibm-bob-staging.cloud.ibm.com` backend (which only accepts JWT keys). The Advanced disclosure lets you set the default model and tenant-scoping flags (see below) — those flow as additional env-mappings rather than free-form env vars in the agent dialog.

2. **Grant the secret to the Bob agent instance** from Configure Agent → Secrets. The next pod restart picks up `BOBSHELL_API_KEY` and any pinned `BOB_*` envs along with the Envoy filter chain.

The flow per request: Bob's `fetch()` sets `Authorization: Apikey dummy-placeholder` and tunnels through `HTTPS_PROXY` → Envoy terminates TLS using the platform CA → `credential_injector` rewrites the header to `Apikey bob_prod_…` from the K8s Secret → upstream sees the valid token. See [`docs/architecture/security-and-credentials.md`](../../../docs/architecture/security-and-credentials.md) and [ADR-033](../../../docs/adrs/033-envoy-credential-gateway.md).

With the API key present Bob never asks to authenticate, so the `sso` auth method it advertises is dead weight here — an agent whose secret was never granted fails `session/new` with `auth_required` instead.

### Endpoints that read the key from the URL

Some Bob backends (`/key/info?key=<value>`) read the credential from a URL query parameter. The provider preset's `extraInjections` automatically creates a second "twin" K8s Secret on the same host with `queryParamName: key`; the platform-side service cascades grants/updates/deletes onto it. See [ADR-044](../../../docs/adrs/044-provider-twin-secrets.md) for the twin-secret pattern and [ADR-033 §Credential injection](../../../docs/adrs/033-envoy-credential-gateway.md#credential-injection) for the Envoy URL-rewrite path.

## Autonomy posture

Both surfaces run `--trust --accept-license`, because Bob refuses to open a session in an untrusted workspace and the platform's workspace arrives as a plain `cwd`, with no one to answer a trust prompt.

Both surfaces also auto-approve by default, and **that is a Bob limitation, not a platform preference**. Bob's ACP decides a tool call like this: a built-in skill, a `read`-permission tool, or `--auto-approve` runs; anything else asks the client. There is no middle setting. Bob does own a finer posture — permission groups, a per-tool executor allowlist, and a default allowlist of safe commands (`cat`, `ls`, `git status`, `grep`, …) — but the only code that consults it is Bob's TUI approval handler, reached through its own terminal-app singletons. The ACP path never sees it.

So asking means asking about *everything* except file reads: one execute tool, five edit tools, browser and MCP all prompt, and Bob is a shell assistant that reaches for `execute_command` constantly. A prompt per `ls` is worse than no prompt at all, which is why the default stands at `--auto-approve`.

**Approvals** in the agent's Config panel turns per-tool prompts on for an agent that wants them (allow once / always allow / reject / always reject, an "always" remembered per tool name for the session); `BOB_AUTO_APPROVE=0` does the same from the env. Two things to know before switching: an unattended session has nobody to answer, so a request expires against agent-runtime's TTL and the tool call aborts; and one "always allow" on `execute_command` silences commands for the rest of that session anyway. Per-session granularity would have to come from Bob — approvals wired to its modes, or `session/set_config_option` registered in its ACP host.

Guardrails that stay active: `approval.outsideWorkspaceAllowed` is a hard gate ahead of any approval decision (the settings bootstrap opens it, or Bob would refuse every tool touching `$HOME` — skills, rules), `session.maxTurns` (Bob default 100) ends a runaway task, and `session.maxCost` caps spend per task.

## Configuration

`bob acp` parses only `--trust`, `--auto-approve`, `--accept-license`, `--log-level` and `--disable-{mcp,subagents}` — model, mode and cost have no flag on that surface, so they ride `~/.bob/settings/settings.json`, which `bob-settings.mjs` merge-writes from the env before either surface starts. Settings come from three places, in this order of precedence: the agent's **Config panel**, then the **Bob Shell provider** pins, then free-form **Configure Agent → Env**.

### The Config panel (per agent)

The manifest declares a `harness-config` driver, which is what puts the panel on the agent at all, and it offers two options: **Mode** (`agent` / `plan` / `ask`) and **Approvals** (`auto` / `ask`).

The panel writes into a `platform` section of the settings file that **Bob itself ignores**, not into `session.*`. That indirection is load-bearing: `bob-settings.mjs` rewrites Bob's own keys on every harness start, so a panel writing them directly would be overwritten by the provider pin (or deleted when the pin is cleared). Instead the bootstrap reads the `platform` section, resolves panel value over provider pin, and writes the result — so a panel choice survives every restart, and an agent with no panel choice still follows the pin.

Approvals cannot ride the settings file at all, because Bob's ACP reads them from a CLI flag at spawn. The bootstrap therefore prints the mode it resolved and the harness scripts translate it into `--auto-approve`.

Two consequences worth knowing:

- **A change lands on the next harness start.** The platform writes the panel event once and never re-asserts it, and neither surface re-reads the file mid-session. A running session keeps the posture it started with; the next one picks the new one up. The env rail is the faster lever, since an env change recycles the harness.
- **The file stays yours.** A panel value is never reconciled away, so a hand-edit through the Files panel or SSH survives — including one to the `platform` section.

Model is deliberately not in the panel: Bob's list comes from a LiteLLM-shaped `/model/info` under its own path prefix, which neither a static catalog nor the platform's `modelDiscovery` can serve yet. `BOB_SHELL_MODEL` remains the way to set it.

### Pinned via the Bob Shell provider (Settings → Providers → Bob Shell → Advanced)

These ride on the secret's `envMappings`, so every agent granted the Bob secret inherits them automatically — no per-agent re-entry.

| Env var | Translated to | Effect |
|---|---|---|
| `BOBSHELL_API_KEY` | n/a (env-only) | API key the Envoy sidecar swaps to the real value on the wire. Always emitted. |
| `BOB_SHELL_MODEL` | `session.model` | Default model for new tasks. Examples: `premium-shell`, `codestral-2508`, `claude-sonnet-5`. Empty → Bob's built-in default. |
| `BOB_CHAT_MODE` | `session.defaultMode` | One of `agent`, `plan`, `ask` (2.0 merged `code`/`advanced` into `agent`; legacy pinned values are mapped onto `agent`). Starting mode for new sessions, unless the agent's Config panel sets one. |
| `BOB_MAX_COINS` | `session.maxCost` | Per-task cost cap — Bob stops the task when exceeded. |
| `BOB_INSTANCE_ID` | `bob chat --instance-id` (terminal only) | IBM tenant scoping. Neither `bob acp` nor the settings file takes an instance, so this pin does not reach chat-mode sessions; headless instance selection goes through Bob profiles. |
| `BOB_TEAM_ID` | `bob chat --team-id` (terminal only) | Team ID for `general`-type API keys. Terminal-only for the same reason. |

Per-agent overrides for any of these still work — set the same env name in **Configure Agent → Env** and it wins over the inherited pin.

### Free-form env vars (Configure Agent → Env)

Less common toggles, not surfaced on the provider card.

| Env var | Effect |
|---|---|
| `BOB_AUTO_APPROVE` | Set to `0` to make sessions ask per tool call instead of auto-approving, for an agent whose Config panel leaves Approvals unset (see [Autonomy posture](#autonomy-posture)). |
| `BOB_LOG_LEVEL` | Bob's log level: `debug`, `info`, `warn`, `error`, `silent`. Logs go to stderr; stdout belongs to the ACP stream. |
| `IBM_TELEMETRY_ENABLED` | Set to `false` to opt out of Bob's telemetry. |

Gone, and silently ignored if an old agent still sets them: `BOBSHELL_HIDE_ENVS`, `BOB_SHELL_PRE_CHECK_AUTO_APPROVED`, `BOB_SHELL_SYSTEM_MD` (custom instructions now ride the `.bob/rules/` directory — the image links the platform instructions there), `BOB_RESUME_MAX_MESSAGES` and `BOB_SHIM_TRACE` (both belonged to the bridge — resume is native and there are no shim frames to trace).

The settings bootstrap also **prunes** the keys the bridge used to write into `approval` — `autoApprovalEnabled`, `allowed_permissions`, `allowedExecutors` — so an agent upgraded in place stops carrying a deleted component's posture and falls back to Bob's own defaults, with the auto-approve flag as the single source of truth.

The settings bootstrap also pins `bobShell.autoUpdate: false`: the image pins the version, and a self-update inside the pod would both fail against the egress rules and print onto stdout.

## Harness scripts

| Script | Behavior |
|---|---|
| `harness-chat.sh` | Runs `bob-settings.mjs`, turns the approval mode it printed into `--auto-approve` or nothing, then `exec`s `bob acp`. A failed bootstrap fails the harness — without the posture Bob refuses every tool that touches `$HOME`. |
| `harness-terminal.sh` | Same bootstrap and approval translation, plus the tenant-scoping env as `bob chat` flags, then `exec`s the TUI. Each terminal open starts a **fresh** Bob task — Bob's task index can't be mapped onto `$HARNESS_SESSION_ID`; users can resume prior tasks from inside the TUI with `bob -r`. |

## Session history

Bob persists every task to SQLite on the PVC (`~/.bob/db/bob.db`) and serves ACP history from it, so the platform's sidebar, replay and resume are all native reads — see [ACP](#acp) above. Terminal-mode tasks land in the same store and therefore also appear in the session list.

Chat sessions created before 2.0.2 are not reachable: their ids were minted by the old translation shim (`bob-<uuid>`) and mean nothing to Bob, so `session/load` answers `resourceNotFound`. Their Bob-side tasks survive and can still be resumed from the terminal with `bob -r`.

## Persistence

The `/home/agent` PVC keeps Bob's task DB (`~/.bob/db/`), settings (`~/.bob/settings/`), logs, and whatever Bob writes during a session (workspace files, MCP server configs). Survives pod restarts and image rebuilds.
