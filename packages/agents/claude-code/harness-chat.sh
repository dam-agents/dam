#!/bin/sh
# claude-code chat shim. Route Claude Code through the local model gateway when
# a custom Anthropic upstream is set (no-op otherwise), then start the ACP
# agent. The helper only writes to stderr, so the ACP JSON on stdout stays
# clean.
. /usr/local/lib/model-gateway.sh
exec node /app/dist/agent.js "$@"
