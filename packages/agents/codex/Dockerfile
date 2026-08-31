ARG BASE_IMAGE=platform-base
FROM ${BASE_IMAGE}

USER root

# harness tool pins ride the image as system-level mise config so they always
# match the installs baked in below (a pin seeded into the persistent workspace
# would go stale on template upgrade); install by name — a bare `mise install`
# would also preinstall every lazy tool from the base image's /etc/mise/config.toml
COPY --chown=65532:0 harness-tools.toml /etc/mise/conf.d/harness-tools.toml
# Installed as the agent user rather than by root with a chown after: mise
# writes the install dirs and the lockfile owned by the runtime user from the
# start, so a newly pinned tool cannot be left out of a chown list. Everything
# it writes to — /etc/mise and MISE_DATA_DIR — is agent-owned in the base image.
USER 65532
RUN --mount=type=cache,target=/tmp/npm-cache,uid=65532 \
    --mount=type=cache,target=/tmp/mise-cache,uid=65532 \
    npm_config_cache=/tmp/npm-cache MISE_CACHE_DIR=/tmp/mise-cache \
    mise install "npm:@openai/codex" "npm:@zed-industries/codex-acp"
USER root

COPY harness-chat.sh /usr/local/bin/harness-chat
COPY harness-terminal.sh /usr/local/bin/harness-terminal
RUN chmod +x /usr/local/bin/harness-chat /usr/local/bin/harness-terminal
COPY --chown=65532:0 system-config.toml /etc/codex/config.toml
COPY --chown=65532:0 workspace/ /app/working-dir/

# placeholder satisfies the CLI startup check; real credential injected on the wire
ENV OPENAI_API_KEY=dummy-placeholder

USER 65532
