#!/bin/sh
# Bob speaks ACP under `--experimental-acp`, but advertises
# agentCapabilities.loadSession: false — so unlike pi-agent / claude-code
# there's no way for agent-runtime to resume a chat by $HARNESS_SESSION_ID.
# Every `session/new` from the runtime spawns a fresh bob session; the
# shim doesn't try to fake persistence on top.
#
# Platform env → bob CLI flag translation. Bob reads some settings from
# env directly (BOB_SHELL_MODEL, BOBSHELL_HIDE_ENVS, ...), but tenant
# scoping (--instance-id / --team-id), budget caps (--max-coins), and
# chat mode (--chat-mode) are CLI-only. We translate platform-managed
# env vars into flags here so the shim (verbatim from upstream) can
# pass them through unchanged via `process.argv.slice(2)`. Empty/unset
# vars contribute nothing — Bob keeps its built-in defaults.
set --
[ -n "$BOB_INSTANCE_ID" ] && set -- "$@" --instance-id "$BOB_INSTANCE_ID"
[ -n "$BOB_TEAM_ID" ]     && set -- "$@" --team-id     "$BOB_TEAM_ID"
[ -n "$BOB_MAX_COINS" ]   && set -- "$@" --max-coins   "$BOB_MAX_COINS"
[ -n "$BOB_CHAT_MODE" ]   && set -- "$@" --chat-mode   "$BOB_CHAT_MODE"
exec node /app/bob-acp-shim.mjs "$@"
