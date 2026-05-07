FROM registry.access.redhat.com/hi/nodejs:22-builder AS base

USER root
ENV PATH="/app/node_modules/.bin:$PATH"

RUN dnf install -y git tar gzip && dnf clean all

FROM base AS builder

COPY scripts/install-pnpm.sh /usr/local/bin/install-pnpm
COPY package.json ./
RUN install-pnpm

COPY pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json ./
COPY packages/agent-runtime/package.json packages/agent-runtime/
COPY packages/agent-runtime-api/package.json packages/agent-runtime-api/
COPY packages/api-server-api/package.json packages/api-server-api/

RUN pnpm install --frozen-lockfile --filter agent-runtime...

COPY packages/agent-runtime-api/ packages/agent-runtime-api/
COPY packages/api-server-api/ packages/api-server-api/
COPY packages/agent-runtime/ packages/agent-runtime/

RUN pnpm --filter agent-runtime build

# -builder base: agent images extending this need dnf+npm install at build time.
FROM base AS runner

ARG TARGETARCH
ARG GH_VERSION=2.89.0
RUN curl -fsSL "https://github.com/cli/cli/releases/download/v${GH_VERSION}/gh_${GH_VERSION}_linux_${TARGETARCH}.tar.gz" \
    | tar -xz --strip-components=1 -C /usr/local

COPY packages/platform-base/package.json ./
RUN npm install --omit=dev

COPY --from=builder /app/packages/agent-runtime/dist/ dist/

COPY packages/platform-base/skills/ /app/working-dir/.agents/skills/
RUN mkdir -p /app/working-dir/.claude /app/working-dir/.pi/agent \
    && ln -s ../.agents/skills /app/working-dir/.claude/skills \
    && ln -s ../../.agents/skills /app/working-dir/.pi/agent/skills \
    && chown -R 65532:0 /app

RUN mkdir -p /etc/claude-code && echo '{"allowedMcpServers":["platform-outbound"]}' > /etc/claude-code/managed-settings.json

USER 65532

ENV PORT=8080
EXPOSE 8080

CMD ["node", "dist/server.js"]
