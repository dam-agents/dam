#!/bin/sh
# TUI is interactive — auto_edit lets Bob prompt the user for risky tools
# in the terminal itself (yolo would auto-approve everything, no prompts).
#
# BOBSHELL_NO_RELAUNCH=true: bob re-execs itself with stdio:"inherit"
# at startup, which breaks the TTY chain in node-pty (relaunched
# child sees isTTY=false → "No input provided via stdin" → exits).
#
# Session resume isn't wired up — bob's TUI keys sessions by a
# project-scoped index, not by UUID, so $HARNESS_SESSION_ID can't
# map. Each terminal open starts fresh; use --list-sessions inside.
#
# Tenant / budget / chat-mode flags translated from platform env.
export BOBSHELL_NO_RELAUNCH=true
set --
[ -n "$BOB_INSTANCE_ID" ] && set -- "$@" --instance-id "$BOB_INSTANCE_ID"
[ -n "$BOB_TEAM_ID" ]     && set -- "$@" --team-id     "$BOB_TEAM_ID"
[ -n "$BOB_MAX_COINS" ]   && set -- "$@" --max-coins   "$BOB_MAX_COINS"
[ -n "$BOB_CHAT_MODE" ]   && set -- "$@" --chat-mode   "$BOB_CHAT_MODE"
exec node /usr/local/lib/node_modules/bobshell/bundle/bob.js --approval-mode=auto_edit --auth-method api-key "$@"
