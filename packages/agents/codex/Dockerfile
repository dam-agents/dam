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
RUN chmod +x /usr/local/bin/harness-chat /usr/local/bin/harness-terminal
COPY --chown=65532:0 system-config.toml /etc/codex/config.toml
COPY --chown=65532:0 workspace/ /app/working-dir/

# placeholder satisfies the CLI startup check; real credential injected on the wire
ENV OPENAI_API_KEY=dummy-placeholder

USER 65532
