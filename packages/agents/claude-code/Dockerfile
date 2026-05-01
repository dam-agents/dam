ARG BASE_IMAGE=humr-base
FROM ${BASE_IMAGE}

RUN apt-get update \
    && apt-get install -y --no-install-recommends tmux \
    && rm -rf /var/lib/apt/lists/*

# Claude Code harness
RUN cd /app && npm install @agentclientprotocol/claude-agent-acp @anthropic-ai/claude-agent-sdk \
    && npm install -g @anthropic-ai/claude-code

COPY workspace/ /app/working-dir/
