#!/bin/sh
# claude-code pod service (ADR-065): the local LiteLLM gateway fronting a
# custom Anthropic-compatible upstream. agent-runtime spawns this with the
# current runtime env once env is materialized, supervises it (crash restart
# with backoff), and respawns it whenever env changes — so the gateway never
# routes on a stale upstream or token. Exit 0 means "nothing to front": the
# runtime then leaves the service down until the env next changes.
#
# Keep the custom-upstream test in sync with litellm-proxy.sh, which makes the
# same decision per session before re-pointing Claude Code at the gateway.
case "${ANTHROPIC_BASE_URL:-}" in
"" | http://127.0.0.1:* | http://localhost:*) exit 0 ;;
esac

# LiteLLM's TLS uses ssl.create_default_context(), which trusts no CAs on this
# image unless SSL_CERT_FILE is set. Point it at the system bundle (public CAs +
# the platform MITM CA that agent-entrypoint installs via update-ca-trust) so
# the upstream hop through the Envoy gateway verifies.
SSL_CERT_FILE=/etc/pki/ca-trust/extracted/pem/tls-ca-bundle.pem
export SSL_CERT_FILE

exec python3.12 /usr/local/lib/litellm-gateway.py
