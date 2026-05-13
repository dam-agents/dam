#!/bin/sh
# Bob's ACP doesn't support loadSession, so $HARNESS_SESSION_ID can't
# resume — every session/new spawns a fresh bob.
#
# Run on Node 24 (see Dockerfile); PATH override catches the `bob`
# child the shim spawns via child_process.spawn.
#
# Tenant scoping / budget cap / chat mode are CLI-only, so translate
# the platform env vars into flags here.
export PATH="/opt/node24/bin:$PATH"
set --
[ -n "$BOB_INSTANCE_ID" ] && set -- "$@" --instance-id "$BOB_INSTANCE_ID"
[ -n "$BOB_TEAM_ID" ]     && set -- "$@" --team-id     "$BOB_TEAM_ID"
[ -n "$BOB_MAX_COINS" ]   && set -- "$@" --max-coins   "$BOB_MAX_COINS"
[ -n "$BOB_CHAT_MODE" ]   && set -- "$@" --chat-mode   "$BOB_CHAT_MODE"
exec /opt/node24/bin/node /app/bob-acp-shim.mjs "$@"
