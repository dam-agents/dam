#!/bin/sh
# claude-code chat shim. Front a custom Anthropic upstream with a local LiteLLM
# proxy (no-op when no custom upstream is set), then start the ACP agent. The
# helper only writes to stderr, so the ACP JSON on stdout stays clean.
. /usr/local/lib/litellm-proxy.sh
exec node /app/dist/agent.js "$@"
