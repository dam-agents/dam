# Nous override of the claude-code model-gateway shim (the base is renamed to
# model-gateway-base.sh at build time). The base repoints ANTHROPIC_BASE_URL at
# the in-pod gateway when a custom upstream is fronted; we route OpenAI-format
# traffic (Nous's gate summaries) through it too, so OPENAI_BASE_URL matches and
# the summaries don't fail against the raw LiteLLM URL (intercept-CA TLS + a
# model-id 403). Sourced by harness-chat, harness-terminal, and the SSH login
# profile, so the whole shell env — and everything it spawns — is fixed.
. /usr/local/lib/model-gateway-base.sh

case "${ANTHROPIC_BASE_URL:-}" in
http://127.0.0.1:* | http://localhost:*)
	case "${OPENAI_BASE_URL:-}" in
	"" | *litellm*) export OPENAI_BASE_URL="$ANTHROPIC_BASE_URL" ;;
	esac
	;;
esac
