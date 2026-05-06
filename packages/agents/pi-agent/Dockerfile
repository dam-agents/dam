ARG BASE_IMAGE=platform-base
FROM ${BASE_IMAGE}

USER root

# Pi harness
RUN npm install -g @mariozechner/pi-coding-agent pi-acp @zhafron/pi-memory \
    && chown -R 65532:0 /app

ENV AGENT_COMMAND=pi-acp

COPY --chown=65532:0 workspace/ /app/working-dir/

USER 65532
