FROM registry.access.redhat.com/hi/nodejs:22-builder AS builder

USER root

COPY scripts/install-pnpm.sh /usr/local/bin/install-pnpm
COPY package.json ./
RUN install-pnpm

COPY pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json ./
COPY packages/ui/package.json packages/ui/
COPY packages/api-server-api/package.json packages/api-server-api/
COPY packages/agent-runtime-api/package.json packages/agent-runtime-api/

RUN pnpm install --frozen-lockfile --filter platform-ui...

COPY packages/api-server-api/ packages/api-server-api/
COPY packages/agent-runtime-api/ packages/agent-runtime-api/
COPY packages/ui/ packages/ui/

RUN pnpm --filter platform-ui build

FROM registry.access.redhat.com/hi/nginx:1.30 AS runner

COPY packages/ui/default.conf /etc/nginx/conf.d/default.conf

COPY --from=builder /app/packages/ui/dist /usr/share/nginx/html

EXPOSE 8080
