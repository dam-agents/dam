FROM registry.access.redhat.com/hi/nodejs:24-builder AS base

USER root
ENV PATH="/app/node_modules/.bin:$PATH"

RUN dnf install -y git tar gzip && dnf clean all

ARG NPM_VERSION=11.16.0
RUN npm install -g "npm@${NPM_VERSION}" && rm -rf /usr/lib/node_modules_24/npm

# gh's release binaries lag upstream: 2.93.0 ships Go 1.26.3 and pins in-toto
# 0.9.0 (GHSA-pmwq-pjrm-6p5r). Build from source with a patched Go toolchain and
# a bumped in-toto so the binary is CVE-clean.
FROM --platform=$BUILDPLATFORM registry.access.redhat.com/hi/go:1.25-builder AS gh-builder
ARG GH_VERSION=2.93.0
ARG INTOTO_VERSION=0.11.0
ARG TARGETOS
ARG TARGETARCH
ENV GOTOOLCHAIN=go1.26.4 GOFLAGS=-trimpath CGO_ENABLED=0
RUN git clone --depth 1 -b "v${GH_VERSION}" https://github.com/cli/cli /src
WORKDIR /src
RUN go get "github.com/in-toto/in-toto-golang@v${INTOTO_VERSION}" && go mod tidy
RUN GOOS=${TARGETOS:-linux} GOARCH=${TARGETARCH} \
    go build -ldflags "-X github.com/cli/cli/v2/internal/build.Version=${GH_VERSION}" -o /gh ./cmd/gh

FROM base AS builder

COPY scripts/install-pnpm.sh /usr/local/bin/install-pnpm
COPY package.json ./
RUN install-pnpm

COPY pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/dev-config/package.json packages/dev-config/
COPY packages/agent-runtime/package.json packages/agent-runtime/
COPY packages/agent-runtime-api/package.json packages/agent-runtime-api/
COPY packages/api-server-api/package.json packages/api-server-api/

RUN --mount=type=cache,id=pnpm-store,target=/pnpm-store \
    PNPM_STORE_DIR=/pnpm-store pnpm install --frozen-lockfile --filter agent-runtime...

COPY packages/dev-config/ packages/dev-config/
COPY packages/agent-runtime-api/ packages/agent-runtime-api/
COPY packages/api-server-api/ packages/api-server-api/
COPY packages/agent-runtime/ packages/agent-runtime/

RUN pnpm --filter agent-runtime build

# Materialize a flat, prod-only runtime tree for agent-runtime. The contract
# packages (agent-runtime-api, api-server-api) are inlined into dist by tsup
# (noExternal) and live in devDependencies, so --prod omits them from node_modules.
#
# Honor the lockfile: the `--legacy` deploy implementation re-resolves the graph
# WITHOUT the lockfile, drifting to the latest published versions on every build
# (non-reproducible, and it trips the repo's `no-downgrade` trust policy when a
# transitive dep's publisher signal changes). pnpm 10's modern deploy uses the
# lockfile but guards against non-injected workspaces — satisfy that guard with
# a command-scoped `inject-workspace-packages=true` (no prod workspace deps are
# actually injected here) rather than flipping the global config, which would
# turn workspace symlinks into copies for everyone's dev install.
#
# Use the authored manifest, not pnpm's: modern deploy rewrites package.json
# dependency versions to pnpm's peer-resolved form (e.g.
# `@trpc/server: 11.16.0(typescript@6.0.2)`), which is invalid npm syntax and
# breaks the plain `npm install` in derived agent images (e.g. claude-code)
# with EINVALIDTAGNAME. agent-runtime's own package.json
# already carries clean semver ranges, so overwrite the deployed manifest with
# it and drop devDependencies — keeping deploy's lockfile-pinned node_modules
# but an npm-consumable manifest.
RUN npm_config_inject_workspace_packages=true \
    pnpm --filter agent-runtime deploy --frozen-lockfile --prod --node-linker=hoisted /deploy \
    && cp packages/agent-runtime/package.json /deploy/package.json \
    && (cd /deploy && pnpm pkg delete devDependencies)

# -builder base: agent images extending this need dnf+npm install at build time.
FROM base AS runner

COPY --from=gh-builder /gh /usr/local/bin/gh

COPY --from=builder /deploy/package.json ./
COPY --from=builder /deploy/node_modules ./node_modules
# dist/ is gitignored so pnpm deploy skips it.
COPY --from=builder /app/packages/agent-runtime/dist/ ./dist/

# ADR-037: agent-runtime spawns `/usr/local/bin/harness-chat` for chat
# sessions and `/usr/local/bin/harness-terminal` for terminal sessions.
# The shell shims live in this package's source; install them as
# executables on the PATH the runtime expects.
COPY packages/platform-base/harness-chat.sh /usr/local/bin/harness-chat
COPY packages/platform-base/harness-terminal.sh /usr/local/bin/harness-terminal
RUN chmod +x /usr/local/bin/harness-chat /usr/local/bin/harness-terminal

# CA-trust shim (entrypoint.sh): at startup it adds the cluster's CA to the
# system trust store. It runs as the non-root agent user, so give that user
# write access to the dirs update-ca-trust touches — the CA input dir, the
# generated-bundle dir, and the legacy cert dir (/etc/pki/tls/certs, where only
# the dir itself needs to be writable; its symlinks stay root-owned).
COPY packages/platform-base/entrypoint.sh /usr/local/bin/agent-entrypoint
RUN chmod +x /usr/local/bin/agent-entrypoint \
    && chown -R 65532 /etc/pki/ca-trust/source/anchors /etc/pki/ca-trust/extracted \
    && chown 65532 /etc/pki/tls/certs

COPY packages/platform-base/skills/ /app/working-dir/.agents/skills/
COPY packages/platform-base/working-dir/.claude.json /app/working-dir/.claude.json
COPY packages/platform-base/working-dir/.claude/settings.json /app/working-dir/.claude/settings.json
# ADR-052: runtime-manifest.yaml — every agent image ships one. Lives
# at /app/runtime-manifest.yaml (outside working-dir/) so the init
# seed cp -rn ... $HOME doesn't shadow it on the user's PV. Per-image
# overrides are COPY'd later in derived Dockerfiles.
COPY packages/platform-base/runtime-manifest.yaml /app/runtime-manifest.yaml
RUN chown -R 65532:0 /app

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

# Google Workspace CLI (`gws`) — baked into the base so every agent has it,
# pinned to the latest stable release (no-downgrade policy).
RUN --mount=type=cache,target=/root/.npm \
    npm install -g @googleworkspace/cli@0.22.5

USER 65532

ENV PORT=8080
EXPOSE 8080

ENTRYPOINT ["/usr/local/bin/agent-entrypoint"]
CMD ["node", "dist/server.js"]
