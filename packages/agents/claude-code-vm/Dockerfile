# claude-code-vm — the claude-code image plus docker and k3s, run as a
# persistent smolvm machine on the sandbox node (backend.type: vm). The
# harness content is the claude-code image itself (FROM, not COPY), so that
# image stays the single source of harness truth. The guest runs as root: a
# full VM is deliberately root-capable, and IS_SANDBOX=1 (set by the
# controller) is what lets the harness run that way.
ARG BASE_IMAGE=platform-claude-code
FROM ${BASE_IMAGE}

USER root

# k3s (multi-call: kubectl, crictl) pinned by version — a tag upstream keeps
# forever. Its bundled data dir also carries the iptables the runtime image
# lacks and dockerd needs; extracted here once (k3s unpacks it on first use),
# moved out of /var/lib/rancher, which the boot bind-mounts over, and put on
# PATH rather than symlinked into /usr/local/bin — the guest's image flattener
# refuses absolute symlink targets there. Airgap images let the inner cluster
# start without any egress approvals.
ARG K3S_VERSION=v1.36.4+k3s1
RUN set -eu; \
    arch="$(uname -m | sed 's/x86_64/amd64/; s/aarch64/arm64/')"; \
    bin=k3s; [ "$arch" = arm64 ] && bin=k3s-arm64; \
    curl -fsSL "https://github.com/k3s-io/k3s/releases/download/${K3S_VERSION}/${bin}" -o /usr/local/bin/k3s; \
    chmod 755 /usr/local/bin/k3s; \
    for cmd in kubectl crictl; do ln -s k3s "/usr/local/bin/$cmd"; done; \
    mkdir -p /usr/local/share/platform-vm /etc/rancher/k3s; \
    curl -fsSL "https://github.com/k3s-io/k3s/releases/download/${K3S_VERSION}/k3s-airgap-images-${arch}.tar.zst" \
      -o /usr/local/share/platform-vm/k3s-airgap-images.tar.zst; \
    k3s crictl --version >/dev/null; \
    mv "$(readlink -f /var/lib/rancher/k3s/data/current)/bin" /usr/local/share/platform-vm/k3s-bin; \
    rm -rf /var/lib/rancher/k3s/data; \
    test -x /usr/local/share/platform-vm/k3s-bin/aux/iptables
ENV PATH="/usr/local/share/platform-vm/k3s-bin/aux:${PATH}"
COPY k3s-config.yaml /etc/rancher/k3s/config.yaml

# docker static build: dockerd + containerd + runc + the CLI, no package manager
# needed. Pinned by version like k3s.
ARG DOCKER_VERSION=27.5.1
RUN set -eu; \
    arch="$(uname -m)"; \
    curl -fsSL "https://download.docker.com/linux/static/stable/${arch}/docker-${DOCKER_VERSION}.tgz" \
      | tar -xz -C /usr/local/bin --strip-components=1

COPY --chmod=0755 vm-entrypoint.sh /usr/local/bin/vm-entrypoint
ENTRYPOINT ["/usr/local/bin/vm-entrypoint"]
CMD ["node", "dist/server.js"]
