# ADR-048: Usage tracking — append-only activity log with pseudonymized identifiers

**Date:** 2026-05-20
**Status:** Accepted
**Owner:** @jjeliga

## Context

Pilot deployments need operator-facing usage metrics — DAU, channel turns, schedule fires, OAuth and import volumes — and the platform has no place to record them. The data is tied to Keycloak `sub` (personal data under GDPR Art. 4), so the storage shape has to reduce blast radius on its own.

## Decision

**An append-only Postgres log captures user activity; named SQL views are the read API; HMAC pseudonymization protects identifiers at the storage boundary; a dedicated `platform-inspector` realm role gates read access.**

- One append-only table holds every recorded interaction, with an outcome enum constrained at the DB so a missing outcome is a constraint violation, not a silent miscount.
- Views are the public read surface. Consumers query views by name; the raw table is internal. Adding a metric is a new view.
- Every Keycloak `sub` is HMACed at the repository boundary before INSERT. The key is a long-lived per-install secret applied identically to every `sub` column, so deterministic joins survive. This is pseudonymization (GDPR Recital 26), not anonymization — the stored value remains personal data, just no longer trivially linkable from a DB-only leak.
- Inspector access is a Keycloak realm role independent of platform-access; the chart provisions the role and an `inspectors` group mapped to it.
- The activity table has a 180-day retention bound, enforced by a periodic bulk DELETE coordinated across api-server replicas.
- A second Postgres table mirrors agent ConfigMaps so views can resolve agent ownership without a K8s API call. Populated by event subscription + startup backfill.
- Core-team activity is excluded from every pilot view via a filter keyed off a role flag captured at auth time.

## Alternatives Considered

- **External analytics stack** — adds a third-party data processor for self-hosted installs; sharper GDPR question than a pseudonymized in-cluster table.
- **Logs + log aggregation** — lossy, expires with retention, "how many users connected GitHub last month" still needs another stack to answer.
- **Anonymize instead of pseudonymize** — loses per-user grouping (DAU, multi-surface counts), which is what pilot questions need.
- **Pseudonymize at the event-bus boundary** — every emit site has to know the key; the repository is the single chokepoint, smaller surface to forget.
- **Reuse the platform-access role for read access** — conflates "can use the platform" with "can read aggregates about everyone's use of it."
- **Open ad-hoc `SELECT` endpoint for inspectors** — `SELECT refresh_token FROM identity_links` is in the same trust scope as "view daily-active users." Inspectors get views only; ad-hoc SQL is an operator workflow via `kubectl exec`.

## Consequences

- **Easier:** Operator questions are answerable without new infrastructure. Adding a metric is one SQL view plus a one-line registration. A DB-only leak yields opaque hashes; recovering identifiers requires the api-server pod and its mounted secret. Inspector and platform-access roles can be granted independently — a security or ops role gets aggregates without agent-creation rights.
- **Harder:** The HMAC key is permanent in practice — rotating it orphans every existing row. Pseudonymization is reversible by anyone holding the key, so a combined DB-and-pod compromise re-identifies. Core-team exclusion depends on the role being set in Keycloak before the user's first auth — users who pre-date the role configuration appear in their first session's metrics until they re-authenticate. The agent mirror is a second source of truth for ownership alongside the K8s label; the subscribe-and-backfill closes the gap but a saga drop leaves it stale until the next bootstrap.
- **Committed-to:** Postgres is the only substrate for activity data — no parallel logs/metrics path to keep in sync. SQL view names are the public read API. The `platform-inspector` role ships with every install whether granted or not. Activity writes toggle off via Helm value; the read API and the agent mirror run unconditionally because other consumers may want SQL-side ownership lookups.
