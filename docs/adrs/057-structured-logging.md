# ADR-057: Structured logging for the api-server

**Date:** 2026-05-29
**Status:** Accepted
**Owner:** @pilartomas

## Context

The api-server has no logging abstraction. Diagnostics are ad-hoc writes to stderr, and the only durable structured signal is the in-process domain event bus, which the usage subsystem turns into HMAC-pseudonymized rows in Postgres for operator analytics. Reconstructing *who did what, and whether it was allowed* after a security incident is impossible: the auth edge records nothing on a rejected token, the credentialed-egress gate records no allow/deny decision, and credential and authorization-list mutations are largely silent. Producing a forensic trail first requires a logging primitive — there is nothing today that emits attributable, parseable records to the platform's log pipeline.

## Decision

The api-server emits structured logs through Pino: one JSON record per line on stdout, the common severity levels (`error`/`warn`/`info`/`debug`), and visibility governed by the standard configured level — there is no per-feature on/off switch. One process-wide logger is configured once at startup.

The first consumer is a **security audit trail**. Security-relevant actions and decisions are ordinary log records at mapped common levels — denied/failed at `warn`, allowed/successful at `info`, internal failures on a security path at `error` — and carry the **real, un-pseudonymized actor identity** plus a coarse `category` so the log pipeline can isolate the trail. Because Kubernetes merges stdout and stderr into one pod log, consumers discriminate on that field, not on the stream. Records never carry secret values, tokens, or raw prompts.

This deliberately diverges from the usage subsystem: that store is pseudonymized analytics ([ADR-048](048-usage-tracking.md)); this trail is real-identity forensics. They stay separate.

## Alternatives Considered

- **A dedicated audit on/off flag or a custom "audit" log level** — rejected: visibility belongs to the standard level configuration; a separate switch is one more control to misconfigure and silently lose the trail.
- **Reuse the pseudonymized activity-events path** — rejected: HMAC-pseudonymized subjects defeat the attribution forensics needs, and Postgres is not the platform's incident-log surface.
- **Hand-rolled JSON logger** — rejected: leveling, redaction, and safe serialization of circular structures are already solved by an established library.

## Consequences

- **Easier:** any security decision point emits an attributable record in one call, collected from stdout with no new infrastructure — the api-server already runs as a stdout-logged pod, so the trail rides the existing pipeline.
- **Easier:** rejected and denied actions now leave a trace. Previously the auth edge emitted nothing on 401/403 and the egress gate logged no allow/deny/hold decision; these are the highest-value forensic signals and were entirely dark.
- **Harder:** the trail carries real Keycloak subjects, so it is PII and must be access-controlled and retained as such at the log sink — GDPR treats the subject identifier as personal data, which is exactly why the analytics path pseudonymizes.
- **Harder:** logging every credentialed-egress decision adds a write to a path that runs on the proxy's request-blocking hop, so the writer must stay non-blocking and the allow-volume must be tolerable to the sink.
- **Committed-to:** the logger is a process-wide singleton configured once at startup; records emitted before configuration use the default level.
- **Committed-to:** raising the configured level above `info` drops the audit trail by design — operators own that trade-off.
