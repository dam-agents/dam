FROM registry.access.redhat.com/hi/core-runtime:latest-builder AS base

USER root
WORKDIR /app
ENV PATH="/app/node_modules/.bin:$PATH"

ARG MISE_VERSION=v2026.6.3
RUN dnf install -y git tar gzip && dnf clean all \
    && set -eu; \
    case "$(uname -m)" in \
      x86_64) arch=x64 sha=61e7fd4bd3496e1b51c775536718ddb6c76d5a54821741d99cde73e15632a7db ;; \
      aarch64) arch=arm64 sha=d528684a70fa8f5fbd9c80277fa25d564bffcc645a283e81d37367943f30dd17 ;; \
      *) echo "unsupported architecture: $(uname -m)" >&2; exit 1 ;; \
    esac; \
    curl -fsSL "https://github.com/jdx/mise/releases/download/${MISE_VERSION}/mise-${MISE_VERSION}-linux-${arch}.tar.gz" -o /tmp/mise.tar.gz; \
    echo "$sha /tmp/mise.tar.gz" | sha256sum -c -; \
    tar -xzf /tmp/mise.tar.gz -C /tmp; \
    mv /tmp/mise/bin/mise /usr/local/bin/mise; \
    rm -rf /tmp/mise /tmp/mise.tar.gz
ENV MISE_DATA_DIR=/usr/local/share/mise \
    PATH="/usr/local/share/mise/shims:$PATH"
# /etc/mise/config.toml is mise's canonical system-level config location.
COPY packages/platform-base/mise.toml /etc/mise/config.toml
COPY packages/platform-base/mise.lock /etc/mise/mise.lock
# `gws --version` once as root: the npm package downloads its platform
# binary on first run, which the non-root agent user couldn't write.
ARG NPM_VERSION=11.16.0
RUN --mount=type=cache,target=/root/.cache/mise \
    mise install && gws --version >/dev/null \
    && npm install -g "npm@${NPM_VERSION}" && mise reshim

# The production stage is the dnf-less core-runtime image; stage the runtime
# packages (and their dependency closure) into an installroot here and COPY
# the result over. RPM scriptlet effects (sshd user/group) are replayed in
# the runner's setup RUN.
FROM registry.access.redhat.com/hi/core-runtime:latest-builder AS sysroot
USER root
RUN dnf install -y --installroot=/sysroot --use-host-config \
      --releasever="$(. /etc/os-release; echo "$VERSION_ID")" \
      --setopt=install_weak_deps=0 \
      git tar gzip curl openssh-server catatonit \
    && rm -rf /sysroot/var/lib/dnf /sysroot/var/cache /sysroot/var/log

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
RUN install-pnpm && mise reshim

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

RUN pnpm --filter agent-runtime exec tsup

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

# Production stage: the dnf-less core-runtime image. Derived agent images
# still get npm at build time through the mise shims copied below; none of
# them needs dnf. Runtime binaries (git, sshd, catatonit, curl, tar/gzip)
# come pre-staged from the sysroot stage.
FROM registry.access.redhat.com/hi/core-runtime:latest AS runner

USER root
WORKDIR /app
ENV MISE_DATA_DIR=/usr/local/share/mise \
    PATH="/app/node_modules/.bin:/usr/local/share/mise/shims:$PATH"

COPY --from=sysroot /sysroot/usr/ /usr/
COPY --from=sysroot /sysroot/etc/ssh/ /etc/ssh/
COPY --from=base /usr/local/bin/mise /usr/local/bin/mise
COPY --from=base /usr/local/share/mise/ /usr/local/share/mise/
COPY --from=base /etc/mise/ /etc/mise/

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
COPY packages/platform-base/AGENTS.md /etc/AGENTS.md

RUN ldconfig \
    && chown -R 65532:0 /app \
    && mkdir -p /etc/claude-code && echo '{}' > /etc/claude-code/managed-settings.json \
    && echo 'sshd:x:74:' >> /etc/group \
    && echo 'sshd:x:74:74:Privilege-separated SSH:/usr/share/empty.sshd:/usr/sbin/nologin' >> /etc/passwd \
    && sed -i -E '/^[^:]*:[^:]*:65532:/d' /etc/passwd \
    && echo 'agent:x:65532:0:Agent User:/home/agent:/bin/bash' >> /etc/passwd \
    && mkdir -p /home/agent \
    && chown -R 65532:0 /home/agent

USER 65532

ENV PORT=8080
EXPOSE 8080

ENTRYPOINT ["/usr/libexec/catatonit/catatonit", "--", "/usr/local/bin/agent-entrypoint"]
CMD ["node", "dist/server.js"]
