# Codex Agent

Platform agent running [OpenAI Codex CLI](https://github.com/openai/codex) via the [codex-acp](https://github.com/agentclientprotocol/codex-acp) ACP adapter.

The harness ships in the default image every harness Template boots, built by `//packages/agents:oci` from the shared base in [`packages/agents/base`](../base/) (see [agent images](../../../docs/architecture/agent-images.md)): its tools, declared in [`image.toml`](image.toml), come from the node's harness tools, and its files live at their image paths under [`rootfs/`](rootfs/).

## Stack

| Component    | Package                          | Purpose                                                                                             |
| ------------ | -------------------------------- | --------------------------------------------------------------------------------------------------- |
| ACP bridge   | `@agentclientprotocol/codex-acp` | Translates ACP <> Codex app-server for chat sessions                                                |
| Terminal CLI | `@openai/codex`                  | Interactive TUI for terminal sessions; the copy codex-acp depends on, linked onto `PATH` as `codex` |

## Authentication

Codex requires an OpenAI API key.
On the platform, the actual credential is never stored in the pod -- the Envoy sidecar injects it on the wire (see [credential-gateway](../../../docs/architecture/credential-gateway.md)).

Create a **generic secret** on the platform with:

- `hostPattern`: `api.openai.com`
- env-mapping: `OPENAI_API_KEY`

The runtime sets `OPENAI_API_KEY` to the router's placeholder, which satisfies the CLI's startup check; the router drops it and owns the upstream credential.
The launch scripts fall back to `dummy-placeholder` only when nothing sets it.

### The Model Router

Every call Codex makes goes to the agent-runtime [Model Router](../../../docs/architecture/harness-config.md#the-model-router) on the pod's loopback: [`config.toml`](rootfs/etc/codex/config.toml) fixes the `openai-platform` provider's `base_url` there (the id stays, since rollouts record it), speaks the Responses API only (`wire_api = "responses"`), names the harness with `http_headers`, sends the platform's session id in a terminal with `env_http_headers`, and reads its model catalog from the router's `model_catalog_url`.
The router routes each call by its provider-qualified model name (`ibm/gpt-5.5`, `cb/rits/zai-org/glm-5-3`) to that Connection's host with the Connection's placeholder, so one Codex process serves every granted provider and no `-c base_url` override is needed on any thread, the title thread included.
A session's subagent model (`subagentModel`) is the router's: Codex's subagent threads carry their own `thread-id` beside the session's, and the router sends their calls to that model, whatever the thread asked for; a platform sub-agent spawned from the session runs on it too, whatever model the spawn names.

Codex fetches `model_catalog_url` only with `[features] api_key_model_discovery = true`, an under-development flag that is off by default; a pin bump must re-check it in `codex-rs/core/src/features.rs`.
With it, Codex's `/model` picker and codex-acp's `model/list` hold exactly the served catalog: the models of every granted provider the agent can reach, never the built-in OpenAI slugs.
Codex's deserializer drops a catalog whose entries carry no `model_messages.instructions_template`, and it refuses a catalog response over its body limit, which the full instructions on every model exceed once an agent holds an OpenAI key (over seventy models).
So each entry carries a one-line template, and [`config.toml`](rootfs/etc/codex/config.toml) sets `model_instructions_file` to [`model-instructions.md`](rootfs/etc/codex/model-instructions.md), which wins over any entry's template: Codex's own instructions, copied verbatim from the pinned release's bundled `gpt-5.5` entry (`codex-rs/core/models.json`), which a pin bump re-copies.
[`image.toml`](image.toml) pins codex-acp 2.1.1 and the Codex it bundles.

### Model selection

The model is a per-turn choice.
The platform sends it over ACP (`session/set_config_option`) before each prompt and again after a cold load; codex-acp accepts any slug the served catalog lists, so a running thread switches providers between turns with no process restart.
No model is written into `~/.codex/config.toml` and the harness scripts pin none; the terminal TUI starts on the session's model through `-c model=`.
After the first turn codex-acp makes a title with a hard-coded bare `gpt-5.6-luna`; the router puts that call, like every bare name Codex sends (`bareNamesFromSession`), on the session's model.

## The platform writes `~/.codex/config.toml`

Codex reads MCP servers only from `[mcp_servers.*]` in its own config file, so the platform writes that file rather than a separate one:

- **MCP servers.** The runtime channel adds, updates and removes the `[mcp_servers.*]` entries it placed there, one per granted MCP connection plus the platform's own.
  Servers you add by hand are kept.
- **Effort.** The Config panel writes `model_reasoning_effort`.
  The model itself is never written: it is a per-turn choice sent over ACP.

Each of these writes re-serializes the whole file.
Every key and value you set survives, but comments and blank lines are dropped, so keep notes elsewhere.

A file that does not parse is never replaced.
The write fails and reports a delivery failure, and the file stays as it is until you fix it.

## Platform instructions

The platform instructions in `/etc/AGENTS.md` reach Codex as its `developer_instructions`.
That setting takes the text itself, and Codex has no setting that reads it from a file.
So `codex-app-server` and `harness-terminal` read the file at every start and pass its text with `-c developer_instructions=...`, quoted as a TOML string by `jq`.
A Codex process therefore always gets the instructions of the image it runs in, also in an agent that existed before an image update.

`~/.codex/AGENTS.md` is not used for this: it is the user's own global instructions file, and it lives in the persistent home, so the image cannot keep it current.
A user's `~/.codex/AGENTS.md` and `work/AGENTS.md` still load beside the platform instructions.

## Startup network calls

[`/etc/codex/config.toml`](rootfs/etc/codex/config.toml) turns off the Codex calls that would ask for egress approval each time a Codex process starts:

- `check_for_update_on_startup = false` stops the update check.
  The image pins the CLI.
- `[features] plugins = false` stops the plugin catalog sync from `chatgpt.com`, `github.com` and `api.github.com`.
  MCP servers in `[mcp_servers.*]` are not plugins, so they still start.
- `[features] daemon_auto_start = false` stops the terminal TUI from starting a shared app-server daemon.
  That daemon outlives the session, runs from its own copy of the CLI under `~/.codex/packages/`, and checks for and installs updates every hour, which restarts it mid-turn.

The terminal TUI still fetches its announcement tip from `raw.githubusercontent.com`.
Codex has no setting to turn that off.

## Telemetry

With the telemetry backend on (`clickstack.enabled`), the `codex` rail in the harness catalog gives Codex `OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_LOGS_EXPORTER=otlp` and `OTEL_TRACES_EXPORTER=otlp` (see [observability](../../../docs/architecture/observability.md#agent-export)).
Codex reads its exporters only from the `[otel]` table of `config.toml` and never from that env.
So [`codex-otel.sh`](rootfs/usr/local/lib/codex-otel.sh), which `codex-app-server` and `harness-terminal` source, turns the env into `-c otel.*` flags:

- Log records go to `<endpoint>/v1/logs` and traces go to `<endpoint>/v1/traces`, over OTLP/HTTP protobuf.
- `log_user_prompt`, `log_agent_responses` and `log_guardian_assessments` are pinned to `false`.
  A `-c` flag outranks `~/.codex/config.toml`, so a hand-set `[otel]` table cannot turn them on while the rail is on.

Without the rail, the scripts add no flag and Codex exports nothing.

Codex's exporter honours `HTTPS_PROXY` and trusts the CA bundle in `SSL_CERT_FILE`, so the export goes through the gateway and gets the trusted agent attribution.
Codex fixes its own service name for each kind of process (`codex-app-server` for chat sessions) and ignores `OTEL_SERVICE_NAME`.
It reads `OTEL_RESOURCE_ATTRIBUTES`, so `platform.agent.name` arrives, but still URL-encoded.

Codex's records do not have the shape the Usage reads take, and its tool-result records carry each tool call's arguments and an output preview.
The platform's collector therefore reshapes every `codex.*` log record:

- It keeps only structural attributes, so tool arguments, tool output and the account e-mail are never stored.
- It sets the body to the event name and `session.id` to `conversation.id`, the Codex thread id that codex-acp uses as the session id.
- It renames the per-call usage record (`codex.sse_event` of kind `response.completed` with token counts) to `codex.response_completed`, with `input_tokens` (net of cache reads), `output_tokens`, `cache_read_tokens` and `cache_creation_tokens`.

Codex reports no per-call cost.
The Model Router prices every Codex call in a `platform.model_call` record of its own, and the Usage reads take the router's record where there is one, so Codex's own usage records count, as tokens at zero cost, only where no router record reached the store.
Session titles run on a Codex thread of their own, so their calls count for the agent but not for the chat session.

With the log exporter on, the chat app-server also starts Codex's turn-cost poller.
The poller asks OpenAI's backend for turn prices only for a Codex login (`codex login`, or `CODEX_API_KEY`).
The provider's `OPENAI_API_KEY` is not a login, so the poller stays idle and sends nothing.
After a `codex login` in the terminal, it polls `chatgpt.com`, which the gateway holds for egress approval like any new host.

## Harness scripts

| Script                                                      | Runs                              | Purpose                                                                                                                                 |
| ----------------------------------------------------------- | --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| [`harness-chat`](rootfs/usr/local/bin/harness-chat)         | `codex-acp`                       | ACP subprocess for chat-mode sessions (UI); runs `codex app-server` through [`codex-app-server`](rootfs/usr/local/bin/codex-app-server) |
| [`harness-terminal`](rootfs/usr/local/bin/harness-terminal) | `codex` / `codex resume <thread>` | Interactive TUI for terminal-mode sessions                                                                                              |

Both modes run without approvals or Codex's own sandbox, since the pod itself is the sandbox (network isolation + Envoy credential injection): terminal sessions pass `--dangerously-bypass-approvals-and-sandbox`, and chat sessions start in codex-acp's `agent-full-access` mode, which it sends with every turn and which therefore outranks `/etc/codex/config.toml`.

Codex mints its own thread id on the first turn, so the platform session id cannot be passed in.
A managed `SessionStart` hook ([`requirements.toml`](rootfs/etc/codex/requirements.toml), shipped as `/etc/codex/requirements.toml` and therefore pre-trusted) records the thread id under `~/.codex/platform-sessions/$HARNESS_SESSION_ID`; `harness-terminal` resumes that thread when the file exists and starts a fresh conversation otherwise.
A terminal closed before its first turn leaves no pin and simply starts fresh next time.
The runtime manifest names the same directory as `terminalSessionPins`, so the session list shows the thread once, under the terminal session, with Codex's title.

## Usage

```sh
mise run cluster:install        # first time
mise run cluster:build -- agents    # rebuild after changes
```

Create an agent from the **codex** template in the Platform UI, attach an OpenAI credential, and open a session.
