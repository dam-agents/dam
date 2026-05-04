# scripts/

One-off operational scripts. Not part of the runtime — meant to be run by an
operator against a deployed cluster.

## `migrate-egress-rules.sh`

One-time backfill for agents that pre-date ADR-035 / ADR-036. For every
agent ConfigMap without the `humr.ai/egress-migrated` annotation, the script
inserts:

1. A wildcard `(*, *, *, allow, source=preset:all)` row — equivalent to the
   `all` preset. Existing workloads keep working without inbox prompts.
2. One `(host, *, *, allow, source=connection:<id>)` row per currently-
   granted secret + app connection. Grants come from OneCLI via Keycloak
   service-account impersonation; provider hosts come from the
   `app-connection-egress-hosts` ConfigMap.

Idempotent (`ON CONFLICT DO NOTHING` + per-agent annotation). Safe to re-run.

```sh
# Set kubectl context, then:
./scripts/migrate-egress-rules.sh                  # default namespace, default release
./scripts/migrate-egress-rules.sh --dry-run        # print SQL without writing
./scripts/migrate-egress-rules.sh -n humr-prod     # different namespace
```

Requires `bash`, `kubectl`, `jq`, `curl` on the operator's machine. Opens
local port-forwards to Keycloak and OneCLI Services for the duration of the
run; tears them down on exit.

If impersonation fails for an owner (deleted user, Keycloak misconfig), the
script still inserts the wildcard row for that agent and logs a note —
connection rules can be re-derived later by the user opening the Configure
dialog and re-saving.
