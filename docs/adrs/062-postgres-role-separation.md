# ADR-062: Postgres role separation — no SUPERUSER on app roles

**Date:** 2026-05-22
**Status:** Accepted
**Owner:** @pilartomas

## Context

The bundled Postgres runs with a single role, `platform`, used as both
the api-server's and Keycloak's connection identity, and granted
SUPERUSER. A leaked credential from either service's pod is a direct
path to total cluster-wide DB control — read or modify any data,
create or drop any role, install extensions, bypass row-level
security, and pivot into the other service's data via the shared
role.

Separating "what the application's runtime credential can do" from
"what a DBA needs to do" is a least-privilege concern, independent of
whether the bundled Postgres or an external managed Postgres is the
operative instance. The platform's design should encode the right
shape regardless of where the DB actually lives.

## Decision

Three Postgres roles instead of one. The application's connection
identities have no superuser; DBA work runs as a separate SUPERUSER
role.

- **`platform_apiserver`** — owner of the `platform` database. LOGIN,
  NOSUPERUSER. The api-server's connection identity, only.
- **`platform_keycloak`** — owner of the `keycloak` database. LOGIN,
  NOSUPERUSER. Keycloak's connection identity, only.
- **`platform_admin`** — SUPERUSER, LOGIN. Humans (or deploy-time
  tooling) use this for DBA work — migrations, ad-hoc, break-glass.
  `ALTER ROLE platform_admin SET log_statement = 'all'` attaches a
  per-role default so new admin sessions log every statement.

The app roles can DDL within their own DBs (Drizzle migrations on
`platform`, Liquibase on `keycloak`) because they retain ownership.
They cannot `CREATE ROLE`, `ALTER SYSTEM`, bypass RLS, or touch
anything outside their own DB. Cross-database admission is closed at
the door: `CONNECT` defaults to `PUBLIC`, so it is revoked from
`PUBLIC` and granted only to each database's owning role — neither app
role can even open a session on the other's database. A compromise of
either service no longer pivots into the other's data.

DB-per-service stays. Layout-as-schemas is a separate question for a
future ADR.

## Alternatives Considered

- **One app role, demote to NOSUPERUSER + per-role audit only** —
  half the principle; a compromised api-server still pivots into
  Keycloak's data through the shared role.
- **Non-owner app roles + separate migration role** — strict least-
  privilege but requires running migrations under a different
  identity than runtime; out of proportion with the marginal
  isolation gain after SUPERUSER is already gone.
- **Bounded admin role (`CREATEROLE` + `CREATEDB`, not SUPERUSER)** —
  break-glass and disaster recovery can't enumerate the privileges
  they'll need in advance, and a partial superuser still escalates;
  concentrating full rights in one audited, separately-credentialed
  role is the trade. Tightening this is future work.
- **`log_statement = mod` globally** — captures DML for audit, drowns
  the log in app traffic noise.
- **pgaudit extension** — purpose-built category-based audit, but
  the bundled Postgres image doesn't ship it; image migration
  unjustified for this guarantee.

## Consequences

- **Easier:** a leaked app credential is bounded to a single DB — a
  compromised api-server can't reach Keycloak's data, and vice versa.
  DBA work that runs as `platform_admin` is statement-logged by
  default into the postgres pod log, where the cluster log collector
  picks it up.
- **Harder:** humans use a separate credential for DBA work — the
  shared `platform` superuser is gone. Existing clusters need a
  one-time SQL migration: the bundled Postgres image makes the first
  role the bootstrap superuser, which cannot be demoted, so the
  pre-existing `platform` role becomes the admin role and two fresh
  NOSUPERUSER app roles take over database ownership — see the
  [migration runbook](../notes/postgres-role-operations.md).
- **Committed-to:**
  - The admin credential is high-value: total DB control. It lives
    in a K8s Secret and must be treated accordingly (sealed-secrets,
    external secret backends, manual handoff for prod).
  - Audit on admin sessions is best-effort, not enforced.
    `log_statement` is a SUSET parameter and `platform_admin` is
    SUPERUSER, so an admin session can `SET log_statement = 'none'`
    mid-session and the next statements run un-audited. The disable
    statement itself is recorded under the prior `'all'` setting,
    so the forensic story shows "admin disabled audit at time X"
    even when subsequent actions are dark. Enforcement against this
    requires pgaudit or external monitoring.
  - Admin sessions are attributed to the role, not the operator —
    the bundled chart issues one shared admin credential, so the
    log identifies *what* but not *who*. Per-human attribution at
    the DB layer is the operator's IAM concern (cloud IAM,
    bastion logs). Per-user attribution for application traffic
    remains the api-server's application-layer audit concern.
  - App-role migrations must continue to fit DDL-on-owned-database
    privileges. A future migration that needs SUPERUSER (e.g.
    `CREATE EXTENSION` on a non-trusted extension) breaks app boot.
