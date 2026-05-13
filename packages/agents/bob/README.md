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

## Harness scripts

| Script | Behavior |
|---|---|
| `harness-chat.sh` | `exec node /app/bob-acp-shim.mjs`. Bob advertises `agentCapabilities.loadSession: false` over ACP, so every `session/new` from agent-runtime spawns a fresh Bob session — chat resume is not possible at the ACP layer. |
| `harness-terminal.sh` | `bob --resume latest` when the project has any prior session, otherwise `exec bob`. Bob's TUI persists sessions in a project-scoped numeric index rather than per-UUID files (the way pi-agent and claude-code do), so `$HARNESS_SESSION_ID` can't be mapped one-to-one — `--resume latest` is the best approximation for "reopen this user's last conversation". |

## Persistence

The `/home/agent` PVC keeps Bob's session index under `~/.bob/`, plus whatever Bob writes during a session (workspace files, MCP server configs). Survives pod restarts and image rebuilds.
