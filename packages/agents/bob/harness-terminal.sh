#!/bin/sh
# Write the platform settings posture (license consent, approval config,
# model) and re-assert the platform instructions link before handing over to
# Bob's TUI.
node /app/bob-acp-shim.mjs --settings-only

# 2.0 merged the code/advanced chat modes into agent; BOB_CHAT_MODE may still
# carry a 1.x value pinned on an existing provider secret.
mode="$BOB_CHAT_MODE"
case "$mode" in code|advanced) mode=agent ;; esac

set --
[ -n "$BOB_INSTANCE_ID" ] && set -- "$@" --instance-id "$BOB_INSTANCE_ID"
[ -n "$BOB_TEAM_ID" ]     && set -- "$@" --team-id     "$BOB_TEAM_ID"
[ -n "$BOB_MAX_COINS" ]   && set -- "$@" --max-cost    "$BOB_MAX_COINS"
[ -n "$mode" ]            && set -- "$@" --mode        "$mode"
# Each terminal open starts a fresh TUI task; Bob's numeric task index can't
# map onto $HARNESS_SESSION_ID. Users can resume prior tasks with `bob -r`.
exec bob chat --accept-license "$@"
