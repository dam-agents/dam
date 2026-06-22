# ADR-071: Postgres role separation — no SUPERUSER on app roles

**Date:** 2026-05-22
**Status:** Accepted
**Owner:** @pilartomas

## Context

The bundled Postgres runs a single role, `platform`, used as both the
api-server's and Keycloak's connection identity and granted SUPERUSER. A
leaked credential from either pod is a direct path to total cluster-wide DB
control — read or modify any data, create or drop roles, install extensions,
bypass row-level security, and pivot into the other service's data through the
shared role. Separating what an application's runtime credential can do from
what a DBA needs is a least-privilege concern, independent of whether the
operative instance is the bundled Postgres or an external managed one.

## Decision

The bundled Postgres runs three roles instead of one: a NOSUPERUSER owner per
service database, plus a single SUPERUSER reserved for DBA work.

- **`platform_apiserver`** and **`platform_keycloak`** — NOSUPERUSER owners of
  the `platform` and `keycloak` databases, each the only identity its service
  connects as. They run DDL within their own database (so each service migrates
  itself) but cannot create roles, alter the system, or bypass RLS.
  Cross-database access is closed at the door: `CONNECT` is revoked from
  `PUBLIC` and granted only to each database's owner, so neither app role can
  open a session on the other's database.
- **`platform`** — the lone SUPERUSER, used only for DBA work (migrations,
  ad-hoc, break-glass). The cluster's existing bootstrap superuser is kept as
  this role rather than renamed, since Postgres neither demotes the bootstrap
  superuser nor renames the role a session is connected as. Its sessions are
  statement-logged by default, while routine app traffic stays out of the audit
  stream.

One database per service stays; schema-based layout is left to a future ADR.

## Alternatives Considered

- **One shared app role, demoted to NOSUPERUSER** — still one identity across
  both services, so a compromised api-server pivots into Keycloak's data.
- **A dedicated, renamed admin role (`platform_admin`)** — Postgres won't rename
  the role a session is connected as nor demote the bootstrap superuser, so the
  existing role is kept as the admin in place instead.
- **Non-owner app roles + a separate migration role** — stricter, but splitting
  runtime and migration identity isn't worth the marginal gain once SUPERUSER
  is gone.
- **Bounded admin role (`CREATEROLE`/`CREATEDB`, not SUPERUSER)** — break-glass
  can't enumerate the privileges it will need in advance, and a partial
  superuser still escalates.
- **`log_statement = mod` globally** — captures DML but drowns the audit log in
  routine app traffic.
- **pgaudit extension** — not shipped in the bundled image; the right substitute
  on managed Postgres, where per-role `log_statement` isn't available (see the
  runbook).

## Consequences

- **Easier:** a leaked app credential is bounded to one database — a compromised
  api-server cannot reach Keycloak's data or escalate, and vice versa. DBA work
  run as the admin role is statement-logged into the postgres pod log, where the
  cluster collector picks it up. Existing clusters need no manual migration step.
- **Harder:** DBA work now needs a credential separate from the application's.
  Migrating an existing single-role cluster re-owns every object the shared role
  created to its new app-role owner; until that convergence completes on upgrade
  the app pods cannot connect under their new identities — a brief in-place
  window rather than a hand-run procedure (see the
  [migration runbook](../notes/postgres-role-operations.md)).
- **Committed-to:** the admin credential carries total DB control and lives in a
  K8s Secret, so it must be handled accordingly. Audit on admin sessions is
  best-effort, not enforced: `log_statement` is a SUSET parameter and the admin
  role is SUPERUSER, so a session can disable it mid-stream (the disable is
  itself recorded under the prior setting). Sessions are attributed to the role,
  not the human — per-operator attribution is an IAM concern. App-role
  migrations must keep fitting DDL-on-owned-database privileges; a future
  migration needing SUPERUSER (e.g. a non-trusted `CREATE EXTENSION`) would
  break app boot.
- **Managed Postgres:** the decision is provider-agnostic and is the native
  posture of managed services (RDS, Cloud SQL, IBM Cloud Databases), which
  withhold tenant SUPERUSER. The role shape reproduces as plain SQL, but the
  bundled *enforcement* — chart role bootstrap, per-role `log_statement` audit,
  stderr event logging — does not; there it becomes the operator's
  responsibility, audited with the provider's tooling (see the
  [runbook](../notes/postgres-role-operations.md)).
