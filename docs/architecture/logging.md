# Logging

Last verified: 2026-06-12

## Overview

The api-server logs through a single process-wide **Pino** logger ([`packages/api-server/src/core/logger.ts`](../../packages/api-server/src/core/logger.ts)), configured once at startup from the `info`-default log level. Output is one JSON object per line on stdout; the common levels `error/warn/info/debug` are the only knob — there is no per-feature toggle. Visibility is the operator's level choice, governed the usual way.

The logger's first and primary consumer is a **security audit trail**: a structured record at every security-relevant decision point, so a forensic investigation can reconstruct *who did what, to what, and whether it was allowed*. The trail is the orthogonal counterpart to [usage-tracking](usage-tracking.md): usage is **pseudonymized analytics** in Postgres (a database leak yields opaque hashes); the audit trail is **real-identity forensics** on stdout (an investigator can attribute directly). The two never share actor handling.

## The audit record

`securityLog(level, event, fields)` ([`core/security-log.ts`](../../packages/api-server/src/core/security-log.ts)) is a thin, typed wrapper over the Pino logger — not a new level or stream. The dotted `event` (e.g. `egress.decision`, `secret.create`, `authn.deny`) is the log message; the fields are merged into the line:

- **`category`** — the coarse class (`authn`, `authz`, `egress`, `approval`, `authz-list`, `credential`, `channel`, `resource`, `privileged`). Kubernetes merges stdout and stderr into one pod log, so a shipper isolates the trail by **filtering on this field**, not on the stream.
- **`actor` / `actorKind`** — the raw (un-pseudonymized) Keycloak `sub`, an agent id, `system:<component>`, or `null`; tagged `user | agent | system | external`.
- **`result`** (`success | failure`) and **`decision`** (`allow | deny | hold | expired`) are **separate axes** — an execution failure is not a policy deny, so the canonical "show me every deny" query stays unambiguous.
- **`correlationId`** ties a multi-site flow together. A credentialed-egress hold (`egress.hold`), the human verdict (`approval.verdict`), and the resolved decision (`egress.decision`) all carry the same pending-approval id.
- **`agentId`, `target`, `sourceIp`, `reason`, `detail`** round out the line. `detail` is shallow and value-free.

**Level mapping:** deny/fail → `warn`, allow/success/mutation → `info`, internal failure on a security path → `error`.

**Redaction is the caller's contract.** Records never carry token/secret/PAT values, refresh tokens, raw JWTs, or raw prompts — only metadata (`hasRefresh`, `secretId`, env key *names*, byte counts, a resolved file path). The bus saga projects explicit fields per event rather than spreading a domain event (which would leak `ForeignReplyReceived.prompt`). The logger also censors a few well-known credential keys as defense-in-depth, and the WS edge strips `?token=` before logging a path.

## How the trail is produced

Two disjoint mechanisms feed the one logger:

- **Bus saga** ([`modules/audit`](../../packages/api-server/src/modules/audit)) — subscribes the in-process domain event bus for the discrete success/observation events that already carry a real actor: `ChannelTurnRelayed`, `ScheduleFired`, `FilesImported`, `ForeignReplyReceived` (cross-identity turn, prompt omitted), and the `Fork*` events. It mirrors the usage `persist-activity` saga shape, but only for events that occur at most once per action — it deliberately does **not** subscribe `UserAuthenticated`, which fires on every authenticated request (the usage saga consumes that one, collapsing it to a single row per day).
- **Direct calls** at every decision/denial/mutation site not on the bus — the majority, and all denials. Each site logs at the application/service layer or the transport edge, where the actor is in scope; never in the pure domain layer.

## Coverage

| Surface | Representative events |
|---|---|
| Auth edge | `authn.deny` (bad/missing token), `authz.deny` (missing role). Successful logins are not logged here — the api-server only ever sees already-issued tokens on per-request verification; Keycloak's authentication-event log is the authoritative record of logins. |
| HTTP / WS edge | `authz.owner_mismatch` (cross-tenant agent access), `ws.authn_deny` / `ws.owner_mismatch` / `ws.terms_block`, `relay.attach` (terminal/ACP attach to a credentialed pod) |
| Credentialed egress (HITL) | `egress.decision` (every allow/deny/expired), `egress.hold`; identity-unresolved and ext-authz transport denials |
| Approvals | `approval.verdict` (approve/deny once/permanent/host) |
| Authorization lists | `agent.allowed_users_set` (with added/removed diff), `egress_rule.create|update|revoke|preset`, `secret.grants_set`, `connection.grants_set` |
| Credentials | `secret.create|update|delete`, `oauth.token_mint`, `connection.create|delete`, `secret.orphan_cleanup_failed` |
| Channels | `channel.authz` / `channel.authz_deny` (Slack unlinked + allowed-users gate; Telegram group-admin + unauthorized thread), `identity.link`, `channel.outbound` (agent post, incl. resolved attachment path), `channel.thread_revoked` |
| Privileged | `skill.install` / `skill.uninstall` / `skill.publish`, `schedule.create|toggle|delete` (incl. agent-driven), `usage.inspect` / `usage.inspect.deny`, `agent.create|update|delete|restart|wake` |

## Invariants

- **Single process, single stdout.** The public API, harness, and ext-authz gRPC apps run in one process, so one logger configuration and one stream cover the whole api-server.
- **Once per replica.** The domain bus is in-process; each replica's saga logs only its own events. Moving domain events onto the cross-replica Redis bus would require dedup, or every replica would duplicate every line. The api-server runs single-replica today.
- **Non-blocking.** The egress gate logs on the proxy's request-blocking hop; the writer must never block or throw into a request path.
