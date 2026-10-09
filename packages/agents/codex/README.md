# Codex Agent

Platform agent running [OpenAI Codex CLI](https://github.com/openai/codex) via the [codex-acp](https://github.com/agentclientprotocol/codex-acp) ACP adapter.

The harness ships in the default image every harness Template boots, built by `//packages/agents:oci` from the shared base in [`packages/agents/base`](../base/) (see [agent images](../../../docs/architecture/agent-images.md)): its tools, declared in [`image.toml`](image.toml), come from the node's harness tools, and its files live at their image paths under [`rootfs/`](rootfs/).

## Stack

| Component | Package | Purpose |
|---|---|---|
| ACP bridge | `@agentclientprotocol/codex-acp` | Translates ACP <> Codex app-server for chat sessions |
| Terminal CLI | `@openai/codex` | Interactive TUI for terminal sessions; the copy codex-acp depends on, linked onto `PATH` as `codex` |

## Authentication

Codex requires an OpenAI API key. On the platform, the actual credential is never stored in the pod -- the Envoy sidecar injects it on the wire (see [ADR-033](../../../docs/adrs/033-envoy-credential-gateway.md)).

Create a **generic secret** on the platform with:
- `hostPattern`: `api.openai.com`
- env-mapping: `OPENAI_API_KEY`

The harness config sets `OPENAI_API_KEY=dummy-placeholder` (`[oci.env]` in `image.toml`) so the CLI's startup check passes before a real credential is attached.

### Custom OpenAI-compatible endpoints

To point Codex at an OpenAI-compatible proxy or self-hosted endpoint, add `OPENAI_BASE_URL` to the secret's env-mappings:

```json
[
  { "envName": "OPENAI_API_KEY", "placeholder": "dummy-placeholder" },
  { "envName": "OPENAI_BASE_URL", "placeholder": "https://my-proxy.example.com/v1" }
]
```

The harness scripts point the `openai-platform` provider's `base_url` at `OPENAI_BASE_URL` with a `-c` override. In chat mode, codex-acp starts `codex app-server` through [`codex-app-server`](rootfs/usr/local/bin/codex-app-server), which adds the override. The override must apply to the app-server process and not only to codex-acp's `CODEX_CONFIG`: codex-acp starts some threads without `CODEX_CONFIG`, for example the thread that makes a session's title. Without the override, these threads send the user's first message to `api.openai.com`. Update the secret's `hostPattern` to match the proxy host so the Envoy sidecar injects the credential on the right outbound requests.

### Model selection

The chat's session picker lists the models the granted endpoint serves (`<OPENAI_BASE_URL>/models`, with `/v1` added when the base URL carries no version segment). Codex cannot switch a live session's model, so the platform runs one Codex process per picked model and passes it as `PLATFORM_MODEL`, which the harness scripts put first. Codex's own `/model` picker still shows its built-in OpenAI catalog, which an OpenAI-compatible endpoint need not serve.

With no session pick, a `model` set in `~/.codex/config.toml` wins over the provider's `OPENAI_MODEL` pin. It can come from `/model` or a hand-edit. The harness scripts pass the pin only when the file sets none.

## The platform writes `~/.codex/config.toml`

Codex reads MCP servers only from `[mcp_servers.*]` in its own config file, so the platform writes that file rather than a separate one:

- **MCP servers.** The runtime channel adds, updates and removes the `[mcp_servers.*]` entries it placed there, one per granted MCP connection plus the platform's own. Servers you add by hand are kept.
- **Effort.** The Config panel writes `model_reasoning_effort`.

Each of these writes re-serializes the whole file. Every key and value you set survives, but comments and blank lines are dropped, so keep notes elsewhere.

A file that does not parse is never replaced. The write fails and reports a delivery failure, and the file stays as it is until you fix it.

## Startup network calls

[`/etc/codex/config.toml`](rootfs/etc/codex/config.toml) turns off the Codex calls that would ask for egress approval each time a Codex process starts:

- `check_for_update_on_startup = false` stops the update check. The image pins the CLI.
- `[features] plugins = false` stops the plugin catalog sync from `chatgpt.com`, `github.com` and `api.github.com`. MCP servers in `[mcp_servers.*]` are not plugins, so they still start.

The terminal TUI still fetches its announcement tip from `raw.githubusercontent.com`. Codex has no setting to turn that off.

## Harness scripts

| Script | Runs | Purpose |
|---|---|---|
| [`harness-chat`](rootfs/usr/local/bin/harness-chat) | `codex-acp` | ACP subprocess for chat-mode sessions (UI); runs `codex app-server` through `codex-app-server` |
| [`harness-terminal`](rootfs/usr/local/bin/harness-terminal) | `codex` / `codex resume <thread>` | Interactive TUI for terminal-mode sessions |

Both modes run without approvals or Codex's own sandbox, since the pod itself is the sandbox (network isolation + Envoy credential injection): terminal sessions pass `--dangerously-bypass-approvals-and-sandbox`, and chat sessions start in codex-acp's `agent-full-access` mode, which it sends with every turn and which therefore outranks `/etc/codex/config.toml`.

Codex mints its own thread id on the first turn, so the platform session id cannot be passed in. A managed `SessionStart` hook ([`requirements.toml`](rootfs/etc/codex/requirements.toml), shipped as `/etc/codex/requirements.toml` and therefore pre-trusted) records the thread id under `~/.codex/platform-sessions/$HARNESS_SESSION_ID`; `harness-terminal` resumes that thread when the file exists and starts a fresh conversation otherwise. A terminal closed before its first turn leaves no pin and simply starts fresh next time. The runtime manifest names the same directory as `terminalSessionPins`, so the session list shows the thread once, under the terminal session, with Codex's title.

## Usage

```sh
mise run cluster:install        # first time
mise run cluster:build -- agents    # rebuild after changes
```

Create an agent from the **codex** template in the Platform UI, attach an OpenAI credential, and open a session.
