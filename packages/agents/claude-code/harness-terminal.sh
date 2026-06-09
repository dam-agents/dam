#!/bin/sh
# claude-code terminal shim. Front a custom Anthropic upstream with a local
# LiteLLM proxy (no-op when no custom upstream is set), then start (or resume)
# the CLI. Mirrors the platform-base terminal shim plus the proxy hook.
. /usr/local/lib/litellm-proxy.sh
CLAUDE_OPTS="--permission-mode auto --allow-dangerously-skip-permissions"
if find "$HOME/.claude/projects" -name "$HARNESS_SESSION_ID.jsonl" -type f -print -quit 2>/dev/null | grep -q .; then
  exec claude $CLAUDE_OPTS --resume "$HARNESS_SESSION_ID" "$@"
else
  exec claude $CLAUDE_OPTS --session-id "$HARNESS_SESSION_ID" "$@"
fi
