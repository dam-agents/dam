FROM registry.access.redhat.com/hi/core-runtime:latest-builder AS base

USER root
WORKDIR /app
ENV PATH="/app/node_modules/.bin:$PATH"

ARG MISE_VERSION=v2026.6.3
# `set -eu` first, or a failed step exits 0 via the trailing `rm` and caches a
# mise-less layer; `mise --version` last so the layer can't lie about it.
RUN set -eu; \
    dnf install -y git tar gzip; dnf clean all; \
    case "$(uname -m)" in \
    x86_64) arch=x64 sha=61e7fd4bd3496e1b51c775536718ddb6c76d5a54821741d99cde73e15632a7db ;; \
    aarch64) arch=arm64 sha=d528684a70fa8f5fbd9c80277fa25d564bffcc645a283e81d37367943f30dd17 ;; \
    *) echo "unsupported architecture: $(uname -m)" >&2; exit 1 ;; \
    esac; \
    curl -fsSL "https://github.com/jdx/mise/releases/download/${MISE_VERSION}/mise-${MISE_VERSION}-linux-${arch}.tar.gz" -o /tmp/mise.tar.gz; \
    echo "$sha /tmp/mise.tar.gz" | sha256sum -c -; \
    tar -xzf /tmp/mise.tar.gz -C /tmp; \
    mv /tmp/mise/bin/mise /usr/local/bin/mise; \
    rm -rf /tmp/mise /tmp/mise.tar.gz; \
    mise --version
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
# Python is eager, not a lazy shim: the experiment SDK (#2942) runs loop
# scripts with python3, and a first-use CPython download would ride the
# egress gateway mid-experiment (slow at best, policy-blocked at worst).
RUN --mount=type=cache,target=/root/.cache/mise mise install python
# mise's CPython bundles pip 26.0.1 (CVE-2026-3219, CVE-2026-8643); self-upgrade
# until a python release bundles pip >= 26.1.2.
RUN mise exec python -- python -m pip install --upgrade pip==26.1.2
# node 24.18.0's bundled npm 11.16.0 ships vulnerable undici 6.26.0
# (CVE-2026-12151) and tar 7.5.15 (CVE-2026-53655); self-upgrade until a
# node release bundles npm >= 11.17.0.
RUN mise exec node -- npm install -g npm@11.18.0

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
    diffutils \
    file \
    gawk \
    git \
    gzip \
    hostname \
    openssh-server \
    openssl \
    patch \
    procps-ng \
    tar \
    unzip \
    which \
    xz-libs \
    zip \
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
COPY packages/driver-sdk/package.json packages/driver-sdk/

RUN --mount=type=cache,id=pnpm-store,target=/pnpm-store \
    PNPM_STORE_DIR=/pnpm-store pnpm install --frozen-lockfile --filter agent-runtime... --filter driver-sdk...

COPY packages/dev-config/ packages/dev-config/
COPY packages/agent-runtime-api/ packages/agent-runtime-api/
COPY packages/api-server-api/ packages/api-server-api/
COPY packages/agent-runtime/ packages/agent-runtime/
COPY packages/driver-sdk/ packages/driver-sdk/

RUN pnpm --filter agent-runtime exec tsup
# driver-sdk: a dependency-free .mjs shipped at /usr/local/lib for the dam-invoke
# skill (a sandbox IS an ephemeral Agent, ADR-077, so it lives in the base image
# every harness inherits, not in one agent's build context).
RUN pnpm --filter driver-sdk exec tsup

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
# MISE_PROVENANCE_API_FAILURES_FATAL: the lazy-tools shims (below) run `mise
# install` on every jq/fd/rg/gh call. mise re-verifies each tool's GitHub
# artifact attestation against api.github.com, and a long-lived agent doing
# this thousands of times/hr exhausts the per-token rate limit — every call
# then loops on 429s (observed on dev: one agent driving ~1k 429/hr). Keeping
# provenance on but non-fatal makes a rate-limited/unreachable api.github.com
# fall back to the locked checksums (which still guarantee integrity) instead
# of failing. MISE_NODE_VERIFY=false is the same story for node. Needs mise
# >=2026.5 (pinned v2026.6.3 above honors it). Ported from Locki.
ENV MISE_DATA_DIR=/usr/local/share/mise \
    MISE_PROVENANCE_API_FAILURES_FATAL=false \
    MISE_NODE_VERIFY=false \
    PATH="/usr/local/share/tool-bin:/app/node_modules/.bin:/usr/local/share/mise/shims:$PATH:/usr/local/share/lazy-tools"

COPY --from=sysroot /sysroot/usr/ /usr/
COPY --from=sysroot /sysroot/etc/ssh/ /etc/ssh/
COPY --from=base /usr/local/bin/mise /usr/local/bin/mise
COPY --from=base --chown=65532:0 /usr/local/share/mise/ /usr/local/share/mise/
COPY --from=base --chown=65532:0 /etc/mise/ /etc/mise/
# The experiment SDK (#2942): one stdlib-only module, importable everywhere via
# PYTHONPATH — the Python analog of driver-sdk.mjs. --chmod because COPY
# preserves source modes and git doesn't: an owner-only file in a build
# context (sandbox worktrees create those) would land root-0600 and lock the
# non-root agent user out of the import. The explicit dir chmod is needed
# because --chmod also stamps the parent COPY creates — 0644 on a directory
# has no execute bit, which is just a different way to break the import.
COPY --chmod=0644 packages/experiment-sdk/src/experiment_sdk.py /usr/local/lib/platform-python/experiment_sdk.py
RUN chmod 0755 /usr/local/lib/platform-python
# The chmod restores world-readability: mise rewrites the lock 0600, which
# would lock the runtime agent user out after a root-run install in a derived
# image build — an unreadable lock degrades every shim call to API lookups.
RUN set -eu; \
    mkdir /usr/local/share/lazy-tools; cd /usr/local/share/lazy-tools; \
    for spec in gh uv uv=uvx python python=python3 kubectl oc 'npm:@googleworkspace/cli=gws'; do \
    tool="${spec%%=*}"; bin="${spec##*=}"; \
    printf '#!/bin/sh\nexport MISE_AUTO_INSTALL=false\nmise install %s 1>&2\nchmod 644 /etc/mise/mise.lock 2>/dev/null\nreal=$(mise which %s 2>/dev/null)\nif [ -x "$real" ]; then\n  ln -sf "$real" /usr/local/share/tool-bin/%s 2>/dev/null\n  exec "$real" "$@"\nfi\nexec mise exec %s -- %s "$@"\n' "$tool" "$bin" "$bin" "$tool" "$bin" > "$bin"; \
    chmod 755 "$bin"; \
    done
RUN --mount=type=cache,target=/root/.cache/mise set -eu; \
    mise install jq fd rg; \
    mkdir /usr/local/share/tool-bin; \
    chown 65532 /usr/local/share/tool-bin
COPY --chmod=755 packages/platform-base/harness-chat.sh /usr/local/bin/harness-chat
COPY --chmod=755 packages/platform-base/harness-terminal.sh /usr/local/bin/harness-terminal
COPY --chmod=755 packages/platform-base/dam-run.mjs /usr/local/bin/dam-run
COPY --chmod=755 packages/platform-base/entrypoint.sh /usr/local/bin/agent-entrypoint
COPY --chown=65532:0 packages/platform-base/skills/ /app/working-dir/.agents/skills/
COPY --chown=65532:0 packages/platform-base/working-dir/.claude.json /app/working-dir/.claude.json
COPY --chown=65532:0 packages/platform-base/working-dir/.claude/settings.json /app/working-dir/.claude/settings.json
COPY --chown=65532:0 packages/platform-base/runtime-manifest.yaml /app/runtime-manifest.yaml
COPY --chown=65532:0 packages/platform-base/AGENTS.md /etc/AGENTS.md

RUN mkdir -p /home/agent /etc/pki/ca-trust/source/anchors /etc/pki/ca-trust/extracted /etc/pki/tls/certs &&\
    chown 65532 /app &&\
    chown -R 65532 /etc/pki/ca-trust/source/anchors /etc/pki/ca-trust/extracted /etc/pki/tls/certs /home/agent &&\
    ldconfig &&\
    echo 'sshd:x:74:' >> /etc/group &&\
    echo 'sshd:x:74:74:Privilege-separated SSH:/usr/share/empty.sshd:/usr/sbin/nologin' >> /etc/passwd &&\
    sed -i -E '/^[^:]*:[^:]*:65532:/d' /etc/passwd &&\
    echo 'agent:x:65532:0:Agent User:/home/agent:/bin/bash' >> /etc/passwd

COPY --from=builder --chown=65532:0 /deploy/package.json ./
COPY --from=builder --chown=65532:0 /deploy/node_modules ./node_modules
COPY --from=builder --chown=65532:0 /app/packages/agent-runtime/dist/ ./dist/
COPY --from=builder /app/packages/driver-sdk/dist/driver-sdk.mjs /usr/local/lib/driver-sdk.mjs

USER 65532

# Python's TLS clients skip the system trust store the entrypoint installs the
# platform CA into (httpx/certifi honor SSL_CERT_FILE, requests honors
# REQUESTS_CA_BUNDLE) — point both at the merged system bundle. Never the bare
# CA file: that would replace and drop the public CAs.
ENV SSL_CERT_FILE=/etc/pki/ca-trust/extracted/pem/tls-ca-bundle.pem \
    REQUESTS_CA_BUNDLE=/etc/pki/ca-trust/extracted/pem/tls-ca-bundle.pem

# `import experiment_sdk` works in any python the pod runs (#2942).
ENV PYTHONPATH=/usr/local/lib/platform-python

ENV PORT=8080
EXPOSE 8080

ENTRYPOINT ["/usr/libexec/catatonit/catatonit", "--", "/usr/local/bin/agent-entrypoint"]
CMD ["node", "dist/server.js"]
