# Sourced by claude-code's model-gateway.sh: route Nous's OpenAI-format gate
# summaries through the in-pod gateway too.

case "${ANTHROPIC_BASE_URL:-}" in
http://127.0.0.1:* | http://localhost:*)
	case "${OPENAI_BASE_URL:-}" in
	"" | *litellm*) export OPENAI_BASE_URL="$ANTHROPIC_BASE_URL" ;;
	esac
	;;
esac
