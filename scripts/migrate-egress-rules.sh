#!/usr/bin/env bash
# One-time migration: backfill `egress_rules` for agents that pre-date
# ADR-035 / ADR-036.
#
# For every agent without the `humr.ai/egress-migrated` annotation, the
# script inserts:
#
#   1. A single wildcard row    (*, *, *, allow, source=preset:all)
#      "allow everything" — same effect as picking the `all` preset in
#      the UI. Existing workloads keep working without inbox prompts.
#
#   2. One row per granted secret    (hostPattern, *, *, allow,
#      source=connection:<secretId>) — fetched from OneCLI per-owner via
#      Keycloak service-account impersonation.
#
#   3. One row per granted app connection × declared egress host
#      (host, *, *, allow, source=connection:<appConnId>) — joining
#      OneCLI's connection list with the operator-owned
#      `app-connection-egress-hosts` ConfigMap.
#
# Idempotent: ON CONFLICT DO NOTHING on the unique
# `(agent, host, method, path_pattern)` index, plus the per-agent
# annotation marker. Safe to re-run.
#
# Prerequisites: bash, kubectl, jq, curl. Run from anywhere with kubectl
# context pointed at the target cluster.
#
# Usage:
#     scripts/migrate-egress-rules.sh [-n <namespace>] [--dry-run]

set -euo pipefail

NAMESPACE="${HUMR_NAMESPACE:-default}"
DRY_RUN=0
RELEASE="${HUMR_RELEASE:-humr}"
MIGRATION_NAME="2026-05-04-egress-rules-backfill"
MIGRATION_ANNOTATION="humr.ai/egress-migrated"

while [[ $# -gt 0 ]]; do
  case "$1" in
    -n|--namespace) NAMESPACE="$2"; shift 2;;
    --release) RELEASE="$2"; shift 2;;
    --dry-run) DRY_RUN=1; shift;;
    -h|--help)
      sed -n '2,/^set -/p' "$0" | sed 's/^# \?//; /^set -/d'
      exit 0;;
    *) echo "unknown arg: $1" >&2; exit 2;;
  esac
done

K() { kubectl -n "$NAMESPACE" "$@"; }

API_POD="$(K get pod \
  -l app.kubernetes.io/instance="$RELEASE",app.kubernetes.io/component=apiserver \
  -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || true)"
PG_POD="$RELEASE-postgres-0"

if [[ -z "$API_POD" ]]; then
  echo "ERROR: no api-server pod found in namespace $NAMESPACE" >&2
  echo "       label selector: app.kubernetes.io/instance=$RELEASE,app.kubernetes.io/component=apiserver" >&2
  exit 1
fi

for tool in jq curl; do
  command -v "$tool" >/dev/null || { echo "ERROR: $tool not on PATH" >&2; exit 1; }
done

echo "namespace:       $NAMESPACE"
echo "api-server pod:  $API_POD"
echo "postgres pod:    $PG_POD"
echo "dry-run:         $DRY_RUN"
echo

# ---------------------------------------------------------------------------
# Pull config out of the api-server's env / mounted ConfigMaps.
# ---------------------------------------------------------------------------

api_env() {
  K exec "$API_POD" -- printenv "$1" 2>/dev/null || true
}

KEYCLOAK_URL="$(api_env KEYCLOAK_URL)"
KEYCLOAK_REALM="$(api_env KEYCLOAK_REALM)"
KC_CLIENT_ID="$(api_env KEYCLOAK_API_CLIENT_ID)"
KC_CLIENT_SECRET="$(api_env KEYCLOAK_API_CLIENT_SECRET)"
ONECLI_AUDIENCE="$(api_env ONECLI_AUDIENCE)"
ONECLI_WEB_URL="$(api_env ONECLI_WEB_URL)"
PG_USER="$(api_env DATABASE_URL | sed -E 's,^postgresql://([^:]+):.*,\1,')"
PG_DB="$(api_env DATABASE_URL | sed -E 's,^.*/([^?]+).*,\1,')"
PG_PASSWORD="$(api_env POSTGRES_PASSWORD)"

for v in KEYCLOAK_URL KEYCLOAK_REALM KC_CLIENT_ID KC_CLIENT_SECRET ONECLI_AUDIENCE ONECLI_WEB_URL PG_USER PG_DB PG_PASSWORD; do
  if [[ -z "${!v}" ]]; then
    echo "ERROR: failed to read $v from api-server pod env" >&2
    exit 1
  fi
done

# Operator-owned provider→hosts map for app connections.
APP_HOSTS_JSON="$(K exec "$API_POD" -- cat /etc/humr/app-connection-egress-hosts.json 2>/dev/null || echo '{}')"

# ---------------------------------------------------------------------------
# Port-forwards. The api-server pod is distroless (no curl), so we open
# local ports to Keycloak and OneCLI Services and call them with local curl.
# ---------------------------------------------------------------------------

# `kubectl port-forward :0` asks the local kernel for a free port; we read it
# back from kubectl's first stdout line ("Forwarding from 127.0.0.1:NNNN ->
# 8080"). Background and reap on exit.
forward() {
  # $1 = svc/<name>, $2 = remote port
  local target="$1" remote="$2"
  local logfile
  logfile="$(mktemp)"
  K port-forward --address 127.0.0.1 "$target" ":$remote" >"$logfile" 2>&1 &
  local pid=$!
  PORT_FORWARD_PIDS+=("$pid")
  PORT_FORWARD_LOGS+=("$logfile")
  for _ in $(seq 1 50); do
    sleep 0.1
    if grep -q "Forwarding from 127.0.0.1:" "$logfile" 2>/dev/null; then
      sed -nE 's,Forwarding from 127\.0\.0\.1:([0-9]+) -> .*,\1,p' "$logfile" | head -n1
      return 0
    fi
  done
  echo "ERROR: port-forward to $target:$remote did not become ready" >&2
  cat "$logfile" >&2
  exit 1
}

PORT_FORWARD_PIDS=()
PORT_FORWARD_LOGS=()
cleanup() {
  for pid in "${PORT_FORWARD_PIDS[@]:-}"; do
    [[ -n "$pid" ]] && kill "$pid" 2>/dev/null || true
  done
  for f in "${PORT_FORWARD_LOGS[@]:-}"; do
    [[ -n "$f" ]] && rm -f "$f"
  done
}
trap cleanup EXIT

# Parse Keycloak and OneCLI URLs to extract the in-cluster service name & port,
# then port-forward to that Service.
parse_svc() {
  # http://NAME:PORT  →  svc/NAME PORT
  echo "$1" | sed -E 's,^https?://([^:/]+):([0-9]+).*,\1 \2,'
}
read -r KC_SVC KC_PORT < <(parse_svc "$KEYCLOAK_URL")
read -r OC_SVC OC_PORT < <(parse_svc "$ONECLI_WEB_URL")

KC_LOCAL_PORT="$(forward "svc/$KC_SVC" "$KC_PORT")"
OC_LOCAL_PORT="$(forward "svc/$OC_SVC" "$OC_PORT")"

KC_TOKEN_URL="http://127.0.0.1:$KC_LOCAL_PORT/realms/$KEYCLOAK_REALM/protocol/openid-connect/token"
ONECLI_BASE="http://127.0.0.1:$OC_LOCAL_PORT"
echo "keycloak fwd:    127.0.0.1:$KC_LOCAL_PORT → $KC_SVC:$KC_PORT"
echo "onecli fwd:      127.0.0.1:$OC_LOCAL_PORT → $OC_SVC:$OC_PORT"
echo

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

# Run SQL inside the postgres pod. Stdin is piped to psql for multi-statement
# inputs; output is the raw psql stdout. Each call is one TCP round trip into
# the cluster, so callers should batch a single agent's writes into one call.
psql_exec() {
  K exec -i "$PG_POD" -- env PGPASSWORD="$PG_PASSWORD" \
    psql -v ON_ERROR_STOP=1 -U "$PG_USER" -d "$PG_DB" -At "$@"
}

api_curl() {
  # $1 = bearer token, $2 = path (with leading /).
  local token="$1" path="$2"
  curl -fsS -H "Authorization: Bearer $token" "$ONECLI_BASE$path"
}

# Service-account token (client_credentials). Cached for the run.
SA_TOKEN=""
sa_token() {
  if [[ -n "$SA_TOKEN" ]]; then echo "$SA_TOKEN"; return; fi
  SA_TOKEN="$(curl -fsS "$KC_TOKEN_URL" \
    -d grant_type=client_credentials \
    -d "client_id=$KC_CLIENT_ID" \
    -d "client_secret=$KC_CLIENT_SECRET" \
    | jq -r .access_token)"
  if [[ -z "$SA_TOKEN" || "$SA_TOKEN" == "null" ]]; then
    echo "ERROR: failed to get Keycloak service-account token" >&2
    exit 1
  fi
  echo "$SA_TOKEN"
}

# Impersonation token for a specific user sub (RFC 8693 token-exchange with
# requested_subject). Each owner needs its own token.
impersonate() {
  local sub="$1"
  local sa
  sa="$(sa_token)"
  curl -fsS "$KC_TOKEN_URL" \
    -d "grant_type=urn:ietf:params:oauth:grant-type:token-exchange" \
    -d "client_id=$KC_CLIENT_ID" \
    -d "client_secret=$KC_CLIENT_SECRET" \
    -d "subject_token=$sa" \
    -d "subject_token_type=urn:ietf:params:oauth:token-type:access_token" \
    -d "requested_subject=$sub" \
    -d "requested_token_type=urn:ietf:params:oauth:token-type:access_token" \
    -d "audience=$ONECLI_AUDIENCE" \
    | jq -r .access_token
}

# Build a single multi-statement SQL block for one agent and pipe it to psql
# in one go. Wrapped in a transaction so a partial failure leaves the agent
# untouched (next run picks it up again because the annotation isn't set).
emit_sql_for_agent() {
  local agent_id="$1" owner_sub="$2" connection_pairs="$3"
  cat <<SQL
BEGIN;
INSERT INTO egress_rules (id, agent_id, host, method, path_pattern, verdict, decided_by, source)
VALUES (gen_random_uuid()::text, '$agent_id', '*', '*', '*', 'allow', 'migration:$MIGRATION_NAME', 'preset:all')
ON CONFLICT DO NOTHING;
$connection_pairs
COMMIT;
SQL
}

# ---------------------------------------------------------------------------
# Iterate agents
# ---------------------------------------------------------------------------

AGENTS_JSON="$(K get configmaps -l humr.ai/type=agent -o json)"
TOTAL="$(echo "$AGENTS_JSON" | jq '.items | length')"
echo "found $TOTAL agent ConfigMap(s) in namespace $NAMESPACE"
echo

migrated=0
skipped=0
failed=0

if [[ "$TOTAL" -eq 0 ]]; then
  echo "nothing to do."
  exit 0
fi

for i in $(seq 0 $((TOTAL - 1))); do
  AGENT_ID="$(echo "$AGENTS_JSON" | jq -r ".items[$i].metadata.name")"
  OWNER_SUB="$(echo "$AGENTS_JSON" | jq -r ".items[$i].metadata.labels[\"humr.ai/owner\"]")"
  ALREADY="$(echo "$AGENTS_JSON" | jq -r ".items[$i].metadata.annotations[\"$MIGRATION_ANNOTATION\"] // \"\"")"

  if [[ -n "$ALREADY" ]]; then
    echo "[$AGENT_ID] skip — already migrated at $ALREADY"
    skipped=$((skipped + 1))
    continue
  fi

  if [[ -z "$OWNER_SUB" || "$OWNER_SUB" == "null" ]]; then
    echo "[$AGENT_ID] skip — no owner label"
    skipped=$((skipped + 1))
    continue
  fi

  echo "[$AGENT_ID] owner=$OWNER_SUB → migrating"

  # ----- fetch grants (best-effort; failure → still migrate the wildcard) ---
  CONNECTION_SQL=""
  if TOKEN="$(impersonate "$OWNER_SUB")" && [[ -n "$TOKEN" && "$TOKEN" != "null" ]]; then
    AGENTS_LIST="$(api_curl "$TOKEN" "/api/agents" || echo '[]')"
    ONECLI_AGENT_ID="$(echo "$AGENTS_LIST" | jq -r ".[] | select(.identifier == \"$AGENT_ID\") | .id" | head -n1)"

    if [[ -n "$ONECLI_AGENT_ID" && "$ONECLI_AGENT_ID" != "null" ]]; then
      ALL_SECRETS="$(api_curl "$TOKEN" "/api/secrets" || echo '[]')"
      GRANTED_SECRET_IDS="$(api_curl "$TOKEN" "/api/agents/$ONECLI_AGENT_ID/secrets" || echo '[]')"

      while read -r SEC_ID; do
        [[ -z "$SEC_ID" ]] && continue
        HOST="$(echo "$ALL_SECRETS" | jq -r ".[] | select(.id == \"$SEC_ID\") | .hostPattern" | head -n1)"
        if [[ -n "$HOST" && "$HOST" != "null" ]]; then
          CONNECTION_SQL+="INSERT INTO egress_rules (id, agent_id, host, method, path_pattern, verdict, decided_by, source) VALUES (gen_random_uuid()::text, '$AGENT_ID', '$HOST', '*', '*', 'allow', '$OWNER_SUB', 'connection:$SEC_ID') ON CONFLICT DO NOTHING;
"
        fi
      done < <(echo "$GRANTED_SECRET_IDS" | jq -r '.[]?')

      ALL_APPS="$(api_curl "$TOKEN" "/api/connections" || echo '[]')"
      GRANTED_APP_IDS="$(api_curl "$TOKEN" "/api/agents/$ONECLI_AGENT_ID/connections" || echo '[]')"

      while read -r APP_ID; do
        [[ -z "$APP_ID" ]] && continue
        PROVIDER="$(echo "$ALL_APPS" | jq -r ".[] | select(.id == \"$APP_ID\") | .provider" | head -n1)"
        [[ -z "$PROVIDER" || "$PROVIDER" == "null" ]] && continue
        while read -r HOST; do
          [[ -z "$HOST" ]] && continue
          CONNECTION_SQL+="INSERT INTO egress_rules (id, agent_id, host, method, path_pattern, verdict, decided_by, source) VALUES (gen_random_uuid()::text, '$AGENT_ID', '$HOST', '*', '*', 'allow', '$OWNER_SUB', 'connection:$APP_ID') ON CONFLICT DO NOTHING;
"
        done < <(echo "$APP_HOSTS_JSON" | jq -r ".[\"$PROVIDER\"][]?")
      done < <(echo "$GRANTED_APP_IDS" | jq -r '.[]?')
    else
      echo "[$AGENT_ID] note: not registered in OneCLI yet — wildcard only"
    fi
  else
    echo "[$AGENT_ID] note: impersonation failed for owner $OWNER_SUB — wildcard only"
  fi

  SQL="$(emit_sql_for_agent "$AGENT_ID" "$OWNER_SUB" "$CONNECTION_SQL")"

  if [[ "$DRY_RUN" -eq 1 ]]; then
    echo "$SQL" | sed 's/^/    /'
    echo "    [dry-run] would annotate ConfigMap"
    migrated=$((migrated + 1))
    continue
  fi

  if echo "$SQL" | psql_exec >/dev/null; then
    K annotate configmap "$AGENT_ID" \
      "$MIGRATION_ANNOTATION=$(date -u +%Y-%m-%dT%H:%M:%SZ)" --overwrite >/dev/null
    migrated=$((migrated + 1))
    echo "[$AGENT_ID] done"
  else
    failed=$((failed + 1))
    echo "[$AGENT_ID] FAILED — see psql output above" >&2
  fi
done

echo
echo "summary: migrated=$migrated skipped=$skipped failed=$failed (total=$TOTAL)"
[[ "$failed" -eq 0 ]]
