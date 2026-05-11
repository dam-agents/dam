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

# ADR-037: agent-runtime spawns `/usr/local/bin/harness-chat` for chat
# sessions and `/usr/local/bin/harness-terminal` for terminal sessions.
# The shell shims live in this package's source; install them as
# executables on the PATH the runtime expects.
COPY packages/platform-base/harness-chat.sh /usr/local/bin/harness-chat
COPY packages/platform-base/harness-terminal.sh /usr/local/bin/harness-terminal
RUN chmod +x /usr/local/bin/harness-chat /usr/local/bin/harness-terminal

COPY packages/platform-base/skills/ /app/working-dir/.agents/skills/
COPY packages/platform-base/working-dir/.claude.json /app/working-dir/.claude.json
COPY packages/platform-base/working-dir/.claude/settings.json /app/working-dir/.claude/settings.json
RUN mkdir -p /app/working-dir/.claude /app/working-dir/.pi/agent \
    && ln -s ../.agents/skills /app/working-dir/.claude/skills \
    && ln -s ../../.agents/skills /app/working-dir/.pi/agent/skills \
    && chown -R 65532:0 /app

# Claude Code 2.x changed the managed-settings.json schema: `allowedMcpServers`
# is no longer a `string[]` of server names — the array entries are expected
# to be objects (or the field has been retired entirely). The legacy shape
# made every agent pod fail Claude Code startup with:
#   Unable to read managed policy settings.
#   Detail: /etc/claude-code/managed-settings.json: Expected object, but
#   received string
# which manifested upstream as `Claude Code process exited with code 1` on
# session/new. Stub the file to an empty object so startup succeeds; the
# platform-outbound MCP server now goes through the standard "first use
# allow" prompt until we re-derive the explicit allowlist for the v2 schema.
RUN mkdir -p /etc/claude-code && echo '{}' > /etc/claude-code/managed-settings.json

USER 65532

ENV PORT=8080
EXPOSE 8080

CMD ["node", "dist/server.js"]
