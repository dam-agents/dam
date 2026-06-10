# Architecture Decision Records

This directory contains ADRs for the Platform project.

## Accepted

| ADR                                           | Title | Owner |
|-----------------------------------------------|-------|-------|
| [001](001-ephemeral-containers.md)            | Ephemeral containers + persistent workspace volumes | @tomkis |
| [002](002-memory-primitives.md)               | Memory — platform provides primitives, agents own semantics | @tomkis |
| [003](003-k8s-from-the-start.md)              | Kubernetes from the start — k3s for local dev, K8s for production | @jezekra1 |
| [004](004-acp-over-a2a.md)                    | ACP over A2A for the experiment | @tomkis |
| [005](005-credential-gateway.md)              | Gateway pattern for credentials — agent never sees tokens | @pilartomas |
| [006](006-configmaps-over-crds.md)            | ConfigMaps over CRDs — namespace-scoped resource model — superseded by ADR-058 | @jezekra1 |
| [007](007-acp-relay.md)                       | ACP traffic always proxied through the API Server | @tomkis |
| [008](008-trigger-files.md)                   | Controller-owned cron with exec-based trigger delivery | @jezekra1 |
| [009](009-go-and-typescript.md)               | Go for Controller, TypeScript for API Server | @jezekra1 |
| [010](010-onecli-deployment.md)               | OneCLI deployment — single image, two Services | @pilartomas |
| [011](011-skills-claude-marketplace.md)       | Skills via Claude plugin marketplace — superseded by ADR-030 | @pilartomas |
| [012](012-runtime-lifetime.md)                | Runtime lifetime — single-use Jobs | @JanPokorny |
| [013](013-ui-approach.md)                     | UI approach — chat-primary, dashboard for inspection | @PetrBulanek |
| [014](014-integration-testing.md)             | E2E integration testing against dedicated k3s cluster — superseded by ADR-056 | @tomkis |
| [015](015-multi-user-auth.md)                 | Multi-user auth via Keycloak + OneCLI fork with token exchange | @tomkis |
| [016](016-messenger-integration.md)           | Messenger integration handled by API Server | @tomkis |
| [017](017-db-backed-sessions.md)              | DB-backed ACP sessions for metadata | @tomkis |
| [018](018-slack-integration.md)               | Slack integration — Socket Mode, channel-based routing, identity linking | @tomkis |
| [019](019-session-identity.md)                | Scheduled session identity and lifecycle | @janjeliga |
| [020](020-responsive-ui-pwa.md)               | Responsive mobile UI, ACP session controls, PWA | @jezekra1 |
| [021](021-slack-outbound.md)                  | Slack outbound messaging — MCP tool with per-agent token auth | @tomkis |
| [022](022-harness-api-server.md)              | Harness API server — separate port with restricted API surface | @tomkis |
| [023](023-harness-agnostic-base-image.md)     | Harness-agnostic agent base image (`platform-base` + per-mode harness scripts) | @tomas |
| [024](024-connector-declared-envs.md)         | Connector-declared pod envs + per-agent env overrides | @tomas |
| [025](025-thread-session.md)                  | Persistent ACP session per Slack thread | @tomkis |
| [026](026-session-log-replay.md)              | Persistent ACP sessions via per-session log and cursor fan-out | @jezekra1 |
| [027](027-slack-user-impersonation.md)        | Slack per-turn user impersonation — foreign repliers fork the instance into a K8s Job | @tomkis |
| [028](028-generic-secret-injection-config.md) | Configurable injection on generic secrets (host/path + custom header) | @tomas2d |
| [029](029-per-instance-channels.md)           | Per-instance messenger channels — secrets in k8s Secrets, per-thread authorization | @pilartomas |
| [030](030-skills-marketplace.md)              | Skills — connectable sources and install | @PetrBulanek |
| [031](031-schedule-rrule-quiet-hours.md)      | Schedules use RRULE for includes and structured quiet hours for exclusions | @jezekra1 |
| [032](032-pod-reachability-primitive.md)      | Centralized pod-reachability primitive; observed pod Ready is the truth — superseded by ADR-059 | @janjeliga |
| [033](033-envoy-credential-gateway.md)        | Envoy-based credential gateway with ext_authz HITL — drop OneCLI | @pilartomas |
| [035](035-unified-hitl-ux.md)                 | Unified HITL UX — verdict authority outside the agent pod | @jezekra1 |
| [036](036-redis-platform-primitive.md)        | Redis as a platform primitive — pub/sub, queues, cache | @jezekra1 |
| [037](037-remote-terminal.md)                 | Remote terminal — split "chat" and "terminal" session modes | @JanPokorny |
| [038](038-paired-gateway-pod.md)              | Paired agent and gateway pods — cluster-enforced credential boundary | @pilartomas |
| [039](039-cli-foundation.md)                  | Platform CLI foundation — TypeScript on Node, npm distribution | @PetrBulanek |
| [040](040-unified-secret-contributions.md)    | Unified secret contributions — controller-merged at render time | @Tomas2D |
| [041](041-istio-ambient-mesh.md)              | Istio ambient mesh — SPIFFE identity for every internal hop | @pilartomas |
| [042](042-agent-egress-network-policy.md)     | Agent egress is gated by NetworkPolicy; the agent is not a mesh participant | @pilartomas |
| [043](043-agent-pod-config-layers.md)         | Three-layer agent pod configuration — base / templateDefaults / templates | @jezekra1 |
| [044](044-provider-twin-secrets.md)           | Provider twin secrets — multiple injection points per credential | @xjacka |
| [045](045-file-import.md) | File import — bundled, atomic, one-shot | @janjeliga |
| [046](046-eliminate-instance.md)              | Eliminate Instance — collapse into Agent | @jezekra1 |
| [047](047-terms-of-use-acceptance.md)         | Terms of Use acceptance — api-server gate with hash-as-proof | @tomkis |
| [048](048-usage-tracking.md)                  | Usage tracking — append-only activity log with pseudonymized identifiers | @jjeliga |
| [049](049-lazy-workspace-fetch.md)            | Lazy per-directory workspace fetch | @tomkis |
| [050](050-platform-reserved-paths.md)         | Platform-reserved paths | @tomkis |
| [051](051-connections-and-contributions.md)   | Connections, Connection Templates, and Contributions — unified configuration model | @jezekra1 |
| [052](052-runtime-channel.md)                 | Unified runtime channel — state snapshot plus event stream between api-server and agent-runtime | @jezekra1 |
| [053](053-runtime-outbox-worker.md)           | Transactional outbox + worker for runtime-channel delivery | @jezekra1 |
| [054](054-keycloak-theme.md)                  | Branded Keycloak login via Keycloakify-built custom image | @kapetr |
| [055](055-agent-owned-session-metadata.md)    | Agent-owned session metadata via ACP `_meta`; no server-side session store | @jezekra1 |
| [056](056-browser-driven-e2e.md)              | Browser-driven E2E tracer with values-gated test affordances | @tomkis |
| [057](057-structured-logging.md)              | Structured logging for the api-server — Pino, JSON to stdout, security audit trail as first consumer | @pilartomas |
| [058](058-crds-over-configmaps.md)            | CRDs over ConfigMaps — reconciled resources become custom resources | @jezekra1 |
| [059](059-agent-readiness-status.md)          | Agent readiness is controller-computed status — agent ∧ gateway | @jezekra1 |
| [060](060-unified-apply-path-and-contributions-settled-gate.md) | Unified runtime-channel apply path + settlement tracking (single worker, Ready-gated dispatch, retry + degraded badge) | @janjeliga |
| [061](061-warm-pvc-pool.md)                   | Warm PVC pool — pre-provisioned size-keyed spare workspace volumes claimed at agent create | @pilartomas |
| [062](062-ssh-access.md)                      | SSH access to agents — in-pod inetd sshd tunneled over the agent WebSocket | @JanPokorny |
| [063](063-hand-written-migrations.md)         | Generated table migrations, hand-written views, squashed baseline | @jezekra1 |
| [064](064-slack-e2e-bolt-port.md)             | Slack E2E — Bolt behind a swappable port, fork path exercised end-to-end | @tomkis |

## Drafts

| Draft | Title | Owner |
|-------|-------|-------|
| [DRAFT](DRAFT-multi-agent.md) | Multi-agent collaboration — isolated instances with shared artifacts | @tomkis |
| [DRAFT](DRAFT-runtime-env-injection.md) | Credential env via the runtime channel — injected at harness spawn, not baked into the pod | @janjeliga |