# shellcheck shell=sh
# Sourced by the claude-code harness shims. When the agent is pointed at a custom
# Anthropic-compatible upstream, bring up a local LiteLLM gateway (once per pod)
# and re-point Claude Code at it; otherwise do nothing. This runs here, not the
# image entrypoint, because credentials arrive over the runtime channel only once
# the harness is spawned. All diagnostics go to stderr — the chat shim's stdout
# carries the ACP JSON stream.

_LITELLM_BASE="http://127.0.0.1:4000"
_LITELLM_LOG=/tmp/litellm-proxy.log
_LITELLM_LOCK=/tmp/litellm-proxy.lock
_LITELLM_ENV_FILE=/tmp/litellm-gateway.env
# LiteLLM's TLS uses ssl.create_default_context(), which trusts no CAs on this
# image unless SSL_CERT_FILE is set. Point it at the system bundle (public CAs +
# the platform MITM CA that agent-entrypoint installs via update-ca-trust) so the
# upstream hop through the Envoy gateway verifies.
_LITELLM_CA_BUNDLE=/etc/pki/ca-trust/extracted/pem/tls-ca-bundle.pem

# Custom = set and not already a local proxy (guards re-wrap on warm restart).
_litellm_custom_upstream() {
	case "${ANTHROPIC_BASE_URL:-}" in
	"" | http://127.0.0.1:* | http://localhost:*) return 1 ;;
	*) return 0 ;;
	esac
}

# --noproxy: the loopback probe must bypass the pod-wide HTTP proxy.
_litellm_ready() {
	curl --noproxy '*' -fsS -o /dev/null --max-time 2 \
		"$_LITELLM_BASE/health/liveliness" 2>/dev/null
}

_litellm_start() {
	# mkdir is atomic: only the first concurrent harness starts the gateway; the
	# rest wait and share it. nohup keeps it alive past this per-session process.
	mkdir "$_LITELLM_LOCK" 2>/dev/null || return 0
	SSL_CERT_FILE="$_LITELLM_CA_BUNDLE" \
		nohup python3.12 /usr/local/lib/litellm-gateway.py \
		</dev/null >"$_LITELLM_LOG" 2>&1 &
}

_litellm_wait_ready() {
	_i=0
	while [ "$_i" -lt 60 ]; do
		_litellm_ready && return 0
		sleep 1
		_i=$((_i + 1))
	done
	return 1
}

if _litellm_custom_upstream; then
	# { } (not a subshell) so _litellm_start's background nohup survives.
	if _litellm_ready || { _litellm_start && _litellm_wait_ready; }; then
		# Point Claude Code at the proxy and keep the loopback hop off the proxy.
		export ANTHROPIC_BASE_URL="$_LITELLM_BASE"
		export NO_PROXY="127.0.0.1,localhost,::1${NO_PROXY:+,$NO_PROXY}"
		export no_proxy="127.0.0.1,localhost,::1${no_proxy:+,$no_proxy}"
		export CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY=1
		# Model-var defaults discovered from the upstream (assign-if-unset, so a
		# value set manually on the agent wins). Absent if discovery failed.
		[ -f "$_LITELLM_ENV_FILE" ] && . "$_LITELLM_ENV_FILE"
		echo "litellm-proxy: Claude Code routed through local LiteLLM proxy" >&2
	else
		# Never came up: drop the lock so a later session retries, and leave
		# ANTHROPIC_BASE_URL on the upstream so this session still works.
		rmdir "$_LITELLM_LOCK" 2>/dev/null || true
		echo "litellm-proxy: WARNING — proxy not ready; using upstream directly" >&2
		tail -n 20 "$_LITELLM_LOG" >&2 2>/dev/null || true
	fi
fi
