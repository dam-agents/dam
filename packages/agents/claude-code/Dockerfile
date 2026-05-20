ARG BASE_IMAGE=platform-base
FROM ${BASE_IMAGE}

USER root

RUN dnf install -y openssh-server openssh-clients && dnf clean all \
    && echo "agent:x:65532:0::/home/agent:/bin/bash" >> /etc/passwd

RUN npm install @agentclientprotocol/claude-agent-acp \
    && npm install -g @anthropic-ai/claude-code \
    && chown -R 65532:0 /app

COPY --chown=65532:0 entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh
COPY --chown=65532:0 workspace/ /app/working-dir/

USER 65532

ENTRYPOINT ["/app/entrypoint.sh"]
CMD ["node", "/app/dist/server.js"]
