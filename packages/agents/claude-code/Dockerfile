ARG BASE_IMAGE=platform-base
FROM ${BASE_IMAGE}

USER root

# harness tools from the workspace-seeded user-level mise config
COPY workspace/.config/mise/ /app/working-dir/.config/mise/
# run postinstall manually: mise's npm backend skips it, claude needs its native binary
RUN --mount=type=cache,target=/root/.npm \
    export MISE_GLOBAL_CONFIG_FILE=/app/working-dir/.config/mise/config.toml &&\
    mise install &&\
    node "$(mise where npm:@anthropic-ai/claude-code)/lib/node_modules/@anthropic-ai/claude-code/install.cjs" &&\
    chown -R 65532:0 /app

COPY model-gateway.mjs /usr/local/lib/model-gateway.mjs
COPY model-gateway.sh /usr/local/lib/model-gateway.sh
COPY --chmod=0755 pod-service.sh /usr/local/bin/pod-service
COPY model-gateway-login.sh /etc/profile.d/model-gateway.sh
COPY --chmod=0755 harness-chat.sh /usr/local/bin/harness-chat
COPY --chmod=0755 harness-terminal.sh /usr/local/bin/harness-terminal

# empty managed-settings stub: legacy allowedMcpServers shape breaks Claude Code 2.x startup
RUN ln -s ../.agents/skills /app/working-dir/.claude/skills &&\
    mkdir -p /etc/claude-code &&\
    echo '{}' > /etc/claude-code/managed-settings.json &&\
    ln -s /etc/AGENTS.md /etc/claude-code/CLAUDE.md

COPY --chown=65532:0 workspace/ /app/working-dir/

USER 65532
