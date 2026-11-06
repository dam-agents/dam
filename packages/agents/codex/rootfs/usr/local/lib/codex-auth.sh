if [ "${PLATFORM_CODEX_AUTH_MODE:-}" = chatgpt ]; then
  unset OPENAI_API_KEY CODEX_API_KEY OPENAI_BASE_URL OPENAI_MODEL
  set -- "$@" -c 'model_provider="openai"' -c 'forced_login_method="chatgpt"' \
    -c 'cli_auth_credentials_store="file"' -c 'features.api_key_model_discovery=false'
fi
