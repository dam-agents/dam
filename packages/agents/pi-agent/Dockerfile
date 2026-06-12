ARG BASE_IMAGE=platform-base
FROM ${BASE_IMAGE}

USER root

ARG PI_CODING_AGENT_VERSION=0.75.5
ARG PI_ACP_VERSION=0.0.27
ARG PI_MEMORY_VERSION=1.0.2
RUN --mount=type=cache,target=/root/.npm \
    npm install -g \
      "@earendil-works/pi-coding-agent@${PI_CODING_AGENT_VERSION}" \
      "pi-acp@${PI_ACP_VERSION}" \
      "@zhafron/pi-memory@${PI_MEMORY_VERSION}" &&\
      mise reshim &&\
      chown -R 65532:0 /app

COPY harness-chat.sh /usr/local/bin/harness-chat
COPY harness-terminal.sh /usr/local/bin/harness-terminal
RUN chmod +x /usr/local/bin/harness-chat /usr/local/bin/harness-terminal &&\
ln -s /etc/AGENTS.md /app/working-dir/AGENTS.md &&\
mkdir -p /app/working-dir/.pi/agent &&\
ln -s ../../.agents/skills /app/working-dir/.pi/agent/skills

COPY --chown=65532:0 workspace/ /app/working-dir/

USER 65532
