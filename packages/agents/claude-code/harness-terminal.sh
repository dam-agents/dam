#!/bin/sh
. /usr/local/lib/model-gateway.sh
CLAUDE_OPTS="--permission-mode auto --allow-dangerously-skip-permissions"
if find "$HOME/.claude/projects" -name "$HARNESS_SESSION_ID.jsonl" -type f -print -quit 2>/dev/null | grep -q .; then
  exec claude $CLAUDE_OPTS --resume "$HARNESS_SESSION_ID" "$@"
else
  exec claude $CLAUDE_OPTS --session-id "$HARNESS_SESSION_ID" "$@"
fi
