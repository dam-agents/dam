#!/bin/sh
CODEX_OPTS='--dangerously-bypass-approvals-and-sandbox -c model_provider="openai-platform"'
if [ -n "$OPENAI_BASE_URL" ]; then
  CODEX_OPTS="$CODEX_OPTS -c model_providers.openai-platform.base_url=\"$OPENAI_BASE_URL\""
fi
if [ -n "$OPENAI_MODEL" ]; then
  CODEX_OPTS="$CODEX_OPTS -c model=\"$OPENAI_MODEL\""
fi

# Codex manages its own session IDs internally (no external --session-id
# flag). Since each agent pod is single-tenant, resume the most recent
# session if one exists; otherwise start fresh.
SESSION_MARKER="$HOME/.codex/.session-started"
mkdir -p "$HOME/.codex" >/dev/null 2>&1

if [ -f "$SESSION_MARKER" ]; then
  exec codex resume --last $CODEX_OPTS "$@"
else
  touch "$SESSION_MARKER"
  exec codex $CODEX_OPTS "$@"
fi
