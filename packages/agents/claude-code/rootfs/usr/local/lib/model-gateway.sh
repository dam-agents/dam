_GATEWAY_BASE="http://127.0.0.1:24180"

case "${ANTHROPIC_BASE_URL:-}" in
"" | http://127.0.0.1:* | http://localhost:*) ;;
*)
	_i=0
	_gateway_env=""
	_gateway_up=false
	while [ "$_i" -lt 30 ]; do
		_gateway_env=$(curl --noproxy '*' -fsS --max-time 2 \
			"$_GATEWAY_BASE/env.sh" 2>/dev/null) && _gateway_up=true && break
		sleep 1
		_i=$((_i + 1))
	done
	if [ "$_gateway_up" = true ]; then
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
	;;
esac

unset _GATEWAY_BASE _gateway_env _gateway_up _i 2>/dev/null || true

# Workloads extend the gateway environment here.
for _hook in /usr/local/lib/model-gateway.d/*.sh; do [ -r "$_hook" ] && . "$_hook"; done
unset _hook
