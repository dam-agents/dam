#!/bin/sh
set -- --dangerously-bypass-approvals-and-sandbox -c 'model_provider="openai-platform"'
if [ -n "$OPENAI_BASE_URL" ]; then
  set -- "$@" -c "model_providers.openai-platform.base_url=\"$OPENAI_BASE_URL\""
fi
if [ -n "$OPENAI_MODEL" ]; then
  set -- "$@" -c "model=\"$OPENAI_MODEL\""
fi

SESSION_MARKER="$HOME/.codex/.session-started"
mkdir -p "$HOME/.codex" >/dev/null 2>&1

if [ -f "$SESSION_MARKER" ]; then
  exec codex resume --last "$@"
else
  touch "$SESSION_MARKER"
  exec codex "$@"
fi
