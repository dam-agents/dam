ARG BASE_IMAGE=platform-base
FROM registry.access.redhat.com/hi/nodejs:24-builder AS builder

USER root
ENV PATH="/app/node_modules/.bin:$PATH"

COPY --chmod=755 scripts/install-pnpm.js /usr/local/bin/install-pnpm
COPY package.json ./
RUN install-pnpm

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
