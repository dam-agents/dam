ARG BASE_IMAGE=platform-base
FROM ${BASE_IMAGE}

USER root

COPY package.json package-lock.json /opt/codex/
RUN --mount=type=cache,target=/root/.npm \
    cd /opt/codex && npm ci \
    && chown -R 65532:0 /app

COPY harness-chat.sh /usr/local/bin/harness-chat
COPY harness-terminal.sh /usr/local/bin/harness-terminal
RUN chmod +x /usr/local/bin/harness-chat /usr/local/bin/harness-terminal

# System-level Codex config: never-approve/full-access (the pod is the
# sandbox) and developer_instructions pointing at the shared /etc/AGENTS.md.
COPY system-config.toml /etc/codex/config.toml

COPY --chown=65532:0 workspace/ /app/working-dir/

# Codex needs OPENAI_API_KEY to be present; the real credential is injected
# by the Envoy sidecar on the wire. This placeholder satisfies the CLI's
# startup check.
ENV OPENAI_API_KEY=dummy-placeholder
ENV PATH="/opt/codex/node_modules/.bin:$PATH"

USER 65532
