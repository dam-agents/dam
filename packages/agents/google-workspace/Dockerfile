ARG BASE_IMAGE=platform-base
FROM ${BASE_IMAGE}

# Claude Code harness + Google Workspace CLI
RUN cd /app && npm install @agentclientprotocol/claude-agent-acp @anthropic-ai/claude-agent-sdk \
    && npm install -g @anthropic-ai/claude-code @googleworkspace/cli@0.22.5

COPY workspace/ /app/working-dir/
