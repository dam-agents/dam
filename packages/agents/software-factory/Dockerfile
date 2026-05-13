ARG BASE_IMAGE=platform-base
FROM ${BASE_IMAGE}

USER root

RUN dnf install -y redis && dnf clean all

RUN npm install @agentclientprotocol/claude-agent-acp @anthropic-ai/claude-agent-sdk \
    && npm install -g @anthropic-ai/claude-code

COPY mcp-server/ /app/mcp-server/
RUN cd /app/mcp-server \
    && npm install \
    && npm run build \
    && npm prune --omit=dev

COPY entrypoint.sh /usr/local/bin/sf-entrypoint.sh
RUN chmod +x /usr/local/bin/sf-entrypoint.sh

COPY --chown=65532:0 workspace/ /app/working-dir/

RUN chown -R 65532:0 /app

USER 65532

CMD ["/usr/local/bin/sf-entrypoint.sh"]
