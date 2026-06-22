# Postgres role separation — operations

Last verified: 2026-06-22

Operational runbook for the three-role Postgres split decided in
[ADR-071](../adrs/071-postgres-role-separation.md). The ADR carries the *why*;
this note carries the *how* — the parts that move when the chart changes.

The bundled Postgres ends up with three roles:

- `platform` — `SUPERUSER`, `LOGIN`. The image's bootstrap superuser
  (`POSTGRES_USER`, set from `postgres.adminUser`, default `platform`); humans
  and the migration Job use it for DBA work. Its sessions are statement-logged
  by default. The name is the one an existing single-role cluster already
  bootstrapped with, so it is kept in place rather than renamed.
- `platform_apiserver` — owns the `platform` database; the api-server's
  connection identity. `LOGIN`, `NOSUPERUSER`.
- `platform_keycloak` — owns the `keycloak` database; Keycloak's connection
  identity. `LOGIN`, `NOSUPERUSER`.

The whole layout is one idempotent script, `01-roles.sql` (the
`platform-postgres-init` ConfigMap). It is applied two ways from the same file:
the image runs it on first PGDATA init, and the
`platform-postgres-migrate-roles` Job (a `post-install,post-upgrade` Helm hook)
runs it against an already-initialised cluster. Role names and passwords reach
the script from the environment via `\getenv`, so both callers share it.

## Fresh install

The image creates `platform` as the bootstrap superuser, then runs `01-roles.sql`
on first PGDATA init to create the two NOSUPERUSER app roles, their databases,
the CONNECT isolation, and the admin statement-log default. Passwords are
auto-generated and stored in the `platform-postgres-secrets` Secret under
`POSTGRES_APISERVER_PASSWORD`, `POSTGRES_KEYCLOAK_PASSWORD`, and
`POSTGRES_ADMIN_PASSWORD`. Retrieve the admin credential with:

```sh
mise run cluster:kubectl -- get secret platform-postgres-secrets \
  -o jsonpath='{.data.POSTGRES_ADMIN_PASSWORD}' | base64 -d
```

Local dev: `mise run cluster:uninstall && mise run cluster:install`
re-bootstraps cleanly.

## Migrating an existing cluster

Automatic — just upgrade the chart (`mise run cluster:install`, or
`helm upgrade`). No manual SQL step.

A cluster that predates the split runs a single `platform` role, created by the
image as the bootstrap superuser. The init script does not re-run on an existing
PGDATA, so the `platform-postgres-migrate-roles` Job does the convergence: as a
`post-install,post-upgrade` hook it runs the same `01-roles.sql` against the
running database, which

- creates `platform_apiserver` / `platform_keycloak` as `LOGIN NOSUPERUSER`,
- makes each the owner of its database and of the objects in it (so it can
  `ALTER`/`DROP` them in future migrations),
- revokes cross-database `CONNECT` and grants it back only to the owner,
- attaches the `log_statement = 'all'` default to the admin role.

The existing `platform` superuser is kept as the admin role — it is **not**
renamed (Postgres forbids renaming the role you are connected as, and the
bootstrap superuser cannot be demoted) and the objects it owns are moved
per-object rather than with `REASSIGN OWNED` (which the bootstrap superuser
cannot be the source of, since it owns pinned system objects).

The Job authenticates as `platform` with the admin password. The chart carries
that password forward: on upgrade the Secret's `lookup` reuses the pre-upgrade
shared `POSTGRES_PASSWORD` as `POSTGRES_ADMIN_PASSWORD`, so it still matches the
running role. The api-server and Keycloak pods may CrashLoop in the short window
between the rollout and the Job finishing; they recover once the roles they
connect as exist.

**Manual fallback** (only if the hook was disabled or failed): re-run the same
script from the postgres pod, where it is mounted with the environment it needs.
It is idempotent, so re-running is safe.

```sh
mise run cluster:kubectl -- exec -i sts/platform-postgres -- bash -lc \
  'PGPASSWORD="$POSTGRES_PASSWORD" psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" \
     -d postgres -f /docker-entrypoint-initdb.d/01-roles.sql'
```

## External / managed Postgres

With `postgres.enabled: false` and the api-server / Keycloak pointed at an
external or managed instance (IBM Cloud Databases for PostgreSQL, RDS, Cloud
SQL), the bundled bootstrap above does not run — there is no StatefulSet, init
script, or server flag. Reproduce the role shape out-of-band, as the provider's
admin role:

- **One instance hosts both databases.** A single managed deployment carries
  both `platform` and `keycloak` (`CREATE DATABASE` works as the provider admin —
  on IBM Cloud Databases the admin inherits `CREATEDB`/`CREATEROLE` from
  `ibm-cloud-base-user`). The database-level `REVOKE CONNECT` isolation works
  within one server, so a second instance is only warranted for stronger
  blast-radius separation, not by this design.
- Create `platform_apiserver` and `platform_keycloak` as `LOGIN NOSUPERUSER`,
  each owning its own database; `REVOKE CONNECT ON DATABASE … FROM PUBLIC` and
  grant it back only to the owner. This is portable SQL.
- There is no dedicated admin SUPERUSER to create — managed services withhold
  tenant superuser (on IBM Cloud Databases the only superuser is IBM's internal
  `ibm` account), so the provider's admin role *is* the top role.
- **Logging is server-wide and covers every database on the instance** — the
  `log_*` GUCs are not per-database, so one configuration captures both
  `platform` and `keycloak`. Set `log_connections` / `log_disconnections` through
  the provider's configuration (not server flags); logs flow to the provider's
  logging service rather than pod stderr, and `log_line_prefix` is typically not
  tunable.
- The per-role `log_statement = 'all'` admin audit does not translate — it is a
  superuser-only (SUSET) GUC the provider's admin cannot set, and `log_statement`
  is often not exposed at all. Use **`pgaudit`** for statement/DDL auditing where
  the provider offers it (IBM Cloud Databases does, enabled via a config
  function); it runs cluster-wide and so likewise covers both databases. If you
  ever split across two instances, configure logging *and* pgaudit on each — or
  one service's database goes dark.

Supply the connection passwords yourself, under the secret keys the chart now
reads — **`POSTGRES_APISERVER_PASSWORD`** and **`POSTGRES_KEYCLOAK_PASSWORD`**
(renamed from the former single `POSTGRES_PASSWORD`). Update any pre-existing
operator-managed secret accordingly, or the pods will not find the password.
Managed instances also generally require TLS — set `sslmode` and the provider
CA in the connection accordingly.
