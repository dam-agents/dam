# Architecture

Last verified: 2026-05-20

## System context

```mermaid
flowchart LR
  user[browser user]
  slack-user[Slack user]
  cli[dam CLI]
  llm[LLM APIs]
  github[GitHub]

  subgraph cluster[Platform install]
    ui[ui]
    api-server[api-server]
    controller[controller]
    keycloak[keycloak]
    postgres[(postgres)]
    k8s-api[(K8s API)]
    subgraph agentpod[agent pod]
      agent-runtime
    end
    subgraph gatewaypod[gateway pod]
      envoy[Envoy]
    end
  end

  user -->|HTTP + WS| ui
  ui -->|tRPC + ACP/WS| api-server
  user -->|OIDC| keycloak

  slack-user <-->|Slack API| api-server

  cli -->|tRPC + WS| api-server

  api-server <-->|ACP relay / tRPC proxy| agent-runtime
  api-server -->|REST| k8s-api
  api-server -->|JWKS validate| keycloak
  api-server -->|metadata| postgres

  controller -->|watch + status| k8s-api
  controller -.exec triggers.-> agent-runtime

  agent-runtime -->|HTTPS_PROXY| envoy
  envoy -->|ext_authz Check| api-server
  envoy -->|inject credentials| llm
  envoy -->|inject credentials| github
```

The cluster boundary is the trust boundary. Browsers and Slack users reach Platform through the api-server; LLM and GitHub traffic from the agent always exits through the paired gateway pod ([ADR-038](adrs/038-paired-gateway-pod.md)), where Envoy injects credentials from K8s Secrets mounted on the gateway only. The agent pod's NetworkPolicy admits no path to TCP 80/443 other than the paired gateway, so credential injection is enforced by Kubernetes — not by the agent honoring `HTTPS_PROXY`. The agent pod has no service-account credentials and no upstream tokens of its own.

## Subsystems

Each page describes how the accepted ADRs are realized in the current system. ADRs own *why*; these pages own *how*.

- [platform-topology](architecture/platform-topology.md) — the four long-lived components (controller, api-server, agent-runtime, ui), the protocols between them, and the K8s resource model.
- [agent-lifecycle](architecture/agent-lifecycle.md) — create → wake → trigger → hibernate → delete; per-schedule sessions and forks.
- [persistence](architecture/persistence.md) — the three substrates (Postgres, ConfigMap spec/status, per-Agent PVC) and what survives each lifecycle event.
- [security-and-credentials](architecture/security-and-credentials.md) — Keycloak identity, Envoy sidecar credential gateway, K8s-Secret credential storage, ext_authz HITL, network boundary.
- [channels](architecture/channels.md) — Slack and Telegram adapters inside the api-server, inbound relay, outbound MCP tool, identity linking.
- [cli](architecture/cli.md) — `dam` command-line client, an npm-distributed Node package that points at a configured Platform deployment.
- [skills](architecture/skills.md) — connectable git-based skill sources, install onto the per-Agent PVC, REST-only publish back as a PR, Envoy sidecar credential injection for GitHub.
- [usage-tracking](architecture/usage-tracking.md) — append-only activity log in Postgres, SQL views as the read interface, HMAC-pseudonymized identifiers, inspector-role gating.
- [security-scanning](architecture/security-scanning.md) — Quay image scanning with auto-filed issues, CodeQL SAST, Dependabot, and the remediation flow.

## Strategy

Higher-level documents that frame *what* Platform is trying to be, separate from how the current system is built:

- [Multiplayer model](strategy/multi-player.md) — what's private to each user, what's shared via channels, and what's install-wide plumbing.
- [Security model](strategy/security-model.md) — the three structural risks of running AI agents, and which ones Platform addresses today.

## Decisions

[ADR index](adrs/index.md) — every accepted, draft, and superseded architecture decision, owner-tagged. The subsystem pages above link to the ADRs that motivated each design.
