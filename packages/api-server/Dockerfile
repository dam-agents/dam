FROM registry.access.redhat.com/hi/nodejs:24-builder AS builder

USER root

COPY --chmod=755 scripts/install-pnpm.js /usr/local/bin/install-pnpm
COPY package.json ./
RUN install-pnpm

COPY pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/dev-config/package.json packages/dev-config/
COPY packages/api-server/package.json packages/api-server/
COPY packages/api-server-api/package.json packages/api-server-api/
COPY packages/agent-runtime-api/package.json packages/agent-runtime-api/
COPY packages/e2e/agents/mock-api/package.json packages/e2e/agents/mock-api/
COPY packages/db/package.json packages/db/

RUN --mount=type=cache,id=pnpm-store,target=/pnpm-store \
    PNPM_STORE_DIR=/pnpm-store pnpm install --frozen-lockfile --filter api-server...

COPY packages/dev-config/ packages/dev-config/
COPY packages/api-server-api/ packages/api-server-api/
COPY packages/agent-runtime-api/ packages/agent-runtime-api/
COPY packages/e2e/agents/mock-api/ packages/e2e/agents/mock-api/
COPY packages/api-server/ packages/api-server/
COPY packages/db/ packages/db/

RUN pnpm --filter api-server exec tsup \
    && pnpm --filter api-server --prod --legacy deploy /prod

FROM registry.access.redhat.com/hi/nodejs:24 AS runner

USER root
ARG NPM_VERSION=11.16.0
RUN npm install -g "npm@${NPM_VERSION}" && rm -rf /usr/lib/node_modules_24/npm
USER 65532

COPY --from=builder --chown=65532:0 /prod /app
COPY --from=builder --chown=65532:0 /app/packages/db/drizzle /app/packages/db/drizzle

EXPOSE 4000

CMD ["node", "dist/index.js"]
