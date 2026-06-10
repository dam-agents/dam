#!/bin/sh
# Gateway re-point (no-op without a custom upstream); the helper writes to
# stderr only — stdout carries the ACP JSON stream.
. /usr/local/lib/model-gateway.sh
exec node /app/dist/agent.js "$@"
