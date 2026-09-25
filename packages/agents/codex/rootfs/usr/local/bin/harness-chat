#!/bin/sh
set -- -c 'model_provider="openai-platform"'
if [ -n "$OPENAI_BASE_URL" ]; then
  set -- "$@" -c "model_providers.openai-platform.base_url=\"$OPENAI_BASE_URL\""
fi
# the provider's pin yields to a model chosen in config.toml (Config panel, /model, hand-edit)
if [ -n "$OPENAI_MODEL" ] && ! codex-config-sets-model; then
  set -- "$@" -c "model=\"$OPENAI_MODEL\""
fi
exec codex-acp "$@"
