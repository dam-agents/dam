# ADR-023: Harness-agnostic agent base image

**Date:** 2026-04-17
**Status:** Accepted
**Owner:** @tomas2d

## Context

Platform must support multiple coding-agent harnesses (Claude Code, pi, codex, future Gemini CLI, etc.) without baking a specific one into the platform. Each harness ships as a CLI binary that speaks ACP (Agent Client Protocol) on stdio. The platform's job is to:

1. Run the harness inside a pod with network isolation and Envoy-injected credentials (ADR-005, ADR-033).
2. Receive ACP traffic from the UI (ADR-007) and forward it to a subprocess.
3. Deliver scheduled triggers via exec (ADR-008).
4. Persist workspace state on PVC, seeded from the agent image (ADR-001).

None of those concerns depend on which harness is running — only on an ACP-speaking stdio process. Without a shared base, each new agent repo would re-implement ACP relay, trigger watching, file-service RPC, and CA-cert bootstrap.

## Decision

Ship a single **`platform-base`** image that owns the platform-managed surface area; every concrete agent image extends it and contributes only the harness-specific bits.

### `platform-base` responsibilities

- Node 22 runtime + `git` + `gh` CLI + ca-certificates.
- Bundled `agent-runtime` process (`packages/agent-runtime/`): ACP WebSocket server, file-service tRPC router, trigger-file watcher.
- Default `PORT=8080`, `EXPOSE 8080`, `CMD ["node", "dist/server.js"]`.
- `working-dir/` layer that gets copied to `/home/agent/` on first pod boot via a template init script.

### Agent-authoring contract

A concrete agent image is a Dockerfile that drops two scripts at fixed paths:

```Dockerfile
ARG BASE_IMAGE=platform-base
FROM ${BASE_IMAGE}

RUN npm install -g <harness-package>

COPY harness-chat.sh /usr/local/bin/harness-chat
COPY harness-terminal.sh /usr/local/bin/harness-terminal
RUN chmod +x /usr/local/bin/harness-chat /usr/local/bin/harness-terminal

COPY workspace/ /app/working-dir/
```

The platform contract is two executables at fixed paths ([ADR-037](037-remote-terminal.md)):

- **`/usr/local/bin/harness-chat`** — agent-runtime spawns this as the ACP subprocess for chat-mode sessions (`packages/agent-runtime/src/server.ts`).
- **`/usr/local/bin/harness-terminal`** — agent-runtime spawns this attached to a PTY for terminal-mode sessions, with `HARNESS_SESSION_ID` exported in the env so the harness can pick up the right resumable session.

`platform-base` ships defaults for both (Claude Code in chat and terminal modes); concrete agents only need to override the script(s) whose harness differs. Each session gets its own subprocess; session state is the harness's responsibility (filesystem in `/home/agent/`, harness-specific stores under `~/.<harness>/`). The platform never parses harness-internal formats.

### Current concrete agents

| Agent | Chat harness | Terminal harness |
|---|---|---|
| `example-agent` | Claude Code ACP (default) | `claude` (default) |
| `google-workspace` | Claude Code ACP (default) | `claude` (default) |
| `codex` | `codex-acp` | `codex` / `codex resume --last` |
| `pi-agent` | `pi-acp` | `pi --session $HARNESS_SESSION_ID` |

See `packages/agents/pi-agent/README.md` for pi-specific config (memory scopes, system-prompt conventions, workspace layout).

## Alternatives Considered

**One monolithic agent image with every harness baked in.** Rejected: bloats the image, couples harness upgrades, and conflicts on tool versions (each harness wants its own pinned Node/npm globals).

**Agent-runtime as a sidecar container.** Each agent runs its harness in one container, agent-runtime in another, communicating over a shared volume or localhost. Rejected: doubles the per-pod footprint, complicates the trigger/file path (two containers to exec into), and gains nothing — agent-runtime is lightweight and harness-agnostic already.

**Per-harness base images** (`platform-base-claude`, `platform-base-pi`, …). Rejected: duplicates the platform code for each harness; every agent-runtime change has to be rebuilt N times. The single `platform-base` + harness-script contract already gives harness authors all the flexibility they need without forking the base.

**Drop `platform-base` and let agents embed agent-runtime directly.** Rejected: every agent repo would need to vendor or depend on the agent-runtime package and rebuild it, duplicating the Node + git + gh + CA bootstrap layers. `platform-base` consolidates that fixed cost once.

## Consequences

- **Rebuild coupling.** Every agent image must be rebuilt when `platform-base` (and thus the bundled agent-runtime) changes. `mise run image:agent` builds `platform-base` + all three agents in one pass.
- **Harness contract is narrow.** The platform assumes the harness speaks ACP over stdio and respects the trigger-file convention (ADR-008). Anything outside that — memory formats, skill registries, tool auth — is the harness's business.
- **Low barrier for new agents.** Adding a new harness is: Dockerfile that extends `platform-base`, `npm install -g <harness>`, drop `harness-chat.sh` / `harness-terminal.sh`, optionally seed `workspace/`. Example PRs: `feat(agent-runtime): add codex-ready agent image` (502366e), `feat(agents): add pi-agent with @zhafron/pi-memory` (4f7cfd0).
- **Helm chart plumbs image + template per agent.** Each agent has a Helm values block (`pi-agent` at `deploy/helm/platform/values.yaml`, template at `deploy/helm/platform/templates/pi-agent-template.yaml`). Adding an agent requires a chart change — acceptable cost.
- **Two scripts per harness assume single-binary entrypoints.** If a future harness needs a multi-process orchestration (e.g., sidecar MCP server), the harness script wraps it and exposes one ACP / TUI entrypoint. No orchestration primitives in the platform.

## Key files

- `packages/platform-base/Dockerfile` — base image definition; bakes default `harness-chat.sh` and `harness-terminal.sh` for Claude Code.
- `packages/platform-base/harness-chat.sh`, `harness-terminal.sh` — default Claude Code entrypoints used by `example-agent` and `google-workspace`.
- `packages/agent-runtime/src/server.ts` — spawns `/usr/local/bin/harness-chat` for ACP sessions and `/usr/local/bin/harness-terminal` for PTY sessions.
- `packages/agent-runtime/src/acp-bridge.ts` — spawns the chat harness subprocess per session.
- `packages/agent-runtime/src/trigger-watcher.ts` — watches `/home/agent/.triggers/` for scheduled-session files.
- `packages/agents/{example-agent,google-workspace,pi-agent}/Dockerfile` — the per-harness recipe in practice.
- `packages/agents/pi-agent/{harness-chat.sh,harness-terminal.sh}` — pi-specific overrides.
- `packages/agents/pi-agent/README.md` — agent-specific documentation pattern (memory scopes, system-prompt conventions).
- `tasks.toml` → `image:agent` — multi-agent build orchestration.
