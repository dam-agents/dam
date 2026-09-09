FROM registry.access.redhat.com/hi/nodejs:24-builder AS builder

USER root

# pnpm at the version .mise/config.toml pins, installed by mise from the npm registry
# (the npm backend needs no GitHub API calls on rate-limited runners). Builder
# stage only: the runtime image carries neither mise nor pnpm.
COPY --from=ghcr.io/jdx/mise:2026.9@sha256:812f7860a2fb911e1d5dd3375834abb2a08f8c783a23f783fcbccaf7fc7357aa /usr/local/bin/mise /usr/local/bin/mise
# npm CLI (not embedded aube) so pnpm's postinstall can drop in its native binary.
ENV MISE_DATA_DIR=/usr/local/share/mise \
    MISE_NPM_PACKAGE_MANAGER=npm \
    PATH="/usr/local/share/mise/shims:$PATH"
COPY package.json ./
RUN --mount=type=bind,source=.mise/config.toml,target=/tmp/root-mise.toml \
    mise use -g "npm:pnpm@$(sed -n 's/^pnpm = "\([^"]*\)".*/\1/p' /tmp/root-mise.toml)" && mise reshim && pnpm --version

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
ARG NPM_VERSION=11.19.1
RUN npm install -g "npm@${NPM_VERSION}" && rm -rf /usr/lib/node_modules_24/npm
USER 65532

COPY --from=builder --chown=65532:0 /prod /app
COPY --from=builder --chown=65532:0 /app/packages/db/drizzle /app/packages/db/drizzle

EXPOSE 4000

# The --import preload wires OpenTelemetry before the app evaluates; it is a
# no-op unless an OTLP endpoint is configured in the environment.
CMD ["node", "--import", "./dist/telemetry.js", "dist/index.js"]
