#!/bin/sh
set -- --dangerously-bypass-approvals-and-sandbox -c 'model_provider="openai-platform"'
if [ -n "$OPENAI_BASE_URL" ]; then
  set -- "$@" -c "model_providers.openai-platform.base_url=\"$OPENAI_BASE_URL\""
fi
if [ -n "$OPENAI_MODEL" ]; then
  set -- "$@" -c "model=\"$OPENAI_MODEL\""
fi
if [ -n "$CODEX_WIRE_API" ]; then
  set -- "$@" -c "model_providers.openai-platform.wire_api=\"$CODEX_WIRE_API\""
fi
if [ -n "$CODEX_CONTEXT_WINDOW" ]; then
  set -- "$@" -c "model_context_window=$CODEX_CONTEXT_WINDOW"
fi
if [ -n "$CODEX_MAX_OUTPUT_TOKENS" ]; then
  set -- "$@" -c "model_max_output_tokens=$CODEX_MAX_OUTPUT_TOKENS"
fi

SESSION_MARKER="$HOME/.codex/.session-started"
mkdir -p "$HOME/.codex" >/dev/null 2>&1

if [ -f "$SESSION_MARKER" ]; then
  exec codex resume --last "$@"
else
  touch "$SESSION_MARKER"
  exec codex "$@"
fi
