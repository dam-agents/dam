#!/bin/sh
set -- --dangerously-bypass-approvals-and-sandbox -c 'model_provider="openai-platform"'
if [ -n "$OPENAI_BASE_URL" ]; then
  set -- "$@" -c "model_providers.openai-platform.base_url=\"$OPENAI_BASE_URL\""
fi
if [ -n "$OPENAI_MODEL" ]; then
  set -- "$@" -c "model=\"$OPENAI_MODEL\""
fi

# pinned by the SessionStart hook in /etc/codex/requirements.toml
THREAD_FILE="$HOME/.codex/platform-sessions/$HARNESS_SESSION_ID"
if [ -s "$THREAD_FILE" ]; then
  exec codex resume "$(cat "$THREAD_FILE")" "$@"
else
  exec codex "$@"
fi
