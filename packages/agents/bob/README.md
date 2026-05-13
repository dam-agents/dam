# Bob Agent

Platform agent running [Bob Shell](https://bob-shell.com/) — IBM's general-purpose AI shell assistant. Built on the platform-base image with an ACP translation shim and a per-instance Envoy egress sidecar that injects the Bob API key on outbound traffic.

## Stack

| Component | Source | Purpose |
|---|---|---|
| Harness | `bobshell` (IBM internal S3 distribution) | Bob CLI in `--experimental-acp` mode + native TUI |
| ACP bridge | `bob-acp-shim.mjs` (verbatim from upstream Bob) | Translates Bob's session/update events into the shape the platform UI expects; auto-approves `session/request_permission` because Bob launches with `--yolo` |
| Storage | `/home/agent` PVC (ADR-027) | Bob's session index lives under `~/.bob/`; survives pod restarts |

## Authentication

Bob expects `BOBSHELL_API_KEY` in the pod env. On the platform the agent only ever sees a **placeholder** — the real key is materialized at the Envoy sidecar, never in the agent container.

1. **Create a generic secret on the platform** scoped to the Bob backend host. The default header injection (`Authorization: Bearer {value}` on `prod.ibm-bob-staging.cloud.ibm.com`) is what Bob's HTTP client sends out, so a single secret with the host pattern + default config is enough for `/key/info` and the chat endpoints.

   ```yaml
   # via the Configure Agent UI
   hostPattern: prod.ibm-bob-staging.cloud.ibm.com
   injectionConfig:
     headerName: Authorization       # default
     valueFormat: "Bearer {value}"   # default
   envMappings:
     - { envName: BOBSHELL_API_KEY, placeholder: sk-dummy }
   ```

2. **Grant the secret to the Bob agent instance**. The next pod restart picks up the env var and the Envoy filter chain.

The flow per request: Bob's `fetch()` sets `Authorization: Bearer sk-dummy` and tunnels through `HTTPS_PROXY` → Envoy terminates TLS using the platform CA → `credential_injector` rewrites the header to the real `Bearer sk-…` from the K8s Secret → upstream sees the valid token. See [`docs/architecture/security-and-credentials.md`](../../../docs/architecture/security-and-credentials.md) and [ADR-033](../../../docs/adrs/033-envoy-credential-gateway.md).

### Endpoints that read the key from the URL

Some Bob backends (`/key/info?key=<value>` is the practical example) read the credential from a URL query parameter instead of `Authorization`. Bob's client happens to send the value in both places, but if you ever hit an endpoint that only accepts the URL form, create a **second** secret on the same host with `queryParamName: key`. The platform groups multiple secrets per host into a single Envoy filter chain — see [ADR-033 §Credential injection](../../../docs/adrs/033-envoy-credential-gateway.md#credential-injection) for the URL-query rewrite path.

## Autonomy posture (`--yolo`)

Bob runs with `bob --experimental-acp --yolo --auth-method api-key` (in [`bob-acp-shim.mjs`](bob-acp-shim.mjs)). The shim also auto-selects the first `allow_always` / `allow_once` option on every `session/request_permission` callback, so the platform UI never shows a permission chip for Bob the way it does for Claude / Codex / Pi.

This matches upstream Bob's deployment shape and is **deliberate** — the trust boundary is the per-instance Envoy egress sidecar (ADR-033/038), not in-agent prompts. Bob can write into its workdir and exec shell commands freely, but every outbound HTTP request still goes through the credential gateway with `ext_authz` / egress-rules enforcement, the agent container has no SA token, no Secret volume mounts, and no Envoy config it can rewrite.

If you need per-tool human-in-the-loop confirmation for Bob, that has to be re-introduced upstream — the shim's `pickAllowOption()` would need to fall through to an interactive path. The longer SECURITY NOTE in [`Dockerfile`](Dockerfile) covers the boundary in more detail.

## Configuration

Bob accepts settings from two channels: env vars it reads directly (resolved by Bob's runtime — set them in the Configure Agent → Env tab) and CLI flags that have no env equivalent (the harness scripts translate platform env vars into the right flag).

### Env vars Bob reads directly

Set them as custom env vars in the **Configure Agent** dialog → Env tab. They reach Bob's process unchanged.

| Env var | Effect |
|---|---|
| `BOBSHELL_API_KEY` | API key the Envoy sidecar swaps to the real value on the wire. Already wired by the secret's `envMappings`; no manual entry needed. |
| `BOB_SHELL_MODEL` | Default model for new sessions. Examples: `gemini-2.5-pro`, `gpt-5.6`, `claude-sonnet-5`. Empty → Bob picks its built-in default. |
| `BOBSHELL_HIDE_ENVS` | Set to `1` to suppress the env-var banner Bob prints at startup. |
| `BOB_SHELL_PRE_CHECK_AUTO_APPROVED` | Set to `1` to make Bob run a safety pre-check before executing auto-approved commands. Recommended on top of the shim's `--yolo` posture. |
| `BOB_SHELL_SYSTEM_MD` | Path to a markdown file appended to Bob's system prompt. Lives on the workspace PVC. |
| `IBM_TELEMETRY_ENABLED` | Set to `false` to opt out of Bob's telemetry. |

### Platform env vars translated to CLI flags

These are Bob CLI flags with no env equivalent — the harness scripts (`harness-chat.sh` and `harness-terminal.sh`) translate `BOB_*` env vars into the flag form before spawning Bob. Set them the same way (Configure Agent → Env tab).

| Env var | Translated to | Effect |
|---|---|---|
| `BOB_INSTANCE_ID` | `--instance-id` | Sets the `x-instance-id` header on Bob's outbound API calls (IBM tenant scoping). |
| `BOB_TEAM_ID` | `--team-id` | Sets the `x-team-id` header (IBM tenant scoping). |
| `BOB_MAX_COINS` | `--max-coins` | Budget cap — Bob exits with code 1 if exceeded. |
| `BOB_CHAT_MODE` | `--chat-mode` | One of `plan`, `code`, `advanced`, `ask`. Sets the default chat persona for new sessions. |

Settings that **cannot** be configured this way without changes to the shim:

- **Approval mode** — the shim hardcodes `--yolo` and auto-selects the first `allow_*` option on every `session/request_permission`. Moving Bob to `default` or `auto_edit` mode would require reworking `pickAllowOption()` in [`bob-acp-shim.mjs`](bob-acp-shim.mjs). See the SECURITY NOTE in [`Dockerfile`](Dockerfile) for why we accept the YOLO posture today.
- **Auth method** — the shim spawns Bob with `--auth-method api-key`. OAuth / Vertex paths would need a different shim invocation.
- **Sandbox** — Bob's `--sandbox` runs commands inside a separate sandbox subprocess. Overlaps with the platform's K8s-level sandboxing model (ADR-033); leave off.

## Harness scripts

| Script | Behavior |
|---|---|
| `harness-chat.sh` | Translates the `BOB_*` env vars and `exec`s `node /app/bob-acp-shim.mjs`. Bob advertises `agentCapabilities.loadSession: false` over ACP, so every `session/new` from agent-runtime spawns a fresh Bob session — chat resume is not possible at the ACP layer. |
| `harness-terminal.sh` | Same flag translation, then `exec bob --yolo --auth-method api-key`. Each terminal open starts a **fresh** Bob TUI session — Bob persists sessions in a project-scoped numeric index, not per-UUID files (the way pi-agent and claude-code do), so `$HARNESS_SESSION_ID` can't be mapped one-to-one. Users can browse prior sessions from inside the TUI with `--list-sessions` if needed. |

## Persistence

The `/home/agent` PVC keeps Bob's session index under `~/.bob/`, plus whatever Bob writes during a session (workspace files, MCP server configs). Survives pod restarts and image rebuilds.
