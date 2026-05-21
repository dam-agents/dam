FROM registry.access.redhat.com/hi/nodejs:22-builder AS builder

USER root

COPY scripts/install-pnpm.sh /usr/local/bin/install-pnpm
COPY package.json ./
RUN install-pnpm

COPY pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/dev-config/package.json packages/dev-config/
COPY packages/api-server/package.json packages/api-server/
COPY packages/api-server-api/package.json packages/api-server-api/
COPY packages/agent-runtime-api/package.json packages/agent-runtime-api/
COPY packages/db/package.json packages/db/

RUN --mount=type=cache,id=pnpm-store,target=/pnpm-store \
    PNPM_STORE_DIR=/pnpm-store pnpm install --frozen-lockfile --filter api-server...

COPY packages/dev-config/ packages/dev-config/
COPY packages/api-server-api/ packages/api-server-api/
COPY packages/agent-runtime-api/ packages/agent-runtime-api/
COPY packages/api-server/ packages/api-server/
COPY packages/db/ packages/db/

RUN pnpm --filter api-server build \
    && pnpm --filter api-server --prod --legacy deploy /prod

FROM registry.access.redhat.com/hi/nodejs:22 AS runner

COPY --from=builder --chown=65532:0 /prod /app
COPY --from=builder --chown=65532:0 /app/packages/db/drizzle /app/packages/db/drizzle

EXPOSE 4000

CMD ["node", "dist/index.js"]
