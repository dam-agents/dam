ARG BASE_IMAGE=platform-base
FROM ${BASE_IMAGE}

USER root

ARG CLAUDE_CODE_VERSION=2.1.173
ARG CLAUDE_AGENT_ACP_VERSION=0.44.0
RUN --mount=type=cache,target=/root/.npm \
    npm install "@agentclientprotocol/claude-agent-acp@${CLAUDE_AGENT_ACP_VERSION}" \
    && npm install -g "@anthropic-ai/claude-code@${CLAUDE_CODE_VERSION}" \
    && chown -R 65532:0 /app

COPY model-gateway.mjs /usr/local/lib/model-gateway.mjs
COPY model-gateway.sh /usr/local/lib/model-gateway.sh
COPY --chmod=0755 pod-service.sh /usr/local/bin/pod-service
COPY model-gateway-login.sh /etc/profile.d/model-gateway.sh
COPY --chmod=0755 harness-chat.sh /usr/local/bin/harness-chat
COPY --chmod=0755 harness-terminal.sh /usr/local/bin/harness-terminal

RUN ln -s ../.agents/skills /app/working-dir/.claude/skills

COPY --chown=65532:0 workspace/ /app/working-dir/

USER 65532
