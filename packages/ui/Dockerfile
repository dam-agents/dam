FROM registry.access.redhat.com/hi/nodejs:24-builder AS builder

USER root

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
