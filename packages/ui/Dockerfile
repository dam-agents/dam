FROM registry.access.redhat.com/hi/nodejs:24-builder AS builder

USER root

COPY --chmod=755 scripts/install-pnpm.js /usr/local/bin/install-pnpm
COPY package.json ./
RUN install-pnpm

COPY pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/dev-config/package.json packages/dev-config/
COPY packages/ui/package.json packages/ui/
COPY packages/api-server-api/package.json packages/api-server-api/
COPY packages/agent-runtime-api/package.json packages/agent-runtime-api/

RUN --mount=type=cache,id=pnpm-store,target=/pnpm-store \
    PNPM_STORE_DIR=/pnpm-store pnpm install --frozen-lockfile --filter platform-ui...

COPY packages/dev-config/ packages/dev-config/
COPY packages/api-server-api/ packages/api-server-api/
COPY packages/agent-runtime-api/ packages/agent-runtime-api/
COPY packages/ui/ packages/ui/

RUN pnpm --filter platform-ui exec sh -c 'tsc && vite build'

FROM registry.access.redhat.com/hi/nginx:1.30 AS runner

COPY packages/ui/default.conf /etc/nginx/conf.d/default.conf

COPY --from=builder /app/packages/ui/dist /usr/share/nginx/html

EXPOSE 8080
