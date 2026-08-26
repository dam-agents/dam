# Bob Agent

Platform agent running [Bob Shell](https://internal.bob.ibm.com/docs/shell) — IBM's general-purpose AI shell assistant. Built on the platform-base image with an ACP translation shim and a per-instance Envoy egress sidecar that injects the Bob API key on outbound traffic.

## Stack

| Component | Source | Purpose |
|---|---|---|
| Harness | `bobshell` 2.x (installed from the `bob-shell` COS bucket tarball) | Bob CLI: `bob run --format stream-json` for chat turns + `bob chat` TUI for terminal |
| ACP bridge | `bob-acp-shim.mjs` | ACP agent for agent-runtime; spawns one `bob run` per prompt turn and translates its stream-json events into `session/update` frames; serves `session/list` + `session/load` from Bob's task DB; continues tasks with the native `--resume <task-id>` |
| Storage | `/home/agent` PVC | Bob's task history lives in SQLite under `~/.bob/db/bob.db`; settings under `~/.bob/settings/`; survives pod restarts |

Bob 2.0 removed the `--experimental-acp` mode the previous shim bridged, so the shim is now itself the ACP endpoint rather than a frame-by-frame translator. The headless contract it builds on: `bob run --format stream-json` emits `message` (with `isReasoning` separating thoughts from answers), `tool_use`, `tool_result`, `result` (whose `stats.task_id` names the created/resumed task), and `error` events.

## Authentication

Bob expects `BOBSHELL_API_KEY` in the pod env (2.0 renamed it to `BOB_API_KEY`, but the old name is a supported alias — Bob copies it over and errors only if both are set to different values). On the platform the agent only ever sees a **placeholder** — the real key is materialized at the Envoy sidecar, never in the agent container.

1. **Open Settings → Providers → Bob** and paste your Bob API key. The provider preset creates a secret pinned to `api.us-east.bob.ibm.com` (unchanged in 2.0) with `Authorization: Apikey {value}` injection plus a twin entry on the same host that handles the `?key=` URL parameter Bob appends to several admin endpoints. `BOBSHELL_API_KEY` is seeded as `dummy-placeholder` — the literal content is irrelevant because Envoy overwrites the wire value, but it must not start with `sk-`/`pk-` or Bob's bundle would silently downgrade to the legacy `prod.ibm-bob-staging.cloud.ibm.com` backend (which only accepts JWT keys). The Advanced disclosure lets you set the default model and tenant-scoping flags (see below) — those flow as additional env-mappings rather than free-form env vars in the agent dialog.

2. **Grant the secret to the Bob agent instance** from Configure Agent → Secrets. The next pod restart picks up `BOBSHELL_API_KEY` and any pinned `BOB_*` envs along with the Envoy filter chain. Applying grants also re-renders the preset's env wiring from the current template, so a Bob secret created before the preset gained the inference variables (for Codex and Pi agents) picks them up right here — no need to re-enter the key.

The flow per request: Bob's `fetch()` sets `Authorization: Apikey dummy-placeholder` and tunnels through `HTTPS_PROXY` → Envoy terminates TLS using the platform CA → `credential_injector` rewrites the header to `Apikey bob_prod_…` from the K8s Secret → upstream sees the valid token. See [`docs/architecture/security-and-credentials.md`](../../../docs/architecture/security-and-credentials.md) and [ADR-033](../../../docs/adrs/033-envoy-credential-gateway.md).

### Endpoints that read the key from the URL

Some Bob backends (`/key/info?key=<value>`) read the credential from a URL query parameter. The provider preset's `extraInjections` automatically creates a second "twin" K8s Secret on the same host with `queryParamName: key`; the platform-side service cascades grants/updates/deletes onto it. See [ADR-044](../../../docs/adrs/044-provider-twin-secrets.md) for the twin-secret pattern and [ADR-033 §Credential injection](../../../docs/adrs/033-envoy-credential-gateway.md#credential-injection) for the Envoy URL-rewrite path.

## Autonomy posture

`bob run` (headless) has no per-tool prompt channel and no `--auto-approve` flag — approvals ride the settings file. The shim merge-writes `~/.bob/settings/settings.json` on startup with the platform posture: `approval.autoApprovalEnabled: true`, all permission groups (`read`, `edit`, `execute`, `browser`, `mcp`) allowed, a wildcard `execute_command` allowlist, and `outsideWorkspaceAllowed: true`. This is the 2.x equivalent of 1.x `--yolo`; there is no per-tool HITL in either surface.

The same settings apply to the terminal TUI (`bob chat`), so terminal sessions auto-approve too — unlike 1.x, where the TUI ran in `auto_edit` and asked before risky tools. Approval granularity is a Bob-side concern; the trust boundary is the platform's, not Bob's: every outbound HTTP request goes through the per-instance Envoy egress sidecar (ADR-033/038) with `ext_authz` / egress-rules enforcement, the agent container has no SA token, no Secret volume mounts, and no Envoy config it can rewrite.

Bob's own guardrail that remains active: `session.maxTurns` (Bob default 100) ends a runaway task, and `--max-cost` (below) caps spend per task.

## Configuration

Bob 2.x accepts settings from `~/.bob/settings/settings.json` (merged by the shim from the env vars below) and CLI flags (translated by the harness scripts). The Bob provider preset pins the most common ones; the rest stay free-form in **Configure Agent → Env**.

### Pinned via the Bob provider (Settings → Providers → Bob → Advanced)

These ride on the secret's `envMappings`, so every agent granted the Bob secret inherits them automatically — no per-agent re-entry.

| Env var | Translated to | Effect |
|---|---|---|
| `BOBSHELL_API_KEY` | n/a (env-only) | API key the Envoy sidecar swaps to the real value on the wire. Always emitted. |
| `BOB_SHELL_MODEL` | `session.model` in settings | Default model for new tasks. Examples: `premium-shell`, `codestral-2508`, `claude-sonnet-5`. Empty → Bob's built-in default. |
| `BOB_INSTANCE_ID` | `bob chat --instance-id` (terminal only) | IBM tenant scoping. `bob run` has no instance flag in 2.x — headless instance selection goes through Bob profiles, so this pin does not apply to chat-mode sessions. |
| `BOB_TEAM_ID` | `--team-id` | Team ID for `general`-type API keys. |
| `BOB_MAX_COINS` | `--max-cost` + `session.maxCost` | Per-task cost cap — Bob stops the task when exceeded. |
| `BOB_CHAT_MODE` | `--mode` | One of `agent`, `plan`, `ask` (2.0 merged `code`/`advanced` into `agent`; legacy pinned values are mapped onto `agent`). Sets the default mode for new sessions. |

Per-agent overrides for any of these still work — set the same env name in **Configure Agent → Env** and it wins over the inherited pin.

### Free-form env vars (Configure Agent → Env)

Less common toggles, not surfaced on the provider card.

| Env var | Effect |
|---|---|
| `BOB_LOG_LEVEL` | Bob's log level: `debug`, `info`, `warn`, `error`, `silent`. |
| `IBM_TELEMETRY_ENABLED` | Set to `false` to opt out of Bob's telemetry. |
| `BOB_SHIM_TRACE` | Set to `1` to log every shim frame (client↔shim↔bob) to the pod log. |

Gone in 2.0 (silently ignored if set): `BOBSHELL_HIDE_ENVS`, `BOB_SHELL_PRE_CHECK_AUTO_APPROVED`, `BOB_SHELL_SYSTEM_MD` (custom instructions now ride the `.bob/rules/` directory — the image links the platform instructions there), `BOB_RESUME_MAX_MESSAGES` (resume is native now).

## Harness scripts

| Script | Behavior |
|---|---|
| `harness-chat.sh` | `exec`s `node /app/bob-acp-shim.mjs`. The shim merge-writes the settings posture, serves ACP, and spawns `bob run --format stream-json` per prompt turn. |
| `harness-terminal.sh` | Writes the settings posture (`--settings-only`), translates the `BOB_*` env into `bob chat` flags, then `exec`s the TUI. Each terminal open starts a **fresh** Bob task — Bob's task index can't be mapped onto `$HARNESS_SESSION_ID`; users can resume prior tasks from inside the TUI with `bob -r`. |

## Session history

Bob 2.0 persists every task to SQLite on the PVC (`~/.bob/db/bob.db`, tables `tasks` + `messages`), and the shim serves ACP history straight from it:

- **`session/list`** — one entry per non-archived task (title from the task row, `_meta.platform.mode: chat`).
- **`session/load`** — replays the task's stored messages as `user_message_chunk` / `agent_message_chunk` updates.
- **Resume (prompt into a loaded task)** — native: the shim runs `bob run --resume <task-id> -- <prompt>` (the prompt is positional). No transcript re-injection; Bob reloads its own context. The stream carries only the new turn — `--resume` does not re-emit stored history, verified against tasks with several assistant turns — so nothing needs filtering beyond the prompt echo. The turn must run in the task's own workspace or Bob rejects the task outright.

ACP session ids issued by `session/new` are shim-generated (`bob-<uuid>`); the sessionId↔taskId binding is learned from the first turn's `result.stats.task_id` and persisted to `~/.bob/platform-shim-sessions.json` so loaded sessions stay resumable across pod restarts.

## Persistence

The `/home/agent` PVC keeps Bob's task DB (`~/.bob/db/`), settings (`~/.bob/settings/`), logs, and whatever Bob writes during a session (workspace files, MCP server configs). Survives pod restarts and image rebuilds.
