#!/bin/sh
# Bob's TUI persists sessions in a project-scoped index, not per-session
# files keyed by UUID the way pi-agent and claude-code do — so we can't
# pass $HARNESS_SESSION_ID through. Best we can do is `--resume latest`
# when a session exists, otherwise start fresh. The agent's home (and
# therefore bob's session index) is per-instance (ADR-027 PVC), so
# "latest" always belongs to the current owner. `--list-sessions` lists
# numbered sessions when any exist; falls through to a fresh session
# otherwise so the first terminal open doesn't error out.
#
# Platform env → bob CLI flag translation. Same vars as harness-chat:
# tenant scoping and budget caps live only on the CLI, so we translate
# them here. Bob reads BOB_SHELL_MODEL and friends from env directly,
# so those don't need a flag pass-through.
set --
[ -n "$BOB_INSTANCE_ID" ] && set -- "$@" --instance-id "$BOB_INSTANCE_ID"
[ -n "$BOB_TEAM_ID" ]     && set -- "$@" --team-id     "$BOB_TEAM_ID"
[ -n "$BOB_MAX_COINS" ]   && set -- "$@" --max-coins   "$BOB_MAX_COINS"
[ -n "$BOB_CHAT_MODE" ]   && set -- "$@" --chat-mode   "$BOB_CHAT_MODE"
if bob --list-sessions 2>/dev/null | grep -qE '^[[:space:]]*[0-9]'; then
  exec bob --resume latest "$@"
else
  exec bob "$@"
fi
