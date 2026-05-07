#!/bin/sh
if find "$HOME/.claude/projects" -name "$HARNESS_SESSION_ID.jsonl" -type f -print -quit 2>/dev/null | grep -q .; then
  exec claude --resume "$HARNESS_SESSION_ID" "$@"
else
  exec claude --session-id "$HARNESS_SESSION_ID" "$@"
fi
