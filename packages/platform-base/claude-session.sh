#!/bin/sh
# Resume an existing claude session if its log exists, otherwise create one
# under the supplied id. Bridges the gap between `--session-id` (create-only,
# fails if the log already exists) and `--resume` (resume-only, fails if it
# doesn't). Used by the platform terminal mode so the same session id can be
# shared with the chat-mode SDK without conflicts.
SID=$1
shift
if find "$HOME/.claude/projects" -name "$SID.jsonl" -type f -print -quit 2>/dev/null | grep -q .; then
  exec claude --resume "$SID" "$@"
else
  exec claude --session-id "$SID" "$@"
fi
