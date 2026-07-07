_GATEWAY_BASE="http://127.0.0.1:24180"

_gateway_custom_upstream() {
	case "${ANTHROPIC_BASE_URL:-}" in
	"" | http://127.0.0.1:* | http://localhost:*) return 1 ;;
	*) return 0 ;;
	esac
}

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
	# A custom (non-Anthropic) upstream means Claude's built-in WebSearch/WebFetch
	# — Anthropic server-side tools — won't work. The cc-websearch managed hooks
	# read this marker to deny them and route to the DDG-backed replacement skills
	# (#1087); on genuine Anthropic backends it stays unset and the built-ins work.
	# Set before the readiness wait so it holds on the gateway-not-ready path too.
	export PLATFORM_CUSTOM_BACKEND=1
	if _gateway_wait_env; then
		export ANTHROPIC_BASE_URL="$_GATEWAY_BASE"
		export NO_PROXY="127.0.0.1,localhost,::1${NO_PROXY:+,$NO_PROXY}"
		export no_proxy="127.0.0.1,localhost,::1${no_proxy:+,$no_proxy}"
		export CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY=1
		eval "$_gateway_env"
		if [ -z "$_gateway_env" ]; then
			echo "model-gateway: WARNING — gateway up but no models discovered yet (upstream unreachable or rejecting credentials; diagnostics: pod logs, [pod-service] lines)" >&2
		fi
	else
		echo "model-gateway: WARNING — gateway not ready; using upstream directly (diagnostics: pod logs, [pod-service] lines)" >&2
	fi
fi

unset -f _gateway_custom_upstream _gateway_wait_env 2>/dev/null || true
unset _GATEWAY_BASE _gateway_env _i 2>/dev/null || true
