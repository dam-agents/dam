# shellcheck shell=sh
# Sourced by the harness shims and the SSH login hook to route `claude`
# through the local model gateway when a custom Anthropic upstream is set
# (ADR-065/066). Diagnostics go to stderr only — the chat shim's stdout
# carries the ACP JSON stream.

_GATEWAY_BASE="http://127.0.0.1:24180" # MODEL_GATEWAY_PORT default in model-gateway.mjs

# Keep in sync with customUpstream() in model-gateway.mjs; "already loopback"
# guards re-wrapping on warm restart.
_gateway_custom_upstream() {
	case "${ANTHROPIC_BASE_URL:-}" in
	"" | http://127.0.0.1:* | http://localhost:*) return 1 ;;
	*) return 0 ;;
	esac
}

# Fetching /env.sh doubles as the readiness probe. --noproxy: the loopback
# hop must bypass the pod-wide HTTP proxy. The wait only covers the
# supervisor's crash-restart backoff; normally the gateway is up well before
# the first session.
_gateway_wait_env() {
	_i=0
	while [ "$_i" -lt 30 ]; do
		_gateway_env=$(curl --noproxy '*' -fsS --max-time 2 \
			"$_GATEWAY_BASE/env.sh" 2>/dev/null) && return 0
		sleep 1
		_i=$((_i + 1))
	done
	return 1
}

if _gateway_custom_upstream; then
	if _gateway_wait_env; then
		export ANTHROPIC_BASE_URL="$_GATEWAY_BASE"
		export NO_PROXY="127.0.0.1,localhost,::1${NO_PROXY:+,$NO_PROXY}"
		export no_proxy="127.0.0.1,localhost,::1${no_proxy:+,$no_proxy}"
		export CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY=1
		# Discovered tier-default model vars (assign-if-unset; empty until
		# discovery succeeds).
		eval "$_gateway_env"
		echo "model-gateway: Claude Code routed through the local model gateway" >&2
	else
		echo "model-gateway: WARNING — gateway not ready; using upstream directly (diagnostics: pod logs, [pod-service] lines)" >&2
	fi
fi

# Leave nothing but the exported vars behind in an interactive login shell
# that sourced this via the SSH hook.
unset -f _gateway_custom_upstream _gateway_wait_env 2>/dev/null || true
unset _GATEWAY_BASE _gateway_env _i 2>/dev/null || true
