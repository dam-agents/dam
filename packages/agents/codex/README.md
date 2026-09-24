# Codex Agent

Platform agent running [OpenAI Codex CLI](https://github.com/openai/codex) via the [codex-acp](https://github.com/zed-industries/codex-acp) ACP adapter.

The image is built with [`mise oci`](https://mise.jdx.dev/dev-tools/mise-oci.html) from the shared base in [`packages/agents/base`](../base/) (see [`packages/agents`](../README.md)), as its `codex` config environment ([`image.toml`](image.toml)). Its files live at their image paths under [`rootfs/`](rootfs/).

## Stack

| Component | Package | Purpose |
|---|---|---|
| ACP bridge | `@zed-industries/codex-acp` | Translates ACP <> Codex protocol for chat sessions |
| Terminal CLI | `@openai/codex` | Interactive TUI for terminal sessions |

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

The harness scripts translate `OPENAI_BASE_URL` into Codex's `-c openai_base_url=...` config override. Update the secret's `hostPattern` to match the proxy host so the Envoy sidecar injects the credential on the right outbound requests.

### Model selection

The Config panel lists the models the granted endpoint serves (`<OPENAI_BASE_URL>/models`, with `/v1` added when the base URL carries no version segment). It writes the pick, plus the reasoning effort, into `~/.codex/config.toml`. Codex's own `/model` picker still shows its built-in OpenAI catalog, which an OpenAI-compatible endpoint need not serve.

A `model` set in `~/.codex/config.toml` wins over the provider's `OPENAI_MODEL` pin. It can come from the Config panel, `/model`, or a hand-edit. The harness scripts pass the pin as `-c model=...` only when the file sets none.

## The platform writes `~/.codex/config.toml`

Codex reads MCP servers only from `[mcp_servers.*]` in its own config file, so the platform writes that file rather than a separate one:

- **MCP servers.** The runtime channel adds, updates and removes the `[mcp_servers.*]` entries it placed there, one per granted MCP connection plus the platform's own. Servers you add by hand are kept.
- **Model and effort.** The Config panel writes `model` and `model_reasoning_effort`.

Each of these writes re-serializes the whole file. Every key and value you set survives, but comments and blank lines are dropped, so keep notes elsewhere.

A file that does not parse is never replaced. The write fails and reports a delivery failure, and the file stays as it is until you fix it.

## Harness scripts

| Script | Runs | Purpose |
|---|---|---|
| [`harness-chat`](rootfs/usr/local/bin/harness-chat) | `codex-acp` | ACP subprocess for chat-mode sessions (UI) |
| [`harness-terminal`](rootfs/usr/local/bin/harness-terminal) | `codex` / `codex resume <thread>` | Interactive TUI for terminal-mode sessions |

Terminal sessions use `--dangerously-bypass-approvals-and-sandbox` since the pod itself is the sandbox (network isolation + Envoy credential injection).

Codex mints its own thread id on the first turn, so the platform session id cannot be passed in. A managed `SessionStart` hook ([`requirements.toml`](rootfs/etc/codex/requirements.toml), shipped as `/etc/codex/requirements.toml` and therefore pre-trusted) records the thread id under `~/.codex/platform-sessions/$HARNESS_SESSION_ID`; `harness-terminal` resumes that thread when the file exists and starts a fresh conversation otherwise. A terminal closed before its first turn leaves no pin and simply starts fresh next time.

## Usage

```sh
mise run cluster:install        # first time
mise run cluster:build-agent    # rebuild after changes
```

Create an agent from the **codex** template in the Platform UI, attach an OpenAI credential, and open a session.
