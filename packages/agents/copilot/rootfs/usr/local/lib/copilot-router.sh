# Sourced by the launch scripts: points Copilot's BYOK provider at the Model
# Router on the pod's loopback. Copilot speaks one wire API per process, so it
# runs on the providers that serve Chat Completions.
# The app the image unpacked at build time, so no start unpacks it into $HOME.
dist="$(dirname "$(readlink -f "$(command -v copilot)")")/dist"
[ ! -d "$dist" ] || { COPILOT_CLI_DIST_DIR="$dist"; export COPILOT_CLI_DIST_DIR; }
unset dist
COPILOT_PROVIDER_BASE_URL="${PLATFORM_MODEL_ROUTER_URL:-http://127.0.0.1:24180}/v1"
COPILOT_PROVIDER_TYPE=openai
COPILOT_PROVIDER_WIRE_API=completions
: "${COPILOT_PROVIDER_API_KEY:=dummy-placeholder}"
# BYOK refuses to start without a model: the session's, else the router's
# default the runtime names, else one the router refuses with its reason.
COPILOT_MODEL="${PLATFORM_MODEL:-${COPILOT_MODEL:-platform-no-model}}"
COPILOT_PROVIDER_HEADERS="X-Platform-Harness: copilot"
# Only a terminal sets HARNESS_SESSION_ID; a chat process serves many sessions.
[ -z "${HARNESS_SESSION_ID:-}" ] || COPILOT_PROVIDER_HEADERS="$COPILOT_PROVIDER_HEADERS
X-Platform-Session: $HARNESS_SESSION_ID"
# "true" also trusts the working directory; the pod is the boundary, and
# nobody answers a permission prompt on a schedule or channel turn.
COPILOT_ALLOW_ALL=true
export COPILOT_PROVIDER_BASE_URL COPILOT_PROVIDER_TYPE COPILOT_PROVIDER_WIRE_API \
  COPILOT_PROVIDER_API_KEY COPILOT_MODEL COPILOT_PROVIDER_HEADERS COPILOT_ALLOW_ALL
