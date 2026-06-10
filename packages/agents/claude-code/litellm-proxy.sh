# shellcheck shell=sh
# Sourced by the claude-code harness shims and the SSH login hook. When pointed
# at a custom Anthropic upstream, bring up a local LiteLLM gateway (once per pod)
# and re-point Claude Code at it; otherwise do nothing. Runs here, not the image
# entrypoint, because credentials arrive over the runtime channel only once the
# harness/SSH session spawns. Diagnostics go to stderr (chat stdout is ACP JSON).

_LITELLM_BASE="http://127.0.0.1:4000"
_LITELLM_LOG=/tmp/litellm-proxy.log
_LITELLM_LOCK=/tmp/litellm-proxy.lock
_LITELLM_ENV_FILE=/tmp/litellm-gateway.env
# LiteLLM's ssl.create_default_context() trusts no CAs here unless SSL_CERT_FILE
# points at the system bundle (public CAs + the platform MITM CA).
_LITELLM_CA_BUNDLE=/etc/pki/ca-trust/extracted/pem/tls-ca-bundle.pem
_litellm_pid=""

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

# Atomic mkdir: only the first concurrent session starts the gateway; the rest
# wait and share it. nohup keeps it alive past this per-session process.
_litellm_start() {
	mkdir "$_LITELLM_LOCK" 2>/dev/null || return 0
	SSL_CERT_FILE="$_LITELLM_CA_BUNDLE" \
		nohup python3.12 /usr/local/lib/litellm-gateway.py \
		</dev/null >"$_LITELLM_LOG" 2>&1 &
	_litellm_pid=$!
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
	# { } (not a subshell) so the background nohup survives.
	if _litellm_ready || { _litellm_start && _litellm_wait_ready; }; then
		export ANTHROPIC_BASE_URL="$_LITELLM_BASE"
		export NO_PROXY="127.0.0.1,localhost,::1${NO_PROXY:+,$NO_PROXY}"
		export no_proxy="127.0.0.1,localhost,::1${no_proxy:+,$no_proxy}"
		export CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY=1
		# Model pins discovered from the upstream (assign-if-unset, so a value
		# set on the agent wins); absent if discovery failed.
		[ -f "$_LITELLM_ENV_FILE" ] && . "$_LITELLM_ENV_FILE"
		echo "litellm-proxy: Claude Code routed through local LiteLLM proxy" >&2
	else
		# If we started the gateway, stop it so it can't keep restarting LiteLLM
		# headless (a later session would otherwise spawn a second gateway on the
		# same port). Drop the lock for that retry; fall back to the upstream.
		[ -n "$_litellm_pid" ] && kill "$_litellm_pid" 2>/dev/null
		rmdir "$_LITELLM_LOCK" 2>/dev/null || true
		echo "litellm-proxy: WARNING — proxy not ready; using upstream directly" >&2
		tail -n 20 "$_LITELLM_LOG" >&2 2>/dev/null || true
	fi
fi

# An SSH login shell sources this, so drop helpers/scratch vars; keep the exports.
unset -f _litellm_custom_upstream _litellm_ready _litellm_start _litellm_wait_ready 2>/dev/null || true
unset _LITELLM_BASE _LITELLM_LOG _LITELLM_LOCK _LITELLM_ENV_FILE _LITELLM_CA_BUNDLE _litellm_pid _i 2>/dev/null || true
