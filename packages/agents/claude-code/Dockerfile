ARG BASE_IMAGE=platform-base
FROM ${BASE_IMAGE}

USER root

RUN --mount=type=cache,target=/root/.npm \
    npm install @agentclientprotocol/claude-agent-acp \
    && npm install -g @anthropic-ai/claude-code \
    && chown -R 65532:0 /app

COPY --chown=65532:0 workspace/ /app/working-dir/

USER 65532
