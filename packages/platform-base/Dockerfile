FROM registry.access.redhat.com/hi/core-runtime:latest-builder AS base

USER root
WORKDIR /app
ENV PATH="/app/node_modules/.bin:$PATH"

ARG MISE_VERSION=v2026.6.3
RUN dnf install -y git tar gzip && dnf clean all &&\
    set -eu; \
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
COPY packages/platform-base/mise.toml /etc/mise/config.toml
RUN --mount=type=cache,target=/root/.cache/mise \
    --mount=type=secret,id=GITHUB_TOKEN,env=GITHUB_TOKEN \
    set -eu; \
    mkdir /tmp/lockgen; cp /etc/mise/config.toml /tmp/lockgen/mise.toml; \
    cd /tmp/lockgen; mise trust -q; mise lock; \
    cp mise.lock /etc/mise/mise.lock; chmod 644 /etc/mise/mise.lock; rm -r /tmp/lockgen
RUN --mount=type=cache,target=/root/.cache/mise mise install node

FROM registry.access.redhat.com/hi/core-runtime:latest-builder AS sysroot
USER root
RUN dnf install \
    -y \
    --installroot=/sysroot \
    --use-host-config \
    --releasever="$(. /etc/os-release; echo "$VERSION_ID")" \
    --setopt=install_weak_deps=0 \
    catatonit \
    curl \
    git \
    gzip \
    openssh-server \
    tar \
    xz-libs \
    &&\
    rm -rf /sysroot/var/lib/dnf /sysroot/var/cache /sysroot/var/log

FROM base AS builder

COPY --chmod=755 scripts/install-pnpm.js /usr/local/bin/install-pnpm
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

# --legacy deploy would ignore the lockfile; inject-workspace-packages only
# command-scoped to satisfy modern deploy's guard. Deploy's manifest has
# peer-suffixed versions that break npm in derived images: restore authored one.
RUN npm_config_inject_workspace_packages=true \
    pnpm --filter agent-runtime deploy --frozen-lockfile --prod --node-linker=hoisted /deploy &&\
    cp packages/agent-runtime/package.json /deploy/package.json &&\
    (cd /deploy && pnpm pkg delete devDependencies)

FROM registry.access.redhat.com/hi/core-runtime:latest AS runner

USER root
WORKDIR /app
ENV MISE_DATA_DIR=/usr/local/share/mise \
    PATH="/app/node_modules/.bin:/usr/local/share/mise/shims:$PATH:/usr/local/share/lazy-tools"

COPY --from=sysroot /sysroot/usr/ /usr/
COPY --from=sysroot /sysroot/etc/ssh/ /etc/ssh/
COPY --from=base /usr/local/bin/mise /usr/local/bin/mise
COPY --from=base /usr/local/share/mise/ /usr/local/share/mise/
COPY --from=base /etc/mise/ /etc/mise/
COPY --from=builder /deploy/package.json ./
COPY --from=builder /deploy/node_modules ./node_modules
COPY --from=builder /app/packages/agent-runtime/dist/ ./dist/
# The chmod restores world-readability: mise rewrites the lock 0600, which
# would lock the runtime agent user out after a root-run install in a derived
# image build — an unreadable lock degrades every shim call to API lookups.
RUN set -eu; \
    mkdir /usr/local/share/lazy-tools; cd /usr/local/share/lazy-tools; \
    for spec in jq fd rg gh uv uv=uvx python kubectl oc 'npm:@googleworkspace/cli=gws'; do \
    tool="${spec%%=*}"; bin="${spec##*=}"; \
    printf '#!/bin/sh\nexport MISE_AUTO_INSTALL=false\nmise install %s 1>&2\nchmod 644 /etc/mise/mise.lock 2>/dev/null\nexec mise exec %s -- %s "$@"\n' "$tool" "$tool" "$bin" > "$bin"; \
    chmod 755 "$bin"; \
    done
COPY --chmod=755 packages/platform-base/harness-chat.sh /usr/local/bin/harness-chat
COPY --chmod=755 packages/platform-base/harness-terminal.sh /usr/local/bin/harness-terminal
COPY --chmod=755 packages/platform-base/dam-run.mjs /usr/local/bin/dam-run
COPY --chmod=755 packages/platform-base/entrypoint.sh /usr/local/bin/agent-entrypoint
COPY packages/platform-base/skills/ /app/working-dir/.agents/skills/
COPY packages/platform-base/working-dir/.claude.json /app/working-dir/.claude.json
COPY packages/platform-base/working-dir/.claude/settings.json /app/working-dir/.claude/settings.json
COPY packages/platform-base/runtime-manifest.yaml /app/runtime-manifest.yaml
COPY packages/platform-base/AGENTS.md /etc/AGENTS.md

RUN mkdir -p /home/agent &&\
    chown -R 65532 /etc/mise /etc/pki/ca-trust/source/anchors /etc/pki/ca-trust/extracted /etc/pki/tls/certs /app /home/agent /usr/local/share/mise &&\
    ldconfig &&\
    echo 'sshd:x:74:' >> /etc/group &&\
    echo 'sshd:x:74:74:Privilege-separated SSH:/usr/share/empty.sshd:/usr/sbin/nologin' >> /etc/passwd &&\
    sed -i -E '/^[^:]*:[^:]*:65532:/d' /etc/passwd &&\
    echo 'agent:x:65532:0:Agent User:/home/agent:/bin/bash' >> /etc/passwd

USER 65532

ENV PORT=8080
EXPOSE 8080

ENTRYPOINT ["/usr/libexec/catatonit/catatonit", "--", "/usr/local/bin/agent-entrypoint"]
CMD ["node", "dist/server.js"]
