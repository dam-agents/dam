#!/bin/sh
# Bob's ACP doesn't support loadSession, so $HARNESS_SESSION_ID can't
# resume — every session/new spawns a fresh bob.
#
# Tenant scoping / budget cap / chat mode are CLI-only, so translate
# the platform env vars into flags here.
set --
[ -n "$BOB_INSTANCE_ID" ] && set -- "$@" --instance-id "$BOB_INSTANCE_ID"
[ -n "$BOB_TEAM_ID" ]     && set -- "$@" --team-id     "$BOB_TEAM_ID"
[ -n "$BOB_MAX_COINS" ]   && set -- "$@" --max-coins   "$BOB_MAX_COINS"
[ -n "$BOB_CHAT_MODE" ]   && set -- "$@" --chat-mode   "$BOB_CHAT_MODE"
exec node /app/bob-acp-shim.mjs "$@"
