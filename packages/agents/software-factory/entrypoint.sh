#!/bin/sh
set -e

export NO_PROXY="127.0.0.1,localhost,${NO_PROXY}"
export no_proxy="127.0.0.1,localhost,${no_proxy}"

redis-server --daemonize yes --bind 127.0.0.1 --port 6379 --save "" --appendonly no

for _ in $(seq 1 50); do
  if redis-cli -p 6379 PING >/dev/null 2>&1; then break; fi
  sleep 0.1
done

node /app/mcp-server/dist/index.js &

for _ in $(seq 1 50); do
  if curl -fsS --noproxy '*' http://127.0.0.1:7777/healthz >/dev/null 2>&1; then break; fi
  sleep 0.1
done

exec node /app/dist/server.js
