# Architecture

Last verified: 2026-04-29

## System context

```mermaid
flowchart LR
  user[browser user]
  slack-user[Slack user]
  llm[LLM APIs]
  github[GitHub]

  subgraph cluster[Humr install]
    ui[ui]
    api-server[api-server]
    controller[controller]
    agent-runtime[agent-runtime pod]
    onecli[onecli]
    keycloak[keycloak]
    postgres[(postgres)]
    k8s-api[(K8s API)]
  end

  user -->|HTTP + WS| ui
  ui -->|tRPC + ACP/WS| api-server
  user -->|OIDC| keycloak

  slack-user <-->|Slack API| api-server

  api-server <-->|ACP relay / tRPC proxy| agent-runtime
  api-server -->|REST| k8s-api
  api-server -->|RFC 8693| keycloak
  api-server -->|user-scoped calls| onecli
  api-server -->|metadata| postgres

  controller -->|watch + status| k8s-api
  controller -.exec triggers.-> agent-runtime
  controller -->|provision token| onecli
  controller -->|RFC 8693| keycloak

  agent-runtime -->|outbound HTTPS| onecli
  onecli -->|inject credentials| llm
  onecli -->|inject credentials| github
```

The cluster boundary is the trust boundary. Browsers and Slack users reach Humr through the api-server; LLM and GitHub traffic from the agent always exits through onecli. The agent pod has no direct path to anything outside the cluster, no service-account credentials, and no upstream tokens of its own.

## Subsystems

Each page describes how the accepted ADRs are realized in the current system. ADRs own *why*; these pages own *how*.

- [platform-topology](architecture/platform-topology.md) — the four long-lived components (controller, api-server, agent-runtime, ui), the protocols between them, and the K8s resource model.
- [agent-lifecycle](architecture/agent-lifecycle.md) — create → wake → trigger → hibernate → delete; per-schedule sessions and forks.
- [persistence](architecture/persistence.md) — the three substrates (Postgres, ConfigMap spec/status, per-instance PVC) and what survives each lifecycle event.
- [security-and-credentials](architecture/security-and-credentials.md) — Keycloak identity, OneCLI credential gateway, per-instance access tokens, network boundary, threat model.
- [channels](architecture/channels.md) — Slack and Telegram adapters inside the api-server, inbound relay, outbound MCP tool, identity linking.
- [skills](architecture/skills.md) — connectable git-based skill sources, install onto the per-instance PVC, REST-only publish back as a PR, OneCLI MITM for GitHub credentials.

## Strategy

Higher-level documents that frame *what* Humr is trying to be, separate from how the current system is built:

- [Multiplayer model](strategy/multi-player.md) — what's private to each user, what's shared via channels, and what's install-wide plumbing.
- [Security model](strategy/security-model.md) — the three structural risks of running AI agents, and which ones Humr addresses today.

## Decisions

[ADR index](adrs/index.md) — every accepted, draft, and superseded architecture decision, owner-tagged. The subsystem pages above link to the ADRs that motivated each design.
