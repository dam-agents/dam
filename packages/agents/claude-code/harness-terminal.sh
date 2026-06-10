#!/bin/sh
# claude-code terminal shim. Route Claude Code through the local model gateway
# when a custom Anthropic upstream is set (no-op otherwise), then start (or
# resume) the CLI. Mirrors the platform-base terminal shim plus the gateway
# hook.
. /usr/local/lib/model-gateway.sh
CLAUDE_OPTS="--permission-mode auto --allow-dangerously-skip-permissions"
if find "$HOME/.claude/projects" -name "$HARNESS_SESSION_ID.jsonl" -type f -print -quit 2>/dev/null | grep -q .; then
  exec claude $CLAUDE_OPTS --resume "$HARNESS_SESSION_ID" "$@"
else
  exec claude $CLAUDE_OPTS --session-id "$HARNESS_SESSION_ID" "$@"
fi
