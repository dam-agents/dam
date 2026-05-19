#!/bin/sh
set -e

export NO_PROXY="127.0.0.1,localhost${NO_PROXY:+,${NO_PROXY}}"
export no_proxy="127.0.0.1,localhost${no_proxy:+,${no_proxy}}"

redis-server --daemonize yes --bind 127.0.0.1 --port 6379 --save "" --appendonly no

i=0
until redis-cli -p 6379 PING >/dev/null 2>&1; do
  i=$((i + 1))
  if [ "$i" -ge 50 ]; then
    echo "redis did not become ready within 5s" >&2
    exit 1
  fi
  sleep 0.1
done

node /app/mcp-server/dist/index.js &

i=0
until curl -fsS --noproxy '*' http://127.0.0.1:7777/healthz >/dev/null 2>&1; do
  i=$((i + 1))
  if [ "$i" -ge 50 ]; then
    echo "mcp server did not become ready within 5s" >&2
    exit 1
  fi
  sleep 0.1
done

# /app/dist/server.js is provided by the platform-base image (agent-runtime).
exec node /app/dist/server.js
