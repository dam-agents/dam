ARG BASE_IMAGE=platform-base
FROM ${BASE_IMAGE}


USER root

# Bob installer — bobshell isn't on npmjs.org; bob.ibm.com is the
# official distribution channel. `--pm npm` skips pnpm/yarn detection.
RUN --mount=type=cache,target=/root/.npm \
    curl -fsSL https://bob.ibm.com/download/bobshell.sh \
    | bash -s -- --pm npm \
    && chown -R 65532:0 /app

COPY bob-acp-shim.mjs /app/bob-acp-shim.mjs
COPY harness-chat.sh /usr/local/bin/harness-chat
COPY harness-terminal.sh /usr/local/bin/harness-terminal
RUN chmod +x /usr/local/bin/harness-chat /usr/local/bin/harness-terminal

# Bob discovers context files via context.fileName in the system-wide
# defaults; point it at the cross-harness instructions from platform-base.
# Merge rather than overwrite in case the installer seeded other defaults.
RUN mkdir -p /etc/bobshell \
    && [ -f /etc/bobshell/system-defaults.json ] || echo '{}' > /etc/bobshell/system-defaults.json \
    && jq '.context.fileName = ["/etc/AGENTS.md"]' /etc/bobshell/system-defaults.json > /tmp/system-defaults.json \
    && mv /tmp/system-defaults.json /etc/bobshell/system-defaults.json

# bob reads skills from $HOME/.bob/skills; symlink onto the
# cross-harness store at $HOME/.agents/skills so installs land once.
RUN mkdir -p /app/working-dir/.bob \
    && ln -s ../.agents/skills /app/working-dir/.bob/skills

# Bob reads MCP servers from $HOME/.bob/settings.json (ADR-052).
COPY --chown=65532:0 runtime-manifest.yaml /app/runtime-manifest.yaml

COPY --chown=65532:0 workspace/ /app/working-dir/

# Bob's default auth is W3ID SSO — opens a browser that never arrives
# in-pod, then blocks for 3 minutes. Force api-key for every bob exec.
ENV BOBSHELL_DEFAULT_AUTH_TYPE=api-key

USER 65532
