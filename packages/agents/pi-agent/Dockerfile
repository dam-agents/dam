ARG BASE_IMAGE=platform-base
FROM ${BASE_IMAGE}

USER root

# harness tools from the workspace-seeded user-level mise config
COPY workspace/.config/mise/ /app/working-dir/.config/mise/
RUN --mount=type=cache,target=/root/.npm \
    MISE_GLOBAL_CONFIG_FILE=/app/working-dir/.config/mise/config.toml mise install &&\
    chown -R 65532:0 /app

COPY harness-chat.sh /usr/local/bin/harness-chat
COPY harness-terminal.sh /usr/local/bin/harness-terminal
RUN chmod +x /usr/local/bin/harness-chat /usr/local/bin/harness-terminal &&\
ln -s /etc/AGENTS.md /app/working-dir/AGENTS.md &&\
mkdir -p /app/working-dir/.pi/agent &&\
ln -s ../../.agents/skills /app/working-dir/.pi/agent/skills

COPY --chown=65532:0 workspace/ /app/working-dir/

USER 65532
