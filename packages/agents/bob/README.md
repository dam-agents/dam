# Bob Agent

Platform agent running [Bob Shell](https://internal.bob.ibm.com/docs/shell) — IBM's general-purpose AI shell assistant. Built on the platform-base image with an ACP translation shim and a per-instance Envoy egress sidecar that injects the Bob API key on outbound traffic.

## Stack

| Component | Source | Purpose |
|---|---|---|
| Harness | `bobshell` (installed from `bob.ibm.com/download/bobshell.sh`) | Bob CLI in `--experimental-acp` mode + native TUI |
| ACP bridge | `bob-acp-shim.mjs` | Translates Bob's session/update events into the shape the platform UI expects; auto-approves `session/request_permission` (Bob's ACP doesn't actually issue per-tool HITL requests for built-in tools — see autonomy posture below); stages chat attachments into the workspace so Bob can read them (it can't consume `resource_link` blocks in ACP mode) |
| Storage | `/home/agent` PVC (ADR-027) | Bob's session index lives under `~/.bob/`; survives pod restarts |

## Authentication

Bob expects `BOBSHELL_API_KEY` in the pod env. On the platform the agent only ever sees a **placeholder** — the real key is materialized at the Envoy sidecar, never in the agent container.

1. **Open Settings → Providers → Bob Shell** and paste your Bob API key. The provider preset creates a secret pinned to `api.us-east.bob.ibm.com` (the host Bob's bundle uses for `/v1/model/info`, `/key/info`, `/chat/completions` etc. with the current opaque api-key format) with `Authorization: Apikey {value}` injection plus a twin entry on the same host that handles the `?key=` URL parameter Bob appends to several admin endpoints. `BOBSHELL_API_KEY` is seeded as `dummy-placeholder` — the literal content is irrelevant because Envoy overwrites the wire value, but it must not start with `sk-`/`pk-` or Bob's bundle would silently downgrade to the legacy `prod.ibm-bob-staging.cloud.ibm.com` backend (which only accepts JWT keys). The Advanced disclosure lets you set the default model and tenant-scoping flags (see below) — those flow as additional env-mappings rather than free-form env vars in the agent dialog.

2. **Grant the secret to the Bob agent instance** from Configure Agent → Secrets. The next pod restart picks up `BOBSHELL_API_KEY` and any pinned `BOB_*` envs along with the Envoy filter chain.

The flow per request: Bob's `fetch()` sets `Authorization: Apikey dummy-placeholder` and tunnels through `HTTPS_PROXY` → Envoy terminates TLS using the platform CA → `credential_injector` rewrites the header to `Apikey bob_prod_…` from the K8s Secret → upstream sees the valid token. See [`docs/architecture/security-and-credentials.md`](../../../docs/architecture/security-and-credentials.md) and [ADR-033](../../../docs/adrs/033-envoy-credential-gateway.md).

### Endpoints that read the key from the URL

Some Bob backends (`/key/info?key=<value>`) read the credential from a URL query parameter. The provider preset's `extraInjections` automatically creates a second "twin" K8s Secret on the same host with `queryParamName: key`; the platform-side service cascades grants/updates/deletes onto it. See [ADR-044](../../../docs/adrs/044-provider-twin-secrets.md) for the twin-secret pattern and [ADR-033 §Credential injection](../../../docs/adrs/033-envoy-credential-gateway.md#credential-injection) for the Envoy URL-rewrite path.

## Autonomy posture

Bob runs with `bob --experimental-acp --yolo --auth-method api-key` (in [`bob-acp-shim.mjs`](bob-acp-shim.mjs)) and the shim auto-approves any `session/request_permission` Bob does emit, so the platform UI never shows a per-tool confirmation chip for Bob.

This is **forced by Bob upstream**, not a platform choice: every Bob built-in tool's `shouldConfirmExecute()` returns `false` when `!isInteractive()`, so even in `default`/`auto_edit` mode Bob never calls `client.requestPermission()` via ACP for shell exec or file writes — those modes just refuse the tool outright with a "not allowed in non-interactive mode" error. `--yolo` is the only setting under which Bob's ACP mode actually runs tools.

The trust boundary is the per-instance Envoy egress sidecar (ADR-033/038): every outbound HTTP request goes through the credential gateway with `ext_authz` / egress-rules enforcement, the agent container has no SA token, no Secret volume mounts, and no Envoy config it can rewrite.

## Configuration

Bob accepts settings from two channels: env vars it reads directly (resolved by Bob's runtime) and CLI flags that have no env equivalent (the harness scripts translate platform env vars into the right flag). The Bob Shell provider preset pins the most common ones; the rest stay free-form in **Configure Agent → Env**.

### Pinned via the Bob Shell provider (Settings → Providers → Bob Shell → Advanced)

These ride on the secret's `envMappings`, so every agent granted the Bob secret inherits them automatically — no per-agent re-entry.

| Env var | Translated to | Effect |
|---|---|---|
| `BOBSHELL_API_KEY` | n/a (env-only) | API key the Envoy sidecar swaps to the real value on the wire. Always emitted. |
| `BOB_SHELL_MODEL` | n/a (env-only) | Default model for new sessions. Examples: `premium-shell`, `codestral-2508`, `claude-sonnet-5`. Empty → Bob's built-in default. |
| `BOB_INSTANCE_ID` | `--instance-id` | Sets the `x-instance-id` header on Bob's outbound API calls (IBM tenant scoping). |
| `BOB_TEAM_ID` | `--team-id` | Sets the `x-team-id` header. |
| `BOB_MAX_COINS` | `--max-coins` | Budget cap — Bob exits with code 1 if exceeded. |
| `BOB_CHAT_MODE` | `--chat-mode` | One of `plan`, `code`, `advanced`, `ask`. Sets the default chat persona for new sessions. |

Per-agent overrides for any of these still work — set the same env name in **Configure Agent → Env** and it wins over the inherited pin.

### Free-form env vars (Configure Agent → Env)

Less common toggles, not surfaced on the provider card.

| Env var | Effect |
|---|---|
| `BOBSHELL_HIDE_ENVS` | Set to `1` to suppress the env-var banner Bob prints at startup. |
| `BOB_SHELL_PRE_CHECK_AUTO_APPROVED` | Set to `1` to make Bob run a safety pre-check before executing auto-approved commands. Recommended on top of `--yolo`. |
| `BOB_SHELL_SYSTEM_MD` | Path to a markdown file appended to Bob's system prompt. Lives on the workspace PVC. |
| `IBM_TELEMETRY_ENABLED` | Set to `false` to opt out of Bob's telemetry. |

Settings that **cannot** be configured this way without changes to the shim:

- **Per-tool HITL** — Bob's experimental ACP mode has no working `client.requestPermission()` path for built-in tools (every `shouldConfirmExecute` short-circuits in non-interactive mode). The platform UI inbox is not used for Bob.
- **Auth method** — the shim spawns Bob with `--auth-method api-key`. OAuth / Vertex paths would need a different shim invocation.
- **Sandbox** — Bob's `--sandbox` runs commands inside a separate sandbox subprocess. Overlaps with the platform's K8s-level sandboxing model (ADR-033); leave off.

## Harness scripts

| Script | Behavior |
|---|---|
| `harness-chat.sh` | Translates the `BOB_*` env vars and `exec`s `node /app/bob-acp-shim.mjs`. Bob advertises `agentCapabilities.loadSession: false` over ACP, so every `session/new` from agent-runtime spawns a fresh Bob session — chat resume is not possible at the ACP layer. |
| `harness-terminal.sh` | Same flag translation, then `exec bob --approval-mode=auto_edit --auth-method api-key`. TUI mode is interactive — `auto_edit` lets Bob prompt the user in the terminal for risky tools; `--yolo` (which the ACP shim must use) would auto-approve everything. Each terminal open starts a **fresh** Bob TUI session — Bob persists sessions in a project-scoped numeric index, not per-UUID files (the way pi-agent and claude-code do), so `$HARNESS_SESSION_ID` can't be mapped one-to-one. Users can browse prior sessions from inside the TUI with `--list-sessions` if needed. |

## Persistence

The `/home/agent` PVC keeps Bob's session index under `~/.bob/`, plus whatever Bob writes during a session (workspace files, MCP server configs). Survives pod restarts and image rebuilds.
