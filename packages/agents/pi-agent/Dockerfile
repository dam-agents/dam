ARG BASE_IMAGE=platform-base
FROM ${BASE_IMAGE}

USER root


# Pi harness — versions pinned so rebuilds are reproducible. Bump deliberately
# and keep the @earendil-works/pi-coding-agent version in sync with the
# pi-dynamic-providers extension's devDependency
# (workspace/.pi/agent/extensions/pi-dynamic-providers/package.json) so the
# extension type-checks against the same fork it actually loads against.
ARG PI_CODING_AGENT_VERSION=0.75.5
ARG PI_ACP_VERSION=0.0.27
ARG PI_MEMORY_VERSION=1.0.2
RUN --mount=type=cache,target=/root/.npm \
    npm install -g \
      "@earendil-works/pi-coding-agent@${PI_CODING_AGENT_VERSION}" \
      "pi-acp@${PI_ACP_VERSION}" \
      "@zhafron/pi-memory@${PI_MEMORY_VERSION}" \
    && mise reshim \
    && chown -R 65532:0 /app

COPY harness-chat.sh /usr/local/bin/harness-chat
COPY harness-terminal.sh /usr/local/bin/harness-terminal
RUN chmod +x /usr/local/bin/harness-chat /usr/local/bin/harness-terminal

# pi picks up AGENTS.md from every parent of its working directory
# ($HOME/work), so a link in $HOME surfaces the system-level instructions.
# It must live in the working-dir seed: $HOME is a PV that would shadow a
# symlink baked directly into /home/agent.
RUN ln -s /etc/AGENTS.md /app/working-dir/AGENTS.md

# pi reads skills from $HOME/.pi/agent/skills; symlink onto the
# cross-harness store at $HOME/.agents/skills so installs land once.
RUN mkdir -p /app/working-dir/.pi/agent \
    && ln -s ../../.agents/skills /app/working-dir/.pi/agent/skills

COPY --chown=65532:0 workspace/ /app/working-dir/

USER 65532
