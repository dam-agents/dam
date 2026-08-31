ARG BASE_IMAGE=platform-base
FROM ${BASE_IMAGE}

USER 65532

# harness tool pins ride the image as system-level mise config so they always
# match the installs baked in below (a pin seeded into the persistent workspace
# would go stale on template upgrade); install by name — a bare `mise install`
# would also preinstall every lazy tool from the base image's /etc/mise/config.toml
COPY --chown=65532:0 harness-tools.toml /etc/mise/conf.d/harness-tools.toml
RUN --mount=type=cache,target=/tmp/npm-cache,uid=65532 \
    --mount=type=cache,target=/tmp/mise-cache,uid=65532 \
    npm_config_cache=/tmp/npm-cache MISE_CACHE_DIR=/tmp/mise-cache \
    mise install "npm:@earendil-works/pi-coding-agent" "npm:pi-acp" "npm:@zhafron/pi-memory"

COPY --chmod=0755 harness-chat.sh /usr/local/bin/harness-chat
COPY --chmod=0755 harness-terminal.sh /usr/local/bin/harness-terminal
RUN ln -s /etc/AGENTS.md /app/working-dir/AGENTS.md &&\
mkdir -p /app/working-dir/.pi/agent &&\
ln -s ../../.agents/skills /app/working-dir/.pi/agent/skills

COPY --chown=65532:0 workspace/ /app/working-dir/

# Override platform-base's manifest to add the Pi-specific harnessConfig block.
COPY --chown=65532:0 runtime-manifest.yaml /app/runtime-manifest.yaml

ENV PI_SKIP_VERSION_CHECK=1
