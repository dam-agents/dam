#!/bin/sh
# Model, mode and cost pins ride the settings file the ACP surface also reads;
# tenant scoping has no settings key, so it stays a flag here.
node /app/bob-settings.mjs

set --
[ -n "$BOB_INSTANCE_ID" ] && set -- "$@" --instance-id "$BOB_INSTANCE_ID"
[ -n "$BOB_TEAM_ID" ]     && set -- "$@" --team-id     "$BOB_TEAM_ID"
# Each terminal open starts a fresh TUI task; Bob's task index can't map onto
# $HARNESS_SESSION_ID. Users can resume prior tasks with `bob -r`.
exec bob chat --trust --accept-license --auto-approve "$@"
