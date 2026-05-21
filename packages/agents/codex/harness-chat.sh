#!/bin/sh
CODEX_ARGS='-c model_provider="openai-platform"'
if [ -n "$OPENAI_BASE_URL" ]; then
  CODEX_ARGS="$CODEX_ARGS -c model_providers.openai-platform.base_url=\"$OPENAI_BASE_URL\""
fi
if [ -n "$OPENAI_MODEL" ]; then
  CODEX_ARGS="$CODEX_ARGS -c model=\"$OPENAI_MODEL\""
fi
exec codex-acp $CODEX_ARGS "$@"
