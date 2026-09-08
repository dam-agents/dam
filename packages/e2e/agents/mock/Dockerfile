ARG BASE_IMAGE=platform-base
FROM registry.access.redhat.com/hi/nodejs:24-builder AS builder

USER root
ENV PATH="/app/node_modules/.bin:$PATH"

# pnpm at the version package.json pins, installed by mise from the npm registry
# (the npm backend needs no GitHub API calls on rate-limited runners). Builder
# stage only: the runtime image carries neither mise nor pnpm.
COPY --from=ghcr.io/jdx/mise:2026.9@sha256:812f7860a2fb911e1d5dd3375834abb2a08f8c783a23f783fcbccaf7fc7357aa /usr/local/bin/mise /usr/local/bin/mise
ENV MISE_DATA_DIR=/usr/local/share/mise \
    PATH="/usr/local/share/mise/shims:$PATH"
COPY package.json ./
RUN mise use -g "npm:pnpm@$(node -p "require('./package.json').packageManager.split('@')[1].split('+')[0]")" && mise reshim && pnpm --version

COPY pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/dev-config/package.json packages/dev-config/
COPY packages/e2e/agents/mock/package.json packages/e2e/agents/mock/
COPY packages/e2e/agents/mock-api/package.json packages/e2e/agents/mock-api/

RUN --mount=type=cache,id=pnpm-store,target=/pnpm-store \
    PNPM_STORE_DIR=/pnpm-store pnpm install --frozen-lockfile --filter mock-agent...

COPY packages/dev-config/ packages/dev-config/
COPY packages/e2e/agents/mock-api/ packages/e2e/agents/mock-api/
COPY packages/e2e/agents/mock/ packages/e2e/agents/mock/

RUN pnpm --filter mock-agent exec tsup

FROM ${BASE_IMAGE}

USER root

COPY --from=builder /app/packages/e2e/agents/mock/dist/main.js /app/mock-agent.js

COPY packages/e2e/agents/mock/harness-chat.sh /usr/local/bin/harness-chat
COPY packages/e2e/agents/mock/harness-terminal.sh /usr/local/bin/harness-terminal
RUN chmod +x /usr/local/bin/harness-chat /usr/local/bin/harness-terminal \
    && chown -R 65532:0 /app

USER 65532
