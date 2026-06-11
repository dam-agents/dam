#!/bin/sh
. /usr/local/lib/model-gateway.sh
exec /app/node_modules/.bin/claude-agent-acp "$@"
