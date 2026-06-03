ARG BASE_IMAGE=platform-base
FROM ${BASE_IMAGE}

USER root

# claude-agent-acp pulls @anthropic-ai/sdk transitively; override it to a patched
# release (CVE-2026-41686). Set before install so npm resolves the nested dep to it.
RUN --mount=type=cache,target=/root/.npm \
    npm pkg set "overrides.@anthropic-ai/sdk"=">=0.100.1" \
    && npm install @agentclientprotocol/claude-agent-acp \
    && npm install -g @anthropic-ai/claude-code \
    && chown -R 65532:0 /app

COPY --chown=65532:0 workspace/ /app/working-dir/

USER 65532
