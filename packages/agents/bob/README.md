# Bob Agent

Platform agent running [Bob Shell](https://bob.ibm.com/docs/shell) — IBM's general-purpose AI shell assistant.
Shipped in the default agent image, speaking ACP natively, with the platform's credential gateway — Envoy in a pod of its own — injecting the Bob API key on the machine's outbound traffic.

The harness ships in the default image every harness Template boots, built by `//packages/agents:oci` from the shared base in [`packages/agents/base`](../base/) (see [agent images](../../../docs/architecture/agent-images.md)): its tools, declared in [`image.toml`](image.toml), are baked into the default image's harness tools layer, and its files live at their image paths under [`rootfs/`](rootfs/).

## Stack

| Component          | Source                                                                                | Purpose                                                                                                                                                                                                              |
| ------------------ | ------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Harness            | `bobshell` 2.0.6 (the `bob-shell` COS bucket release tarball, as a mise `http:` tool) | `bob acp` is the ACP agent for chat sessions; `bob chat` is the TUI for terminal sessions                                                                                                                            |
| Settings bootstrap | [`bob-settings.mjs`](rootfs/app/bob-settings.mjs)                                     | Translates the platform's `BOB_*` env pins into `~/.bob/settings/settings.json`, and re-asserts the platform and agent instructions rules links and the terminal-session pin hook; runs before either surface starts |
| Session ref        | [`bob-mcp-file.mjs`](rootfs/usr/local/lib/bob-mcp-file.mjs)                           | Preloaded into `bob acp` only: hides the file's platform MCP entry from Bob, so the per-session entry carrying the session ref is the one Bob uses (see [Session ref](#session-ref))                                 |
| MCP startup        | [`bob-acp-patch.mjs`](rootfs/usr/local/lib/bob-acp-patch.mjs)                         | Preloaded into `bob acp` only: starts the servers of `mcp.json` in the background, so one that never gets ready cannot hold every chat session back (see [MCP startup](#mcp-startup))                                |
| Storage            | `/home/agent`, on the machine's disk                                                  | Bob's task history lives in SQLite under `~/.bob/db/bob.db`; settings under `~/.bob/settings/`; survives restarts and hibernation                                                                                    |

## ACP

`bob acp` is a first-class ACP server over stdio, so agent-runtime spawns it directly — there is no translation shim.
What it advertises on `initialize`:

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
- **`cwd` must be absolute.** `session/list` rejects a relative `cwd` outright.
  The platform's clients all send `cwd: "."`, but agent-runtime rewrites every `cwd` in a frame to the machine's work dir before it reaches the harness, so Bob only ever sees an absolute path.
  That rewrite is load-bearing for this agent.
- **Attachments and images ride the prompt.** `embeddedContext` and `image` are supported, so nothing has to be staged into the workspace first.
- **Extra updates are ignored, not fatal.** Bob emits `plan` and `available_commands_update` frames the UI's projection drops on its `default` branch.
- **The replay arrives after the load response.** Bob answers `session/load` first and streams the conversation afterwards, the reverse of what the runtime's cold fill expects: the first load of an old session answers empty and its history lands a beat later as live updates, which the transcript keeps.
  This is why agent-runtime re-attaches a cold session with `session/resume` (which Bob advertises and which replays nothing) rather than `session/load` — a load there would replay the whole task into a transcript that already holds it.

The one ACP capability Bob does not implement is `session/set_model` — model selection goes through settings (below), modes through `session/set_mode`.

MCP servers arrive the platform way, as a runtime-channel contribution written to `~/.bob/settings/mcp.json` (see [`runtime-manifest.yaml`](rootfs/app/runtime-manifest.yaml)).
Bob also registers the servers a `session/new`, `session/load` or `session/resume` carries, into that session's own harness: `type: http` with `url` and `headers`; it rejects SSE and ACP transports.
The platform uses that for one server, its own, so each chat session calls the platform tools under its own session ref (see [Session ref](#session-ref)).

### Session ref

The platform MCP server learns which session calls it from the `x-platform-session-ref` header.
agent-runtime gives every session an opaque ref and adds the platform entry, with that header, to the `mcpServers` of each `session/new`, `session/load` and `session/resume` it sends.
Bob registers it, but keeps one server per name and lets an entry of `~/.bob/settings/mcp.json` outrank one a session carried, and the mcp-entry driver writes the platform entry there under the same name for the terminal's `bob chat`.
Left alone, the file's entry wins and every Bob chat session calls the platform tools anonymously: its platform sub-agent settings cannot apply, a `schedule_once` with `inSession: continue` is refused, and a sub-agent it spawns shows in every chat.

So `harness-chat` always preloads [`bob-mcp-file.mjs`](rootfs/usr/local/lib/bob-mcp-file.mjs) into `bob acp`.
It wraps Bob's reads of that one file to drop `platform-outbound`, and its writes (and renames or copies onto the file) to put the entry back from the file on disk, so a `bob mcp add` from a chat session never loses it.
Bob's watch on the file is untouched, so a Connection's MCP entry written mid-process still reloads.
`bob chat` runs without the preload and reads the whole file, so terminal sessions keep the platform tools and, like every harness's terminal, name no session.
One visible side effect: Bob's own `read_file` tool, in a chat session, shows `mcp.json` without the platform entry, while `cat`, the terminal and SSH show the whole file.
The preload takes its own `--import` out of `NODE_OPTIONS` only once the process reads the file, so a parent that merely starts the real Bob still hands it down, and it writes one line to stderr the first time it reads the file and finds nothing to hide, since the only other symptom would be anonymous platform calls.
The Bob preloads share [`bob-preload-lib.mjs`](rootfs/usr/local/lib/bob-preload-lib.mjs): the path an fs call names, the wrapping of renames and copies, and the `NODE_OPTIONS` cleanup.

The preload is written against Bob 2.0.6, which reads and writes the file through `node:fs` by that path.
`mise run //packages/agents:check:bob-mcp-file` fails when the image pins another Bob than the preload names, so a bump runs `mise run //packages/agents:test:bob-session-ref` with `BOB_CLI` naming the new Bob: its control scenario fails when Bob starts preferring a session's own entry, which is the moment to delete the preload, its line in `harness-chat`, and these tests; its other scenarios fail when Bob stops reading the file the way the preload expects.
`mise run //packages/agents:test:bob-mcp-file` checks the preload itself with a fake Bob and runs in CI.

### MCP startup

`bob acp` builds each session's harness as a non-interactive one, and Bob 2.0.6 ties the MCP startup mode to that flag.
Left alone, a `session/new`, `session/load` or `session/resume` answers only after every server of `mcp.json` finished its first connect.
A stdio server gets no timeout of its own: the per-server `timeout` reaches HTTP servers only, so one that never answers `initialize` holds each session for the MCP SDK's 60 s request timeout.
Every new chat then waits a minute for its first answer, and a reopen, which also spawns Bob, ran past agent-runtime's load budget before Bob's manifest raised it, so a single broken entry, such as an `npx` server an agent added for itself, stopped every chat on the agent.
`bob chat` starts the same servers in the background and is not affected.

So `harness-chat` always preloads [`bob-acp-patch.mjs`](rootfs/usr/local/lib/bob-acp-patch.mjs) into `bob acp`.
It edits Bob's bundle in memory as it loads, so the chat process starts the servers of `mcp.json` in the background too; their tools appear in a session once they connect.
The servers a session carries, the platform entry among them, are registered after that startup and still awaited, so the platform tools are there on the first turn.
A server that never gets ready still has its name in Bob's own log, `~/.bob/logs/shell/`, and nowhere in the chat.
The patch takes its own `--import` out of `NODE_OPTIONS` once Bob's bundle loads, and writes one `bob-acp-patch: not applied` line to stderr when the bundle is not the Bob it targets or its edit no longer matches.

`mise run //packages/agents:check:bob-acp-patch` fails when the image pins another Bob than the patch names, so a bump runs `mise run //packages/agents:test:bob-mcp-startup` with `BOB_CLI` naming the new Bob.
Its control scenario fails when Bob starts the servers in the background on its own, which is the moment to delete the patch, its line in `harness-chat`, the test and the check; its other scenario fails when the patch stops working.

## Authentication

Bob expects `BOBSHELL_API_KEY` in the machine's env (2.0 renamed it to `BOB_API_KEY`, but the old name is a supported alias — Bob copies it over and errors only if both are set to different values).
On the platform the agent only ever sees a **placeholder** — the real key is materialized at the credential gateway, never in the machine.

1. **Open Settings → Providers → Bob Shell** and paste your Bob API key.
   The provider preset creates a secret pinned to `api.us-east.bob.ibm.com` (unchanged in 2.0) with `Authorization: Apikey {value}` injection plus a twin entry on the same host that handles the `?key=` URL parameter Bob appends to several admin endpoints.
   `BOBSHELL_API_KEY` is seeded as `dummy-placeholder` — the literal content is irrelevant because Envoy overwrites the wire value, but it must not start with `sk-`/`pk-` or Bob's bundle would silently downgrade to the legacy `prod.ibm-bob-staging.cloud.ibm.com` backend (which only accepts JWT keys).
   The Advanced disclosure lets you set the default model and tenant-scoping flags (see below) — those flow as additional env-mappings rather than free-form env vars in the agent dialog.

2. **Grant the secret to the Bob agent instance** from Configure Agent → Secrets.
   The next machine start picks up `BOBSHELL_API_KEY` and any pinned `BOB_*` envs along with the gateway's filter chain.

The flow per request: Bob's `fetch()` sets `Authorization: Apikey dummy-placeholder` and tunnels through `HTTPS_PROXY` → Envoy terminates TLS using the platform CA → `credential_injector` rewrites the header to `Apikey bob_prod_…` from the K8s Secret → upstream sees the valid token.
See [`docs/architecture/security-and-credentials.md`](../../../docs/architecture/security-and-credentials.md) and [`docs/architecture/credential-gateway.md`](../../../docs/architecture/credential-gateway.md).

With the API key present Bob never asks to authenticate, so the `sso` auth method it advertises is dead weight here — an agent whose secret was never granted fails `session/new` with `auth_required` instead.

### Endpoints that read the key from the URL

Some Bob backends (`/key/info?key=<value>`) read the credential from a URL query parameter.
The Bob Connection Template therefore carries a second `egress-inject` Contribution on the same host with `queryParamName: key`, so the gateway injects the same credential there too.
See [credential-gateway](../../../docs/architecture/credential-gateway.md#envoy-credential-injection) for the Envoy URL-rewrite path.

## Autonomy posture

Both surfaces run `--trust --accept-license`, because Bob refuses to open a session in an untrusted workspace and the platform's workspace arrives as a plain `cwd`, with no one to answer a trust prompt.

Both surfaces also auto-approve by default, and **that is a Bob limitation, not a platform preference**.
Bob's ACP decides a tool call like this: a built-in skill, a `read`-permission tool, or `--auto-approve` runs; anything else asks the client.
There is no middle setting.
Bob does own a finer posture — permission groups, a per-tool executor allowlist, and a default allowlist of safe commands (`cat`, `ls`, `git status`, `grep`, …) — but the only code that consults it is Bob's TUI approval handler, reached through its own terminal-app singletons.
The ACP path never sees it.

So asking means asking about *everything* except file reads: one execute tool, five edit tools, browser and MCP all prompt, and Bob is a shell assistant that reaches for `execute_command` constantly.
A prompt per `ls` is worse than no prompt at all, which is why the default stands at `--auto-approve`.

**Approvals** in the agent's Config panel turns per-tool prompts on for an agent that wants them (allow once / always allow / reject / always reject, an "always" remembered per tool name for the session); `BOB_AUTO_APPROVE=0` does the same from the env.
Two things to know before switching: an unattended session has nobody to answer, so a request expires against agent-runtime's TTL and the tool call aborts; and one "always allow" on `execute_command` silences commands for the rest of that session anyway.
Per-session granularity would have to come from Bob — approvals wired to its modes, or `session/set_config_option` registered in its ACP host.

Guardrails that stay active: `approval.outsideWorkspaceAllowed` is a hard gate ahead of any approval decision (the settings bootstrap opens it, or Bob would refuse every tool touching `$HOME` — skills, rules), `session.maxTurns` (Bob default 100) ends a runaway task, and `session.maxCost` caps spend per task.

## Configuration

`bob acp` parses only `--trust`, `--auto-approve`, `--accept-license`, `--log-level` and `--disable-{mcp,subagents}` — model, mode and cost have no flag on that surface, so they ride `~/.bob/settings/settings.json`, which `bob-settings.mjs` merge-writes from the env before either surface starts.
Settings come from three places, in this order of precedence: the agent's **Config panel**, then the **Bob Shell provider** pins, then free-form **Configure Agent → Env**.

Bob cannot switch a live session's model and reads one settings file per process, so every model call goes to the agent-runtime [Model Router](../../../docs/architecture/harness-config.md#the-model-router): the runtime sets `BOB_GATEWAY_URL` (the variable Bob's own client reads) to the router with a placeholder key, and the router routes each call by the model the runtime set for the session, keyed by the `X-Task-Id` Bob stamps on its calls (the root task id is the ACP session id).
Bob stamps it on every call except the first call of a new task, which asks for the model `background`.
The router books that call's [spend](../../../docs/architecture/spend-limits.md#ledger) to the running Bob turn still waiting for its first call.
The settings file's `session.model` is only the fallback for a call made before that choice is known: the agent's default model for Bob, `PLATFORM_BOB_DEFAULT_MODEL`, which the runtime sets unless that default is Bob's own gateway.
Bob accepts a reply naming another model than it asked for, so one Bob process serves every session and provider.
Bob's subagents ask for a tier alias of Bob's own gateway (`premium-ide`, `explorer`) with `X-Parent-Task-Id` on their calls; the router sends those to the session's subagent model, else to the session's model.

A Bob process the platform starts with session approvals of its own still gets a settings file of its own, `~/.bob/platform-processes/<hash>/settings.json`: [`bob-settings-file.mjs`](rootfs/usr/local/lib/bob-settings-file.mjs), preloaded through `NODE_OPTIONS` into `bob acp` only, redirects Bob's reads, writes, renames and watches of `~/.bob/settings/settings.json` to the file `BOB_SETTINGS_FILE` names.
`bob-settings.mjs` runs without it, so it reads the agent-wide choices from the shared file and writes the process's copy.
The rest of `~/.bob` (task store, rules, MCP configuration) stays shared.
`mise run //packages/agents:test:bob-settings-isolation` checks the redirect; `mise run //packages/agents:live:bob-router-rewrite` drives the real Bob against a mock router, by hand: it needs `BOB_CLI` naming Bob and does not run in CI.

### The Config panel (per agent)

The manifest declares a `harness-config` driver, which is what puts the panel on the agent at all, and it declares three options: **Model**, **Mode** (`agent` / `plan` / `ask`) and **Approvals** (`auto` / `ask`).
The panel shows Mode and Approvals; the model is picked per session, in the chat's session picker, from the same list.

The panel writes into a `platform` section of the settings file that **Bob itself ignores**, not into `session.*`.
That indirection is load-bearing: `bob-settings.mjs` rewrites Bob's own keys on every harness start, so a panel writing them directly would be overwritten by the provider pin (or deleted when the pin is cleared).
Instead the bootstrap reads the `platform` section, resolves panel value over provider pin, and writes the result — so a panel choice survives every restart, and an agent with no panel choice still follows the pin.

Approvals cannot ride the settings file at all, because Bob's ACP reads them from a CLI flag at spawn.
The bootstrap therefore prints the mode it resolved and the harness scripts translate it into `--auto-approve`.
A session's own approvals choice arrives as `BOB_SESSION_APPROVALS`, which wins over the panel; it is part of the process's lease, so a session asking every time runs on a Bob process of its own.

Two consequences worth knowing:

- **A change lands on the next harness start — which the apply now brings about.** Neither surface re-reads the file mid-session, so the platform recycles the harness after writing the panel event: idle, right away; mid-turn, once the work drains.
  A session in flight keeps the posture it started with and is closed by the recycle, so the pick applies without waiting for something else to restart Bob.
- **The file stays yours.** A panel value is never reconciled away, so a hand-edit through the Files panel or SSH survives — including one to the `platform` section.

### Where the Model list comes from

The session picker's Model choices are the Model Catalog's view of Bob: every granted provider's chat-capable models under provider-qualified names (`ibm/aws/claude-sonnet-4-6`, `cb/rits/zai-org/glm-5-3`, `bob/premium-ide`), listed by agent-runtime per Connection and served to Bob itself as a LiteLLM-shaped `/inference/v1/model/info` on the router, the endpoint Bob reads its models and prices from.
The Bob Shell Connection's own gateway (`BOB_DEFAULT_GATEWAY_URL`) is listed through the same catalog; its model-info's limits and prices outrank the price table.
Bob's `/admin/v1` calls belong to its own gateway and get a 404 from the router, which Bob tolerates.

A Bob Shell connection made before `BOB_DEFAULT_GATEWAY_URL` was added to the preset does not carry it: re-save the provider in Settings → Providers once to pick it up, otherwise the catalog lists no Bob-gateway model and the rest keeps working.
A listing that cannot be read keeps that Connection's last known list and never empties another's.

### Pinned via the Bob Shell provider (Settings → Providers → Bob Shell → Advanced)

These ride on the secret's `envMappings`, so every agent granted the Bob secret inherits them automatically — no per-agent re-entry.

| Env var                   | Translated to                            | Effect                                                                                                                                                                                             |
| ------------------------- | ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `BOBSHELL_API_KEY`        | n/a (env-only)                           | API key the credential gateway swaps to the real value on the wire. Always emitted.                                                                                                                |
| `BOB_DEFAULT_GATEWAY_URL` | n/a (env-only)                           | Gateway the session picker's model list is read from when nothing redirects Bob. Always emitted, pinned to the host the secret is scoped to.                                                       |
| `BOB_SHELL_MODEL`         | `session.model`                          | Default model for new tasks, unless the session picks one. Examples: `premium-shell`, `codestral-2508`, `claude-sonnet-5`. Empty → Bob's built-in default.                                         |
| `BOB_CHAT_MODE`           | `session.defaultMode`                    | One of `agent`, `plan`, `ask` (2.0 merged `code`/`advanced` into `agent`; legacy pinned values are mapped onto `agent`). Starting mode for new sessions, unless the agent's Config panel sets one. |
| `BOB_MAX_COINS`           | `session.maxCost`                        | Per-task cost cap — Bob stops the task when exceeded.                                                                                                                                              |
| `BOB_INSTANCE_ID`         | `bob chat --instance-id` (terminal only) | IBM tenant scoping. Neither `bob acp` nor the settings file takes an instance, so this pin does not reach chat-mode sessions; headless instance selection goes through Bob profiles.               |
| `BOB_TEAM_ID`             | `bob chat --team-id` (terminal only)     | Team ID for `general`-type API keys. Terminal-only for the same reason.                                                                                                                            |

Per-agent overrides for any of these still work — set the same env name in **Configure Agent → Env** and it wins over the inherited pin.

### Running against another gateway (IBM LiteLLM)

Granting the **IBM ETE LiteLLM Proxy** connection lists that proxy's models in the catalog, under `ibm/…`; Curve Bender's under `cb/…`.
Bob itself is unchanged: its `/inference/v1` prefix is compiled in, and the router folds it.
The LiteLLM key needs model access only: the catalog lists the proxy through `/v1/models` and prices its models from the vendored LiteLLM table.
A session's pick is a qualified name the router routes outright; the preset's `BOB_SHELL_MODEL` pin never reaches a routed Bob process.

A connection's contributions are projected when it is created, so a LiteLLM connection made before the gateway env shipped carries none and lists nothing.
Editing it does not help: the edit dialog replaces the credential and nothing else, and contributions are never recomputed.
Delete it and create it again to pick the new ones up.

### Free-form env vars (Configure Agent → Env)

Less common toggles, not surfaced on the provider card.

| Env var            | Effect                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `BOB_AUTO_APPROVE` | Set to `0` to make sessions ask per tool call instead of auto-approving, for an agent whose Config panel leaves Approvals unset (see [Autonomy posture](#autonomy-posture)).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `BOB_LOG_LEVEL`    | Bob's log level: `debug`, `info`, `warn`, `error`, `silent`. Logs go to stderr; stdout belongs to the ACP stream.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `BOB_TELEMETRY_*`  | The platform's export rail, not free-form: `BOB_TELEMETRY_PROVIDER`, `_URL`, `_SERVICE_PATH` and `_AGENT_OPS_ENABLED` are set for the agent when the telemetry backend is enabled, pointing Bob's OTLP exporter at the platform collector through the ordinary gateway egress. Overriding them by hand redirects the agent's spend telemetry, so leave them to the rail. Bob also reads the standard `OTEL_EXPORTER_OTLP_*` variables: a set endpoint among them overrides the provider and also sends a copy of the export to IBM's own endpoint, so those stay unset as well. The exporter ignores `HTTPS_PROXY`, so on the platform the export does not reach the collector today. |

Telemetry has no env switch.
Bob reads `telemetry.enabled` from `~/.bob/settings/settings.json`, and the bootstrap keeps whatever that section already holds apart from asserting `excludePayload`, so setting it to `false` by hand (Files panel or SSH) survives every restart.

Gone, and silently ignored if an old agent still sets them: `BOBSHELL_HIDE_ENVS`, `BOB_SHELL_PRE_CHECK_AUTO_APPROVED`, `BOB_SHELL_SYSTEM_MD` (custom instructions now ride the `.bob/rules/` directory — the image links the platform instructions there), `BOB_RESUME_MAX_MESSAGES` and `BOB_SHIM_TRACE` (both belonged to the bridge — resume is native and there are no shim frames to trace).

The settings bootstrap also **prunes** the keys the bridge used to write into `approval` — `autoApprovalEnabled`, `allowed_permissions`, `allowedExecutors` — so an agent upgraded in place stops carrying a deleted component's posture and falls back to Bob's own defaults, with the auto-approve flag as the single source of truth.

Bob reads `AGENTS.md` only in the session's `cwd`, the work directory, and never in a parent, so it would miss the agent's own `~/AGENTS.md` ([agent instructions](../../../docs/architecture/agent-images.md#agent-instructions)).
The settings bootstrap links it as the global rule `~/.bob/rules/agent.md` while the home has that file, and removes the link when it does not, since a dangling rule warns on every task.
A regular file of that name is the owner's and stays.

The settings bootstrap also pins `bobShell.autoUpdate: false`: the image pins the version, and a self-update inside the machine would both fail against the egress rules and print onto stdout.

## Harness scripts

| Script                                                      | Behavior                                                                                                                                                                                                                                                                                                                                                              |
| ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`harness-chat`](rootfs/usr/local/bin/harness-chat)         | Runs `bob-settings.mjs`, turns the approval mode it printed into `--auto-approve` or nothing, preloads [`bob-mcp-file.mjs`](rootfs/usr/local/lib/bob-mcp-file.mjs) and [`bob-acp-patch.mjs`](rootfs/usr/local/lib/bob-acp-patch.mjs), then `exec`s `bob acp`. A failed bootstrap fails the harness — without the posture Bob refuses every tool that touches `$HOME`. |
| [`harness-terminal`](rootfs/usr/local/bin/harness-terminal) | Same bootstrap and approval translation, plus the tenant-scoping env as `bob chat` flags, then `exec`s the TUI — with `--resume <task>` when the session has a pinned Bob task (see [Terminal sessions](#terminal-sessions)).                                                                                                                                         |
| [`bob-pin-session`](rootfs/usr/local/bin/bob-pin-session)   | The `SessionStart` hook that pins a terminal session's Bob task. A no-op outside a terminal session.                                                                                                                                                                                                                                                                  |

## Session history

Bob persists every task to SQLite in `~/.bob/db/bob.db` on the machine's disk and serves ACP history from it, so the platform's sidebar, replay and resume are all native reads — see [ACP](#acp) above.
Terminal-mode tasks land in the same store and therefore also appear in the session list.

### Terminal sessions

Bob mints its task id on the first turn, so the platform session id cannot be passed in.
The settings bootstrap therefore registers a global `SessionStart` hook (matcher `startup`) in `~/.bob/settings/settings.json`, re-asserted on every start next to whatever hooks are already there.
It records the new task's id under `~/.bob/platform-sessions/$HARNESS_SESSION_ID`, and `harness-terminal` resumes that task whenever the file exists, so reopening a terminal session after its idle shutdown or a hibernation brings the conversation back.
A terminal closed before its first turn leaves no pin and starts fresh next time.
A pin whose task was deleted makes Bob report the missing task and open a fresh one, which pins itself in turn.
Setting `disableGlobalHooks` in the settings file turns the pin off too.

Chat sessions created before 2.0.2 are not reachable: their ids were minted by the old translation shim (`bob-<uuid>`) and mean nothing to Bob, so `session/load` answers `resourceNotFound`.
Their Bob-side tasks survive and can still be resumed from the terminal with `bob -r`.

## Persistence

`/home/agent`, on the machine's disk, keeps Bob's task DB (`~/.bob/db/`), settings (`~/.bob/settings/`), logs, and whatever Bob writes during a session (workspace files, MCP server configs).
Survives restarts, hibernation and image rebuilds.
