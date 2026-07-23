ARG BASE_IMAGE=platform-base
FROM ${BASE_IMAGE}

USER root

# harness tool pins ride the image as system-level mise config so they always
# match the installs baked in below (a pin seeded into the persistent workspace
# would go stale on template upgrade); install by name — a bare `mise install`
# would also preinstall every lazy tool from the base image's /etc/mise/config.toml
COPY harness-tools.toml /etc/mise/conf.d/harness-tools.toml
RUN --mount=type=cache,target=/root/.npm \
    mise install "npm:@openai/codex" "npm:@zed-industries/codex-acp" &&\
    chown -R 65532 /etc/mise \
      "$(dirname "$(mise where npm:@openai/codex)")" \
      "$(dirname "$(mise where npm:@zed-industries/codex-acp)")" &&\
    find /etc/mise -name '*.lock' -exec chmod 644 {} +

COPY harness-chat.sh /usr/local/bin/harness-chat
COPY harness-terminal.sh /usr/local/bin/harness-terminal
RUN chmod +x /usr/local/bin/harness-chat /usr/local/bin/harness-terminal
COPY --chown=65532:0 system-config.toml /etc/codex/config.toml
COPY --chown=65532:0 workspace/ /app/working-dir/

# placeholder satisfies the CLI startup check; real credential injected on the wire
ENV OPENAI_API_KEY=dummy-placeholder

USER 65532
