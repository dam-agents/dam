ARG BASE_IMAGE=platform-claude-code
FROM ${BASE_IMAGE}

USER root

COPY scripts/install-pnpm.sh /usr/local/bin/install-pnpm
COPY package.json /tmp/install-pnpm/package.json
RUN --mount=type=cache,target=/root/.npm \
    install-pnpm /tmp/install-pnpm/package.json &&\
    rm -rf /tmp/install-pnpm &&\
    mise reshim

RUN printf '%s\n' \
      '' \
      'java = "21"' \
      'maven = "latest"' \
      'helm = "4.2.0"' \
      'kubectl = "latest"' \
      '"aqua:moby/buildkit" = "latest"' \
      >> /app/working-dir/.config/mise/config.toml &&\
    export MISE_GLOBAL_CONFIG_FILE=/app/working-dir/.config/mise/config.toml &&\
    mise install &&\
    mise reshim &&\
    chown -R 65532:0 /app/working-dir/.config

COPY --chmod=0755 packages/agents/dev-agent/dev-bootstrap.sh /usr/local/bin/dev-bootstrap

ENV BUILDKIT_HOST=tcp://192.168.5.2:21234

COPY --chown=65532:0 packages/agents/dev-agent/workspace/ /app/working-dir/

USER 65532
