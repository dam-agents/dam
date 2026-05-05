ARG BASE_IMAGE=platform-base
FROM ${BASE_IMAGE}

# Claude Code harness
RUN cd /app && npm install @agentclientprotocol/claude-agent-acp @anthropic-ai/claude-agent-sdk \
    && npm install -g @anthropic-ai/claude-code

COPY workspace/ /app/working-dir/
