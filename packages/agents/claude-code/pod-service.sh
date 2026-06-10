#!/bin/sh
# claude-code pod service (ADR-065): the local model gateway fronting a custom
# Anthropic-compatible upstream (ADR-066). agent-runtime spawns this with the
# current runtime env once env is materialized, supervises it (crash restart
# with backoff), and respawns it whenever env changes — so the gateway never
# routes on a stale upstream or token. Exit 0 means "nothing to front": the
# runtime then leaves the service down until the env next changes.
#
# Keep the custom-upstream test in sync with model-gateway.sh, which makes the
# same decision per session before re-pointing Claude Code at the gateway.
case "${ANTHROPIC_BASE_URL:-}" in
"" | http://127.0.0.1:* | http://localhost:*) exit 0 ;;
esac

# The gateway's upstream hop must cross the Envoy gateway for credential
# injection: NODE_USE_ENV_PROXY makes Node's fetch() honor HTTP(S)_PROXY /
# NO_PROXY. TLS to the MITM'd upstream verifies via the controller-injected
# NODE_EXTRA_CA_CERTS (Node adds it to its bundled public roots).
NODE_USE_ENV_PROXY=1
export NODE_USE_ENV_PROXY

exec node /usr/local/lib/model-gateway.mjs
