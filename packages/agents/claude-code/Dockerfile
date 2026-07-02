ARG BASE_IMAGE=platform-base
FROM ${BASE_IMAGE}

USER root

# harness tools from the workspace-seeded user-level mise config
COPY workspace/.config/mise/ /app/working-dir/.config/mise/
# run postinstall manually: mise's npm backend skips it, claude needs its native binary
RUN --mount=type=cache,target=/root/.npm \
    export MISE_GLOBAL_CONFIG_FILE=/app/working-dir/.config/mise/config.toml &&\
    mise install &&\
    node "$(mise where npm:@anthropic-ai/claude-code)/lib/node_modules/@anthropic-ai/claude-code/install.cjs" &&\
    chown -R 65532:0 /app

COPY model-gateway.mjs /usr/local/lib/model-gateway.mjs
COPY model-gateway.sh /usr/local/lib/model-gateway.sh
COPY --chmod=0755 pod-service.sh /usr/local/bin/pod-service
COPY model-gateway-login.sh /etc/profile.d/model-gateway.sh
COPY --chmod=0755 harness-chat.sh /usr/local/bin/harness-chat
COPY --chmod=0755 harness-terminal.sh /usr/local/bin/harness-terminal

# cc-websearch (github.com/Djarvur/cc-websearch, MIT) — DuckDuckGo-backed
# WebSearch/WebFetch replacements. The built-in tools depend on an Anthropic
# server-side capability that non-Anthropic model backends don't provide, so
# they fail on this platform's custom backends (#1087). On such backends the
# managed-settings hooks (deny-web-tool.sh, gated on PLATFORM_CUSTOM_BACKEND)
# deny the built-ins and the seeded skills (.agents/skills/{websearch,webfetch})
# invoke these self-contained esbuild bundles instead, which need only `node`.
# Pinned to a commit SHA and checksum-verified.
ARG CC_WEBSEARCH_REF=02d4993492ed0a957e7908bfff61fef245d36583
RUN mkdir -p /opt/cc-websearch &&\
    base="https://raw.githubusercontent.com/Djarvur/cc-websearch/${CC_WEBSEARCH_REF}/skills" &&\
    curl -fsSL "$base/websearch/scripts/websearch.cjs" -o /opt/cc-websearch/websearch.cjs &&\
    curl -fsSL "$base/webfetch/scripts/webfetch.cjs" -o /opt/cc-websearch/webfetch.cjs &&\
    node -e 'const c=require("crypto"),f=require("fs"),d="/opt/cc-websearch/";const want={"websearch.cjs":"3f3054ab1ec65f301152e0567b6415b8c92264a2fb94e9e7d95685911cde058e","webfetch.cjs":"56cc2e9c23e594308ae010e185211313f637f38d633cdcbdd7b2c5e565355054"};for(const[n,h]of Object.entries(want)){const g=c.createHash("sha256").update(f.readFileSync(d+n)).digest("hex");if(g!==h){console.error(`cc-websearch: checksum mismatch for ${n}: got ${g} want ${h}`);process.exit(1);}}console.log("cc-websearch bundles verified");'
COPY --chmod=0755 deny-web-tool.sh /opt/cc-websearch/deny-web-tool.sh

# managed-settings.json carries the WebSearch/WebFetch deny hooks (above); keep
# it otherwise minimal — a legacy allowedMcpServers shape breaks Claude Code 2.x startup.
RUN ln -s ../.agents/skills /app/working-dir/.claude/skills &&\
    mkdir -p /etc/claude-code &&\
    ln -s /etc/AGENTS.md /etc/claude-code/CLAUDE.md
COPY managed-settings.json /etc/claude-code/managed-settings.json

COPY --chown=65532:0 workspace/ /app/working-dir/

# Override platform-base's manifest to add the Claude-specific harnessConfig block.
COPY --chown=65532:0 runtime-manifest.yaml /app/runtime-manifest.yaml

USER 65532
