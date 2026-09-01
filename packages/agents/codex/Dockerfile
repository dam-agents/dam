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
    mise install "npm:@openai/codex" "npm:@zed-industries/codex-acp"

COPY --chmod=0755 harness-chat.sh /usr/local/bin/harness-chat
COPY --chmod=0755 harness-terminal.sh /usr/local/bin/harness-terminal
COPY --chown=65532:0 system-config.toml /etc/codex/config.toml
COPY --chown=65532:0 workspace/ /app/working-dir/

# placeholder satisfies the CLI startup check; real credential injected on the wire
ENV OPENAI_API_KEY=dummy-placeholder
