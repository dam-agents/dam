# Codex Agent

Platform agent running [OpenAI Codex CLI](https://github.com/openai/codex) via the [codex-acp](https://github.com/zed-industries/codex-acp) ACP adapter.

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

The Dockerfile sets `OPENAI_API_KEY=dummy-placeholder` so the CLI's startup check passes before a real credential is attached.

### Custom OpenAI-compatible endpoints

To point Codex at an OpenAI-compatible proxy or self-hosted endpoint, add `OPENAI_BASE_URL` to the secret's env-mappings:

```json
[
  { "envName": "OPENAI_API_KEY", "placeholder": "dummy-placeholder" },
  { "envName": "OPENAI_BASE_URL", "placeholder": "https://my-proxy.example.com/v1" }
]
```

The harness scripts translate `OPENAI_BASE_URL` into Codex's `-c openai_base_url=...` config override. Update the secret's `hostPattern` to match the proxy host so the Envoy sidecar injects the credential on the right outbound requests.

## Harness scripts

| Script | Runs | Purpose |
|---|---|---|
| `harness-chat.sh` | `codex-acp` | ACP subprocess for chat-mode sessions (UI) |
| `harness-terminal.sh` | `codex` / `codex resume` | Interactive TUI for terminal-mode sessions |

Terminal sessions use `--dangerously-bypass-approvals-and-sandbox` since the pod itself is the sandbox (network isolation + Envoy credential injection).

## Usage

```sh
mise run cluster:install        # first time
mise run cluster:build-agent    # rebuild after changes
```

Create an agent from the **codex** template in the Platform UI, attach an OpenAI credential, and open a session.
