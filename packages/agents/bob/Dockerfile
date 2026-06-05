ARG BASE_IMAGE=platform-base
FROM ${BASE_IMAGE}


USER root

# Bob installer — bobshell isn't on npmjs.org; bob.ibm.com is the
# official distribution channel. `--pm npm` skips pnpm/yarn detection.
RUN --mount=type=cache,target=/root/.npm \
    curl -fsSL https://bob.ibm.com/download/bobshell.sh \
    | bash -s -- --pm npm \
    && chown -R 65532:0 /app

# os.userInfo() needs a /etc/passwd entry for uid 65532 — distroless
# base has none and bob crashes during initializeStorage().
RUN echo 'agent:x:65532:0:Agent User:/home/agent:/sbin/nologin' >> /etc/passwd

COPY bob-acp-shim.mjs /app/bob-acp-shim.mjs
COPY harness-chat.sh /usr/local/bin/harness-chat
COPY harness-terminal.sh /usr/local/bin/harness-terminal
RUN chmod +x /usr/local/bin/harness-chat /usr/local/bin/harness-terminal

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
