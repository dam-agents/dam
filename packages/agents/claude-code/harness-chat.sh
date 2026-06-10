#!/bin/sh
# Front a custom upstream with the local LiteLLM gateway (no-op otherwise), then
# start the ACP agent. The helper writes only to stderr; stdout stays ACP JSON.
. /usr/local/lib/litellm-proxy.sh
exec node /app/dist/agent.js "$@"
