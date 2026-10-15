# Sourced by harness-chat, harness-terminal and the login profile: point Claude
# Code at the Model Router for every provider but Bedrock; see
# docs/architecture/harness-config.md. Provider env never reaches the harness,
# so PLATFORM_MODEL_ROUTER_SERVES is what switches Claude Code to the router.
_ROUTER_BASE="http://127.0.0.1:${PLATFORM_MODEL_ROUTER_PORT:-24180}"
_ROUTED="${PLATFORM_MODEL_ROUTER_SERVES:-}"
case "${ANTHROPIC_BASE_URL:-}" in
"" | http://127.0.0.1:* | http://localhost:*) ;;
*) _ROUTED=1 ;;
esac

# A process the runtime marked as routed never reaches Bedrock, whatever else
# its env carries.
if [ -z "${PLATFORM_MODEL_ROUTER_SERVES:-}" ] && [ -n "${AWS_BEARER_TOKEN_BEDROCK:-}" ]; then
	export CLAUDE_CODE_USE_BEDROCK=1
	if [ -n "${AWS_BEDROCK_MODEL:-}" ] && [ -z "${ANTHROPIC_DEFAULT_MODEL:-}" ]; then
		export ANTHROPIC_DEFAULT_MODEL="$AWS_BEDROCK_MODEL"
	fi
else
	case "$_ROUTED" in
	"") ;;
	*)
		export ANTHROPIC_BASE_URL="$_ROUTER_BASE"
		export NO_PROXY="127.0.0.1,localhost,::1${NO_PROXY:+,$NO_PROXY}"
		export no_proxy="127.0.0.1,localhost,::1${no_proxy:+,$no_proxy}"
		export CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY=1
		# The router renders the catalog and resolves bare names per harness.
		export ANTHROPIC_CUSTOM_HEADERS="X-Platform-Harness: claude-code${ANTHROPIC_CUSTOM_HEADERS:+
$ANTHROPIC_CUSTOM_HEADERS}"
		# A provider's own pin must not outrank the model the runtime sends
		# over ACP.
		unset ANTHROPIC_MODEL
		# The router drops the client's credential, but Claude Code will not
		# start without one.
		if [ -z "${ANTHROPIC_API_KEY:-}${ANTHROPIC_AUTH_TOKEN:-}" ]; then
			export ANTHROPIC_AUTH_TOKEN="platform:conn:router"
		fi
		;;
	esac
fi

# Forced, so neither an Agent tool call's model argument nor an agent
# definition's model outranks the session's subagent model.
if [ -n "${CLAUDE_CODE_SUBAGENT_MODEL:-}" ]; then
	export CLAUDE_CODE_SUBAGENT_MODEL_FORCE=1
fi

unset _ROUTER_BASE _ROUTED

# Workloads extend the router environment here.
for _hook in /usr/local/lib/model-gateway.d/*.sh; do [ -r "$_hook" ] && . "$_hook"; done
unset _hook
