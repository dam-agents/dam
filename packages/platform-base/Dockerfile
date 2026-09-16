FROM registry.access.redhat.com/hi/core-runtime:latest-builder AS base

USER root
WORKDIR /app
ENV PATH="/app/node_modules/.bin:$PATH"

# Keep in step with MISE_VERSION in .github/workflows/cd.yml.
ARG MISE_VERSION=v2026.9.3
# `set -eu` first, or a failed step exits 0 via the trailing `rm` and caches a
# mise-less layer; `mise --version` last so the layer can't lie about it.
RUN set -eu; \
    dnf install -y git tar gzip; dnf clean all; \
    case "$(uname -m)" in \
    x86_64) arch=x64 sha=72de46e58238e3ae860e449adb9a35f4aba53679621c214dec03d68955fa4de8 ;; \
    aarch64) arch=arm64 sha=d1918155164a7e4ae4ae306e259b186065c0cfc1b993a954d6e033af0fa4fc5a ;; \
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
COPY packages/platform-base/config.toml /etc/mise/config.toml
RUN --mount=type=cache,target=/root/.cache/mise \
    --mount=type=secret,id=GITHUB_TOKEN,env=GITHUB_TOKEN \
    set -eu; \
    export MISE_CACHE_DIR=/root/.cache/mise; \
    mkdir /tmp/lockgen; cp /etc/mise/config.toml /tmp/lockgen/mise.toml; \
    cd /tmp/lockgen; mise trust -q; mise lock; \
    cp mise.lock /etc/mise/mise.lock; rm -r /tmp/lockgen
RUN --mount=type=cache,target=/root/.cache/mise MISE_CACHE_DIR=/root/.cache/mise mise install node && \
    MISE_CACHE_DIR=/root/.cache/mise mise install "npm:pnpm"
# Python is eager, not a lazy shim: the experiment SDK (#2942) runs loop
# scripts with python3, and a first-use CPython download would ride the
# egress gateway mid-experiment (slow at best, policy-blocked at worst).
RUN --mount=type=cache,target=/root/.cache/mise MISE_CACHE_DIR=/root/.cache/mise mise install python
# Drop pip, keep `pip`. mise's CPython bundles pip, and pip's vendor tree is
# what every setuptools/msgpack finding on this image and its derivatives comes
# from — site-packages holds nothing else. No pip release fixes them (pip main
# vendors msgpack 1.2.1; its setuptools is still 70.3.0), and uv is already the
# documented path for Python work here (AGENTS.md) and what the workload images
# build on. So the real pip goes and a shim forwards `python -m pip` to
# `uv pip` against the same interpreter, which needs no --system: mise's python
# carries no EXTERNALLY-MANAGED marker.
# Ceiling: uv has no equivalent for pip's `download`, `config`, `cache` or
# `hash`, which now fail as unknown subcommands. `python -m venv` still seeds a
# real pip from the untouched ensurepip wheel — deleting that would break a
# stdlib feature to clean a file nothing executes.
# realpath in the console scripts because tool-bin symlinks them: $0's own
# dirname is tool-bin, not the interpreter's bin (upstream's script does this
# too). The runner stage's postinstall hook symlinks them from here.
COPY --chmod=755 packages/platform-base/drop-pip.sh /usr/local/bin/drop-pip
RUN set -eu; \
    W="$(mise where python)"; sp="$(echo "$W"/lib/python3.*/site-packages)"; \
    drop-pip "$W/bin/python3"; \
    mkdir "$sp/pip"; \
    printf '__version__ = "24.3.1"\n' > "$sp/pip/__init__.py"; \
    printf 'import os, sys\n\nfrom pip import __version__\n\n# `uv pip --version` is an error, and everything probes `pip --version`.\nif sys.argv[1:2] in (["--version"], ["-V"]):\n    print(f"pip {__version__} (uv shim)")\n    raise SystemExit(0)\n\nos.environ["UV_PYTHON"] = sys.executable\nos.execvp("uv", ["uv", "pip", *sys.argv[1:]])\n' > "$sp/pip/__main__.py"; \
    for b in pip pip3; do \
    printf '#!/bin/sh\nexec "$(dirname -- "$(realpath -- "$0")")/python3" -m pip "$@"\n' > "$W/bin/$b"; \
    chmod 755 "$W/bin/$b"; \
    done
# node 24.19.0's bundled npm ships vulnerable brace-expansion 5.0.7, ip-address
# 10.2.0, tar 7.5.19 and undici 6.27.0; self-upgrade until a node release
# bundles npm >= 11.19.1. Not npm 12: 12.0.2 predates the 11.19.1 dep bumps and
# still carries all four.
RUN mise exec node -- npm install -g npm@11.19.1

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

# A process supervisor for the vm Backend. k3s and anything else installed the
# distro way refuses to install without one: its installer looks for systemd,
# then for /sbin/openrc-run, and gives up. The image's init is catatonit and
# openrc is not packaged for this distro, so it is built here.
#
# openrc-run is staged under libexec rather than left on PATH, because that one
# path is the probe every such installer makes. Only a machine's boot links it
# in, so a container agent — which cannot supervise anything — keeps failing
# that probe immediately instead of installing a service it can never start.
#
# The stock runlevels are emptied because a guest is already booted by the time
# openrc exists: its boot services would re-wipe /tmp (where the agent's cache
# lives) and re-link /var out from under a running userspace. openrc is here to
# supervise what the agent registers, nothing else. The scripts stay in
# /etc/init.d for anything that asks for them by name.
FROM registry.access.redhat.com/hi/core-runtime:latest-builder AS openrc
USER root
ARG OPENRC_VERSION=0.64
ARG OPENRC_SHA256=f52dd53d6bd798476f8f0b74c5722afa1a59e408a4ec49c1333e5a152a25440d
RUN set -eu; \
    dnf install -y -q --setopt=install_weak_deps=0 meson ninja-build gcc pkgconf-pkg-config libcap-devel tar gzip; \
    curl -sSLo /tmp/openrc.tar.gz "https://github.com/OpenRC/openrc/archive/refs/tags/${OPENRC_VERSION}.tar.gz"; \
    echo "${OPENRC_SHA256}  /tmp/openrc.tar.gz" | sha256sum -c -; \
    tar -xf /tmp/openrc.tar.gz -C /tmp; \
    cd "/tmp/openrc-${OPENRC_VERSION}"; \
    meson setup build -Dprefix=/usr -Dsysconfdir=/etc -Dbindir=/usr/bin -Dsbindir=/usr/bin \
    -Daudit=disabled -Dselinux=disabled \
    -Dpam=false -Dsysvinit=false -Dbash-completions=false -Dzsh-completions=false -Dnewnet=false; \
    ninja -C build; \
    DESTDIR=/out ninja -C build install; \
    mv /out/usr/bin/openrc-run /out/usr/libexec/openrc-run; \
    find /out/etc/runlevels -mindepth 2 -delete; \
    rm -rf /out/usr/include

FROM base AS builder

COPY package.json ./

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
# install` until the tool is resolved — kubectl, oc and gws, the tiers that
# stayed lazy. mise re-verifies each tool's GitHub
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
COPY --from=openrc /out/ /
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
RUN set -eu; \
    install -d -o 65532 /usr/local/share/tool-bin; \
    mkdir /usr/local/share/lazy-tools; cd /usr/local/share/lazy-tools; \
    for spec in python python=python3 kubectl oc 'npm:@googleworkspace/cli=gws'; do \
    tool="${spec%%=*}"; bin="${spec##*=}"; \
    printf '#!/bin/sh\nexport MISE_AUTO_INSTALL=false\nmise install %s 1>&2\nexec mise exec %s -- %s "$@"\n' "$tool" "$tool" "$bin" > "$bin"; \
    chmod 755 "$bin"; \
    done
RUN mkdir -p /home/agent /etc/pki/ca-trust/source/anchors /etc/pki/ca-trust/extracted /etc/pki/tls/certs &&\
    chown 65532 /app &&\
    chown -R 65532 /etc/pki/ca-trust/source/anchors /etc/pki/ca-trust/extracted /etc/pki/tls/certs /home/agent &&\
    ldconfig &&\
    echo 'sshd:x:74:' >> /etc/group &&\
    echo 'sshd:x:74:74:Privilege-separated SSH:/usr/share/empty.sshd:/usr/sbin/nologin' >> /etc/passwd &&\
    sed -i -E '/^[^:]*:[^:]*:65532:/d' /etc/passwd &&\
    echo 'agent:x:65532:0:Agent User:/home/agent:/bin/bash' >> /etc/passwd

USER 65532
RUN --mount=type=cache,target=/tmp/mise-cache,uid=65532 set -eu; \
    MISE_CACHE_DIR=/tmp/mise-cache mise install jq fd rg gh uv; \
    rm -rf /tmp/.local; \
    test -x /usr/local/share/tool-bin/jq && test -x /usr/local/share/tool-bin/node; \
    test -x /usr/local/share/tool-bin/uv && test -x /usr/local/share/tool-bin/uvx; \
    pip --version | grep -q "^pip "; \
    pip list >/dev/null

COPY --chmod=755 packages/platform-base/drop-pip.sh /usr/local/bin/drop-pip
COPY --chmod=755 packages/platform-base/harness-chat.sh /usr/local/bin/harness-chat
COPY --chmod=755 packages/platform-base/harness-terminal.sh /usr/local/bin/harness-terminal
COPY --chmod=755 packages/platform-base/dam-run.mjs /usr/local/bin/dam-run
COPY --chmod=755 packages/platform-base/entrypoint.sh /usr/local/bin/agent-entrypoint
COPY --chown=65532:0 packages/platform-base/skills/ /app/working-dir/.agents/skills/
# Staged outside /app/working-dir so the first-boot seed never installs it into
# a sandbox's skill paths; it is invoked in place — a schedule task or slash
# command references the absolute staged path (see #3286).
COPY --chown=65532:0 packages/platform-base/dam-skills/ /usr/local/share/dam-skills/
COPY --chown=65532:0 packages/platform-base/skills-manifest.json /usr/local/share/dam-skill-manifest.json
COPY --chown=65532:0 packages/platform-base/working-dir/.claude.json /app/working-dir/.claude.json
COPY --chown=65532:0 packages/platform-base/working-dir/.claude/settings.json /app/working-dir/.claude/settings.json
COPY --chown=65532:0 packages/platform-base/runtime-manifest.yaml /app/runtime-manifest.yaml
COPY --chown=65532:0 packages/platform-base/AGENTS.md /etc/AGENTS.md

COPY --from=builder --chown=65532:0 /deploy/package.json ./
COPY --from=builder --chown=65532:0 /deploy/node_modules ./node_modules
COPY --from=builder --chown=65532:0 /app/packages/agent-runtime/dist/ ./dist/
COPY --from=builder /app/packages/driver-sdk/dist/driver-sdk.mjs /usr/local/lib/driver-sdk.mjs

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
