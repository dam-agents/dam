#!/bin/sh
# Bob's TUI persists sessions in a project-scoped index, not per-session
# files keyed by UUID the way pi-agent and claude-code do — so we can't
# pass $HARNESS_SESSION_ID through. Best we can do is `--resume latest`
# when a session exists, otherwise start fresh. The agent's home (and
# therefore bob's session index) is per-instance (ADR-027 PVC), so
# "latest" always belongs to the current owner. `--list-sessions` lists
# numbered sessions when any exist; falls through to a fresh session
# otherwise so the first terminal open doesn't error out.
if bob --list-sessions 2>/dev/null | grep -qE '^[[:space:]]*[0-9]'; then
  exec bob --resume latest "$@"
else
  exec bob "$@"
fi
