ARG BASE_IMAGE=platform-base
FROM ${BASE_IMAGE}

USER root

# harness tool pins ride the image as system-level mise config so they always
# match the installs baked in below (a pin seeded into the persistent workspace
# would go stale on template upgrade); install by name — a bare `mise install`
# would also preinstall every lazy tool from the base image's /etc/mise/config.toml
COPY harness-tools.toml /etc/mise/conf.d/harness-tools.toml
RUN --mount=type=cache,target=/root/.npm \
    npm_config_cache=/root/.npm \
    mise install "npm:@agentclientprotocol/claude-agent-acp" &&\
    chown -R 65532 /etc/mise \
      "$(dirname "$(mise where npm:@agentclientprotocol/claude-agent-acp)")" &&\
    find /etc/mise -name '*.lock' -exec chmod 644 {} +

# Claude Code phones home (usage telemetry to Statsig, error logs to Datadog
# intake) — traffic the gateway egress chain would surface for approval. The
# explicit flags below turn exactly that off; the umbrella
# CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC is deliberately NOT set — it also
# switches off wanted behavior beyond these constituents. The auto-updater
# loss is intentional since the CLI rides the adapter pin. Platform
# OTEL export is a separate, opt-in path and is unaffected.
ENV DISABLE_TELEMETRY=1 \
    DISABLE_ERROR_REPORTING=1 \
    DISABLE_FEEDBACK_COMMAND=1 \
    DISABLE_FEEDBACK_SURVEY=1 \
    DISABLE_AUTOUPDATER=1

COPY model-gateway.mjs /usr/local/lib/model-gateway.mjs
# Implements the platform's background-work contract from Claude Code's Stop
# hook, so a session that left a job running is not reaped out from under it.
COPY report-background-work.mjs /usr/local/lib/report-background-work.mjs
COPY model-gateway.sh /usr/local/lib/model-gateway.sh
COPY sync-otel-settings.mjs /usr/local/lib/sync-otel-settings.mjs
COPY harness-history-lib.mjs /usr/local/lib/harness-history-lib.mjs
COPY --chmod=0755 pod-service.sh /usr/local/bin/pod-service
COPY model-gateway-login.sh /etc/profile.d/model-gateway.sh
COPY --chmod=0755 harness-chat.sh /usr/local/bin/harness-chat
COPY --chmod=0755 harness-terminal.sh /usr/local/bin/harness-terminal

# managed-settings.json carries the Stop/SubagentStop background-work report;
# keep it otherwise minimal — a legacy allowedMcpServers shape breaks Claude
# Code 2.x startup. Leaving WebSearch/WebFetch undenied is deliberate: Anthropic
# backends serve them natively, and a LiteLLM-fronted proxy keys on the tool
# declaration to run the search itself (proxy-side limitations: #3092). The old
# cc-websearch DDG fallback is intentionally gone, not pending (#1087 revert).
# harness-history-lib.mjs imports the adapter's own replay conversion; the
# symlink pins the resolution to whatever version mise installed above
RUN ln -s "$(mise where npm:@agentclientprotocol/claude-agent-acp)/lib/node_modules/@agentclientprotocol/claude-agent-acp" /usr/local/lib/claude-agent-acp
RUN set -eu; \
    cli="$(echo /usr/local/lib/claude-agent-acp/node_modules/@anthropic-ai/claude-agent-sdk-*/claude)"; \
    test -x "$cli"; \
    ln -s "$cli" /usr/local/bin/claude
ENV CLAUDE_CODE_EXECUTABLE=/usr/local/bin/claude
RUN ln -s ../.agents/skills /app/working-dir/.claude/skills &&\
    mkdir -p /etc/claude-code &&\
    ln -s /etc/AGENTS.md /etc/claude-code/CLAUDE.md
COPY managed-settings.json /etc/claude-code/managed-settings.json

COPY --chown=65532:0 workspace/ /app/working-dir/

# Staged outside /app/working-dir so the first-boot `cp -rn` never seeds it into
# a plain sandbox; an experiment sandbox's Install Command copies it in instead.
COPY --chown=65532:0 dam-skills/ /usr/local/share/dam-skills/

# Override platform-base's manifest to add the Claude-specific harnessConfig block.
COPY --chown=65532:0 runtime-manifest.yaml /app/runtime-manifest.yaml

USER 65532
