FROM node:22-slim AS builder

RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/agent-runtime/package.json packages/agent-runtime/
COPY packages/agent-runtime-api/package.json packages/agent-runtime-api/
COPY packages/api-server-api/package.json packages/api-server-api/

RUN pnpm install --frozen-lockfile --filter agent-runtime...

COPY packages/agent-runtime-api/ packages/agent-runtime-api/
COPY packages/api-server-api/ packages/api-server-api/
COPY packages/agent-runtime/ packages/agent-runtime/

RUN pnpm --filter agent-runtime build

FROM node:22-slim

ARG GH_VERSION=2.89.0
RUN apt-get update && apt-get install -y --no-install-recommends git curl ca-certificates && rm -rf /var/lib/apt/lists/* \
    && ARCH=$(dpkg --print-architecture) \
    && curl -fsSL "https://github.com/cli/cli/releases/download/v${GH_VERSION}/gh_${GH_VERSION}_linux_${ARCH}.tar.gz" \
       | tar -xz --strip-components=1 -C /usr/local

WORKDIR /app

COPY packages/platform-base/package.json ./
RUN npm install --production

COPY --from=builder /app/packages/agent-runtime/dist/ dist/

RUN mkdir -p working-dir
COPY packages/platform-base/skills/ /app/working-dir/.agents/skills/
RUN mkdir -p /app/working-dir/.claude /app/working-dir/.pi/agent \
    && ln -s ../.agents/skills /app/working-dir/.claude/skills \
    && ln -s ../../.agents/skills /app/working-dir/.pi/agent/skills

ENV PORT=8080
EXPOSE 8080

CMD ["node", "dist/server.js"]
