#!/bin/sh
set -- -c 'model_provider="openai-platform"'
if [ -n "$OPENAI_BASE_URL" ]; then
  set -- "$@" -c "model_providers.openai-platform.base_url=\"$OPENAI_BASE_URL\""
fi
if [ -n "$OPENAI_MODEL" ]; then
  set -- "$@" -c "model=\"$OPENAI_MODEL\""
fi
exec codex-acp "$@"
