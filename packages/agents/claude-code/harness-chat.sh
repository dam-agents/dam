#!/bin/sh
. /usr/local/lib/model-gateway.sh
exec node /app/dist/agent.js "$@"
