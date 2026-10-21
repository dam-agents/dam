# Architecture

Last verified: 2026-10-21

## System context

```mermaid
flowchart LR
  user[browser user]
  slack-user[Slack user]
  cli[dam CLI]
  satellite[dam satellite worker]
  llm[LLM APIs]
  github[GitHub]

  subgraph cluster[Platform install]
    ui[ui]
    api-server[api-server]
    controller[controller]
    keycloak[keycloak]
    postgres[(postgres)]
    redis[(redis)]
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
  satellite -->|polls for tool calls| api-server

  api-server <-->|ACP relay / tRPC proxy| agent-runtime
  api-server -->|REST| k8s-api
  api-server -->|JWKS validate| keycloak
  api-server -->|metadata| postgres
  api-server -->|BullMQ jobs / pub-sub| redis

  controller -->|watch + status| k8s-api

  agent-runtime -->|HTTPS_PROXY| envoy
  envoy -->|ext_authz Check| api-server
  envoy -->|inject credentials| llm
  envoy -->|inject credentials| github
```

The cluster boundary is the trust boundary.
Browsers and Slack users reach Platform through the api-server; LLM and GitHub traffic from the agent always exits through the paired gateway pod, where Envoy injects credentials from K8s Secrets mounted on the gateway only.
The agent pod's NetworkPolicy admits no path to TCP 80/443 other than the paired gateway, so credential injection is enforced by Kubernetes — not by the agent honoring `HTTPS_PROXY`.
The agent pod has no service-account credentials and no upstream tokens of its own.

## Subsystems

Each page is the authoritative, self-contained description of its subsystem.

- [platform-topology](architecture/platform-topology.md) — the long-lived components, the protocols between them, and the K8s resource model; the [images](architecture/agent-images.md) agents run in.
- [vm-runner](architecture/vm-runner.md) — `vm` hosts; [Mac](architecture/vm-host-runner.md), [image cache](architecture/vm-image-cache.md), [upgrades](architecture/vm-runner-upgrades.md), [runtime migration](architecture/vm-runtime-migration.md).
- [agent-lifecycle](architecture/agent-lifecycle.md) — create → wake → trigger → hibernate → delete; the [processes](architecture/agent-processes.md) inside; [sessions](architecture/sessions.md); the [changes](architecture/agent-changes.md) in its repositories.
- [schedules](architecture/schedules.md) — recurring and one-time work on an Agent: arming and firing occurrences, the Precheck that declines a fire before any model wakes, and the Session each fire opens.
- [budgets](architecture/budgets.md) — per-user ceiling on concurrently reserved compute, enforced by the controller at the 0→1 scale transition; UserBudget CRs for privileged users.
- [persistence](architecture/persistence.md) — the storage substrates (Postgres, custom resources, per-Agent PVC); [vm storage](architecture/vm-storage.md) — a machine's one disk and the owner's claim under it; what survives each lifecycle event.
- [security-and-credentials](architecture/security-and-credentials.md) — identity, Secret storage, HITL, boundaries; [credential-gateway](architecture/credential-gateway.md).
- [channels](architecture/channels.md) — Slack and Telegram adapters inside the api-server, bindings, ambient mode, identity linking.
- [channel-turns](architecture/channel-turns.md) — a channel message becoming an agent turn: inbound relay, outbound tools, the liveness watch, delivery recovery.
- [slack-guarantees](architecture/slack-guarantees.md): what is guaranteed in Slack
- [public-agent-page](architecture/public-agent-page.md) — an unauthenticated page from the Slack Agent Footer, naming a channel-bound Agent and its owner.
- [cli](architecture/cli.md) — `dam` command-line client, an npm-distributed Node package that points at a configured Platform deployment.
- [satellites](architecture/satellites.md) — MCP servers on machines outside the cluster: a polled queue, tools re-exposed to the agent scoped by machine, and the jobs it starts against them.
- [skills](architecture/skills.md) — the skills catalog: connectable git-based skill sources, per-Agent install records, reusable named selections a user carries between agents, publish back as a PR.
- [agent-skills](architecture/agent-skills.md) — the pod-local half: which skill files sit on one agent, the provenance verdict each carries, and the agent-runtime surface that mutates them behind Envoy credential injection.
- [starter-kits](architecture/starter-kits.md) — a proven way of working applied to a new agent — its connections, channels, schedules and onboarding step — read from git-hosted catalogs, never from cluster state.
- [connections](architecture/connections.md) — unified Connection / Contribution model: templates, grants, credentials, and which rail each Contribution kind takes.
- [runtime delivery](architecture/runtime-delivery.md) — runtime channel between api-server and agent-runtime, transactional outbox + worker delivery, one-shot events, agent-side driver model.
- [harness configuration](architecture/harness-config.md) — harness defaults and the session model list: how one choice reaches the harness's own file, where the model list is discovered, and what renders while the agent is stopped.
- [invocations](architecture/invocations.md) — one agent spawning another, set up like a kit, for one result.
- [knowledge-bases](architecture/knowledge-bases.md) — agents marked as knowledge bases that bootstrap their own knowledge tooling from a one-shot install instruction and are worked with through chat.
- [home-feed](architecture/home-feed.md) — what Home shows since you last looked: a per-owner attention record kept server-side, so hibernated agents still report.
- [artifact-library](architecture/artifact-library.md) — agents and users publish work products into an owner-scoped library and share them by link — with anyone, or with a named list of viewers who sign in.
- [chat-forms](architecture/chat-forms.md) — agents put A2UI forms, choices and cards into chat replies, rendered with the app's own components.
- [case-studies](architecture/case-studies.md) — agents write sanitized weekly accounts of their own use case: the skill that produces them, and the edition store the owner releases them from.
- [getting-started](architecture/getting-started.md) — a per-user first-run checklist; each task done unlocks an avatar.
- [features](architecture/features.md) — per-user experimental-feature flags: server-stored, default off, gating pre-release surfaces (progressive disclosure, not authorization).
- [usage-tracking](architecture/usage-tracking.md) — append-only activity log in Postgres, SQL views as the read interface, HMAC-pseudonymized identifiers, the inspector-gated analytics dashboard.
- [agent-telemetry](architecture/agent-telemetry.md) — the user-facing read path over raw agent traces and log records, scoped to the agents you own.
- [metrics](architecture/metrics.md) — the user-facing spend read path behind the global and per-agent Usage surfaces: how much the agents you own have spent.
- [spend-limits](architecture/spend-limits.md) — Metered Spend: each agent's gateway meters every model call, out of the agent's reach.
- [logging](architecture/logging.md) — Pino structured logging to stdout, and the real-identity security audit trail built on it (the forensic counterpart to pseudonymized usage-tracking).
- [observability](architecture/observability.md) — the optional, bundled agent-telemetry backend: an OTLP collector writing OpenTelemetry signals into a columnar store, gated by the mesh rather than ingestion tokens.
- [e2e](architecture/e2e.md) — the smoke suite that proves an install end to end: its two lanes, the order the projects run in, and the specs a pull request defers to the merge queue and the nightly run.
- [supply-chain](security/supply-chain.md) — how each external dependency type is scanned for CVEs and defended against supply-chain attacks.
- [code](security/code.md) — CodeQL SAST and pre-commit hardening.
- [secrets](security/secrets.md) — GitHub secret storage, scanning, and push protection.
- [gaps](security/gaps.md) — known security gaps tracked as future work.

## Strategy

[Strategy](strategy.md) — what Platform is trying to be, apart from how the current system is built.
