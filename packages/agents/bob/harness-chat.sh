#!/bin/sh
# The shim emulates session list/load/resume from Bob's on-disk chats
# (see bob-acp-shim.mjs); $HARNESS_SESSION_ID resume is handled there.
#
# Tenant scoping / budget cap / chat mode are CLI-only, so translate
# the platform env vars into flags here.
set --
[ -n "$BOB_INSTANCE_ID" ] && set -- "$@" --instance-id "$BOB_INSTANCE_ID"
[ -n "$BOB_TEAM_ID" ]     && set -- "$@" --team-id     "$BOB_TEAM_ID"
[ -n "$BOB_MAX_COINS" ]   && set -- "$@" --max-coins   "$BOB_MAX_COINS"
[ -n "$BOB_CHAT_MODE" ]   && set -- "$@" --chat-mode   "$BOB_CHAT_MODE"
exec node /app/bob-acp-shim.mjs "$@"
