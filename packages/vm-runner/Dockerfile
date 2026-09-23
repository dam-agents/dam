# The VM runner: smolvm plus the platform's vm-runner agent, run as one
# pod that holds /dev/kvm (a device-plugin resource, or privileged locally) and
# hosts vm-backend agents as microVMs. Same image everywhere; only the pod's
# device grant differs per cluster.
#
# Everything in this image is built from this directory, its only context: the
# runner, which drives smolvm through its embedding API rather than forking the
# CLI; the per-node image cache service beside it; and platform-init, the
# entrypoint the runner hands every machine.
#   docker build packages/vm-runner

# Built for the target platform rather than cross-compiled: CI builds each
# architecture on a runner of that architecture, and a native build needs no
# cross linker. smolvm is cloned at the commit smolvm.pin names by the crate's
# own fetch script, the same one the crate's checks run.
FROM registry.access.redhat.com/hi/rust:1.94-builder AS rust-builder
# platform-init runs inside the agent's image, which shares no libc with this
# one, so it is linked statically, against glibc's static archive. The builder
# carries only the gnu target, so this is the static link it can make.
RUN dnf install -y --setopt=install_weak_deps=False glibc-static && dnf clean all
WORKDIR /src
COPY smolvm.pin Cargo.toml Cargo.lock ./
COPY .mise/fetch-smolvm .mise/fetch-smolvm
RUN ./.mise/fetch-smolvm
COPY src src
COPY platform-init platform-init
# The static flag is scoped to platform-init's own target triple, so it reaches
# neither the runner nor the build scripts cargo runs on the host. The check
# after it fails the build on a binary that still names a dynamic loader or a
# shared library, because that binary would fail only inside a guest.
RUN --mount=type=cache,target=/usr/local/cargo/registry \
    --mount=type=cache,target=/src/target \
    cargo build --release --locked -p vm-runner && \
    cp target/release/vm-runner /vm-runner && cp target/release/vm-image-cache /vm-image-cache && \
    host=$(rustc -vV | sed -n 's/^host: //p') && \
    RUSTFLAGS="-C target-feature=+crt-static" cargo build --release --locked -p platform-init --target "$host" && \
    cp "target/$host/release/platform-init" /platform-init && \
    readelf -lW /platform-init > /tmp/headers && ! grep -q 'program interpreter' /tmp/headers && \
    readelf -dW /platform-init > /tmp/dynamic && ! grep -q '(NEEDED)' /tmp/dynamic


FROM quay.io/fedora/fedora:42 AS runner

# tar unpacks image archives, e2fsprogs makes and grows machine disks, zstd
# expands the ext4 templates onto the runner's claim, once per release, so the
# first agent created after a roll does not wait for it.
RUN dnf install -y --setopt=install_weak_deps=False tar e2fsprogs util-linux-core catatonit zstd && dnf clean all

# The smolvm release comes from GitHub, at the tag smolvm.pin names and refused
# unless it has the digest the pin records for this architecture. The tarball is
# already the layout the runner reads — the launcher, with its libraries, the
# guest agent's rootfs and the compressed disk templates beside it — so only
# those are unpacked, and the release's Kubernetes shim, which the runner does
# not use, is left out.
COPY smolvm.pin /tmp/smolvm.pin
RUN set -eu; \
    version=$(sed -n 's/^tag=v//p' /tmp/smolvm.pin); \
    case "$(uname -m)" in \
    x86_64) arch=x86_64 ;; \
    aarch64) arch=arm64 ;; \
    *) echo "unsupported architecture: $(uname -m)" >&2; exit 1 ;; \
    esac; \
    sha=$(sed -n "s/^sha256-linux-${arch}=//p" /tmp/smolvm.pin); \
    [ -n "$version" ] && [ -n "$sha" ] || { echo "smolvm.pin names no release for linux-${arch}" >&2; exit 1; }; \
    release="smolvm-${version}-linux-${arch}"; \
    curl -fsSL "https://github.com/smol-machines/smolvm/releases/download/v${version}/${release}.tar.gz" -o /tmp/smolvm.tar.gz; \
    echo "$sha /tmp/smolvm.tar.gz" | sha256sum -c -; \
    mkdir -p /opt/smolvm; \
    (umask 022; tar -xzf /tmp/smolvm.tar.gz -C /opt/smolvm --strip-components=1 \
        "${release}/smolvm" "${release}/smolvm-bin" "${release}/lib" "${release}/agent-rootfs" \
        "${release}/storage-template.ext4.zst" "${release}/overlay-template.ext4.zst"); \
    rm /tmp/smolvm.tar.gz /tmp/smolvm.pin; \
    chmod -R a+rX /opt/smolvm

# smolvm's guest rootfs ships a crane built with Go 1.21.6 and go-containerregistry
# v0.19-era deps (docker/docker v24, x/sys v0.8.0) — 3 critical + 54 lesser CVEs, all
# from this one file. Upstream has not rebuilt it as of 1.16.1, so replace it here.
# Drop this once a smolvm release ships a current crane.
#
# The same binary serves the runner: a machine may reach only its gateway, so the
# guest cannot fetch its own image: the runner fetches it into its own cache, or
# the image cache service into a node cache.
ARG CRANE_VERSION=v0.22.1
RUN set -eu; \
    case "$(uname -m)" in \
    x86_64) arch=x86_64 sha=0ab7a1d6932a213aed964ce97666c3077fe691c8606413674a8b3e0b9ec4cda0 ;; \
    aarch64) arch=arm64 sha=898c0cff975f898a33e8c4580bdafb0e7c02c7faa33374e946762f97c4ab7110 ;; \
    *) echo "unsupported architecture: $(uname -m)" >&2; exit 1 ;; \
    esac; \
    curl -fsSL "https://github.com/google/go-containerregistry/releases/download/${CRANE_VERSION}/go-containerregistry_Linux_${arch}.tar.gz" -o /tmp/crane.tar.gz; \
    echo "$sha /tmp/crane.tar.gz" | sha256sum -c -; \
    tar -xzf /tmp/crane.tar.gz -C /opt/smolvm/agent-rootfs/usr/local/bin crane; \
    cp /opt/smolvm/agent-rootfs/usr/local/bin/crane /usr/local/bin/crane; \
    rm /tmp/crane.tar.gz; \
    chmod 0755 /opt/smolvm/agent-rootfs/usr/local/bin/crane /usr/local/bin/crane

# Run once at build time: the binary links the builder's glibc dynamically, and
# a dependency that needs a newer glibc than this base ships fails the image
# build here rather than the runner pod at start.
COPY --from=rust-builder /vm-runner /usr/local/bin/vm-runner
RUN vm-runner --help >/dev/null

# The per-node image cache service runs from this same image, as the DaemonSet's
# own command rather than this ENTRYPOINT: it needs the crane and tar this image
# already carries, and nothing else here. One image keeps the two halves of the
# cache — the runner that fills it on a miss and the service that fills it
# before anyone misses — built and pinned together, which is what makes them
# agree on what a cache entry is.
COPY --from=rust-builder /vm-image-cache /usr/local/bin/vm-image-cache
RUN vm-image-cache --help >/dev/null

# platform-init is the entrypoint of every machine, not of this pod: the runner
# copies it into each machine's share, where the guest runs it before the agent
# image's own entrypoint. It is statically linked because the guest it runs in
# is the agent image, which shares no libc with this one.
COPY --from=rust-builder /platform-init /usr/local/libexec/platform-init

# smolvm keeps machines and their disks under $HOME/.cache, so HOME is where the
# chart mounts the disks: one of three mounts under /var/lib/platform, beside the
# per-machine bookkeeping and the image cache, each with a lifetime of its own.
# catatonit reaps whatever is orphaned to PID 1; the runner reaps the VMMs it
# spawned itself. The ENTRYPOINT names every path that is this image's layout
# and not the controller's to choose — the smolvm release's launcher, beside
# which the runner finds the libraries its VMMs load, the guest agent and the
# disk templates; crane; platform-init — so the runner relies on no default for
# any of them. The controller passes the rest.
ENV HOME=/var/lib/platform/disks
ENTRYPOINT ["/usr/libexec/catatonit/catatonit", "--", "vm-runner", "--smolvm", "/opt/smolvm/smolvm", "--crane", "/usr/local/bin/crane", "--platform-init", "/usr/local/libexec/platform-init"]
