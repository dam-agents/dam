# shellcheck shell=sh
# Sourced by the claude-code harness shims and by the SSH login hook
# (/etc/profile.d/litellm-proxy.sh — see litellm-login.sh), so `claude` reaches
# the gateway over every entry path. When the agent is pointed at a custom
# Anthropic-compatible upstream, agent-runtime supervises a local LiteLLM
# gateway fronting it (pod-service.sh, ADR-065); this hook waits for that
# gateway and re-points Claude Code at it. No-op without a custom upstream.
# All diagnostics go to stderr — the chat shim's stdout carries the ACP JSON
# stream.

_LITELLM_BASE="http://127.0.0.1:4000"
_LITELLM_ENV_FILE=/tmp/litellm-gateway.env

# Custom = set and not already a local proxy (guards re-wrap on warm restart).
# Keep in sync with the matching test in pod-service.sh.
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

# The runtime brings the gateway up as soon as env arrives, so it is usually
# ready before the first session; this wait only covers LiteLLM's cold start
# (and the supervisor's restart backoff after a crash).
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
	if _litellm_wait_ready; then
		# Point Claude Code at the gateway and keep the loopback hop off the proxy.
		export ANTHROPIC_BASE_URL="$_LITELLM_BASE"
		export NO_PROXY="127.0.0.1,localhost,::1${NO_PROXY:+,$NO_PROXY}"
		export no_proxy="127.0.0.1,localhost,::1${no_proxy:+,$no_proxy}"
		export CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY=1
		# Model-var defaults discovered from the upstream (assign-if-unset, so a
		# value set manually on the agent wins). Absent if discovery failed.
		[ -f "$_LITELLM_ENV_FILE" ] && . "$_LITELLM_ENV_FILE"
		echo "litellm-proxy: Claude Code routed through local LiteLLM gateway" >&2
	else
		# Leave ANTHROPIC_BASE_URL on the upstream so this session still works;
		# the supervisor keeps retrying the gateway in the background.
		echo "litellm-proxy: WARNING — gateway not ready; using upstream directly (diagnostics: pod logs, [pod-service] lines)" >&2
	fi
fi

# Leave no _litellm_* helpers behind in an interactive login shell that sourced
# this via the SSH hook; the harness shims exec immediately, so this is a no-op
# for them. The exported ANTHROPIC_BASE_URL / NO_PROXY / CLAUDE_CODE_* and the
# sourced model pins must survive — only internal helpers and scratch vars go.
unset -f _litellm_custom_upstream _litellm_ready _litellm_wait_ready 2>/dev/null || true
unset _LITELLM_BASE _LITELLM_ENV_FILE _i 2>/dev/null || true
