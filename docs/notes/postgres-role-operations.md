# Postgres role separation — operations

Last verified: 2026-06-08

Operational runbook for the three-role Postgres split decided in
[ADR-062](../adrs/062-postgres-role-separation.md). The ADR carries the *why*;
this note carries the *how* — the parts that move when the chart changes.

The bundled Postgres ends up with three roles:

- `platform_admin` — `SUPERUSER`, `LOGIN`. The image's bootstrap superuser
  (`POSTGRES_USER`); humans and deploy-time bootstrap use it for DBA work. Its
  sessions are statement-logged by default.
- `platform_apiserver` — owns the `platform` database; the api-server's
  connection identity. `LOGIN`, `NOSUPERUSER`.
- `platform_keycloak` — owns the `keycloak` database; Keycloak's connection
  identity. `LOGIN`, `NOSUPERUSER`.

## Fresh install

The image creates `platform_admin` as the bootstrap superuser; the
`01-init-databases.sh` init script creates the two NOSUPERUSER app roles and
their databases on first PGDATA init. Passwords are auto-generated and stored in
the `platform-postgres-secrets` Secret under `POSTGRES_APISERVER_PASSWORD`,
`POSTGRES_KEYCLOAK_PASSWORD`, and `POSTGRES_ADMIN_PASSWORD`. Retrieve the admin
credential with:

```sh
mise run cluster:kubectl -- get secret platform-postgres-secrets \
  -o jsonpath='{.data.POSTGRES_ADMIN_PASSWORD}' | base64 -d
```

Local dev: `mise run cluster:uninstall && mise run cluster:install`
re-bootstraps cleanly.

## Migrating an existing cluster

A cluster that predates the split runs a single `platform` role, created by the
image as the **bootstrap superuser** (`initdb --username=platform`). Postgres
forbids demoting the bootstrap superuser, so the migration repurposes it as the
admin role — which keeps SUPERUSER anyway — and creates two fresh NOSUPERUSER
roles for the services.

**Order matters — upgrade the chart first.** The upgrade renders the new
three-key Secret: the chart's `lookup` finds the old single-key Secret, doesn't
see the new keys, and generates fresh `apiserver` / `keycloak` / `admin`
passwords. Running the SQL first would set role passwords that don't match those
generated values. The api-server and Keycloak pods CrashLoop in the window
between the upgrade and the SQL below — expected; they recover once the roles
they connect as exist.

1. Upgrade the chart (`mise run cluster:install`, or `helm upgrade`).

2. Read the three generated passwords from the Secret:

   ```sh
   for k in APISERVER KEYCLOAK ADMIN; do
     printf '%s=' "$k"
     mise run cluster:kubectl -- get secret platform-postgres-secrets \
       -o jsonpath="{.data.POSTGRES_${k}_PASSWORD}" | base64 -d; echo
   done
   ```

3. Run the migration as the existing superuser over the pod's local socket
   (trust auth — no password needed, which is why the upgrade having dropped the
   old `POSTGRES_PASSWORD` key doesn't block you). Substitute the three values
   from step 2:

   ```sh
   mise run cluster:kubectl -- exec -i sts/platform-postgres -- \
     psql -v ON_ERROR_STOP=1 -U platform -d postgres <<'SQL'
   -- The bootstrap superuser can't be demoted, so repurpose it as the admin role.
   ALTER ROLE platform RENAME TO platform_admin;
   ALTER ROLE platform_admin PASSWORD '<ADMIN>';
   ALTER ROLE platform_admin SET log_statement = 'all';

   -- Fresh NOSUPERUSER application roles.
   CREATE ROLE platform_apiserver LOGIN NOSUPERUSER PASSWORD '<APISERVER>';
   CREATE ROLE platform_keycloak  LOGIN NOSUPERUSER PASSWORD '<KEYCLOAK>';

   -- Hand each database's objects to its app role and block cross-database CONNECT.
   \c platform
   REASSIGN OWNED BY platform_admin TO platform_apiserver;
   REVOKE CONNECT ON DATABASE platform FROM PUBLIC;
   GRANT  CONNECT ON DATABASE platform TO platform_apiserver;
   \c keycloak
   REASSIGN OWNED BY platform_admin TO platform_keycloak;
   REVOKE CONNECT ON DATABASE keycloak FROM PUBLIC;
   GRANT  CONNECT ON DATABASE keycloak TO platform_keycloak;

   -- Set database ownership last so it is authoritative regardless of how
   -- REASSIGN OWNED treated the shared database objects.
   ALTER DATABASE platform OWNER TO platform_apiserver;
   ALTER DATABASE keycloak  OWNER TO platform_keycloak;
   SQL
   ```

4. Re-roll the api-server and Keycloak pods if they haven't already recovered,
   so they reconnect under the renamed identities:

   ```sh
   mise run cluster:kubectl -- rollout restart \
     deploy/platform-apiserver deploy/platform-keycloak
   ```
