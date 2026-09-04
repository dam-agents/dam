#!/bin/sh
# Model, mode and cost pins ride the settings file the ACP surface also reads;
# tenant scoping has no settings key, so it stays a flag here. Same as the chat
# harness: no posture, no usable tools, so fail rather than warn.
approvals=$(node /app/bob-settings.mjs) || exit 1

set --
[ -n "$BOB_INSTANCE_ID" ] && set -- "$@" --instance-id "$BOB_INSTANCE_ID"
[ -n "$BOB_TEAM_ID" ]     && set -- "$@" --team-id     "$BOB_TEAM_ID"
# "ask" leaves the TUI to prompt in the terminal, which is its own native flow.
[ "$approvals" = "ask" ] || set -- "$@" --auto-approve
# Each terminal open starts a fresh TUI task; Bob's task index can't map onto
# $HARNESS_SESSION_ID. Users can resume prior tasks with `bob -r`.
exec bob chat --trust --accept-license "$@"
