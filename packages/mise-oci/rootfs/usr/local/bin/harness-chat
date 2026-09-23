#!/bin/sh
. /usr/local/lib/model-gateway.sh
node /usr/local/lib/sync-otel-settings.mjs || true
exec claude-agent-acp "$@"
