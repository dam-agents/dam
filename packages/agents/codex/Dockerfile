ARG BASE_IMAGE=platform-base
FROM ${BASE_IMAGE}

USER root

RUN npm install -g @zed-industries/codex-acp @openai/codex \
    && chown -R 65532:0 /app

COPY harness-chat.sh /usr/local/bin/harness-chat
COPY harness-terminal.sh /usr/local/bin/harness-terminal
RUN chmod +x /usr/local/bin/harness-chat /usr/local/bin/harness-terminal

COPY --chown=65532:0 workspace/ /app/working-dir/

# Codex needs OPENAI_API_KEY to be present; the real credential is injected
# by the Envoy sidecar on the wire. This placeholder satisfies the CLI's
# startup check.
ENV OPENAI_API_KEY=dummy-placeholder

USER 65532
