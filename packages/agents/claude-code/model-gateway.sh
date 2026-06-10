# shellcheck shell=sh
# Sourced by the claude-code harness shims and by the SSH login hook
# (/etc/profile.d/model-gateway.sh — see model-gateway-login.sh), so `claude`
# reaches the gateway over every entry path. When the agent is pointed at a
# custom Anthropic-compatible upstream, agent-runtime supervises a local model
# gateway fronting it (pod-service.sh, ADR-065/066); this hook waits for that
# gateway and re-points Claude Code at it. No-op without a custom upstream.
# All diagnostics go to stderr — the chat shim's stdout carries the ACP JSON
# stream.

# 24180 sits below the Linux ephemeral range and away from common dev-server
# defaults — agent workloads share this network namespace. Must match
# MODEL_GATEWAY_PORT's default in model-gateway.mjs.
_GATEWAY_BASE="http://127.0.0.1:24180"
_GATEWAY_ENV_FILE=/tmp/model-gateway.env

# Custom = set and not already a local proxy (guards re-wrap on warm restart).
# Keep in sync with the matching test in pod-service.sh.
_gateway_custom_upstream() {
	case "${ANTHROPIC_BASE_URL:-}" in
	"" | http://127.0.0.1:* | http://localhost:*) return 1 ;;
	*) return 0 ;;
	esac
}

# --noproxy: the loopback probe must bypass the pod-wide HTTP proxy.
_gateway_ready() {
	curl --noproxy '*' -fsS -o /dev/null --max-time 2 \
		"$_GATEWAY_BASE/health/liveliness" 2>/dev/null
}

# The runtime brings the gateway up as soon as env arrives and it starts in
# well under a second, so this wait only covers the supervisor's restart
# backoff after a crash.
_gateway_wait_ready() {
	_i=0
	while [ "$_i" -lt 30 ]; do
		_gateway_ready && return 0
		sleep 1
		_i=$((_i + 1))
	done
	return 1
}

if _gateway_custom_upstream; then
	if _gateway_wait_ready; then
		# Point Claude Code at the gateway and keep the loopback hop off the proxy.
		export ANTHROPIC_BASE_URL="$_GATEWAY_BASE"
		export NO_PROXY="127.0.0.1,localhost,::1${NO_PROXY:+,$NO_PROXY}"
		export no_proxy="127.0.0.1,localhost,::1${no_proxy:+,$no_proxy}"
		export CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY=1
		# Model-var defaults discovered from the upstream (assign-if-unset, so a
		# value set manually on the agent wins). Absent if discovery failed.
		[ -f "$_GATEWAY_ENV_FILE" ] && . "$_GATEWAY_ENV_FILE"
		echo "model-gateway: Claude Code routed through the local model gateway" >&2
	else
		# Leave ANTHROPIC_BASE_URL on the upstream so this session still works;
		# the supervisor keeps retrying the gateway in the background.
		echo "model-gateway: WARNING — gateway not ready; using upstream directly (diagnostics: pod logs, [pod-service] lines)" >&2
	fi
fi

# Leave no _gateway_* helpers behind in an interactive login shell that sourced
# this via the SSH hook; the harness shims exec immediately, so this is a no-op
# for them. The exported ANTHROPIC_BASE_URL / NO_PROXY / CLAUDE_CODE_* and the
# sourced model pins must survive — only internal helpers and scratch vars go.
unset -f _gateway_custom_upstream _gateway_ready _gateway_wait_ready 2>/dev/null || true
unset _GATEWAY_BASE _GATEWAY_ENV_FILE _i 2>/dev/null || true
