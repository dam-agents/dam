#!/bin/sh
# Boot of the claude-code-vm guest, run by smolvm on every machine start. The
# root filesystem is a throwaway overlay; only the machine's storage disk at
# /workspace survives a stop, so everything that must persist is bind-mounted
# from there: the paths the controller declared persistent
# (PLATFORM_VM_PERSIST_PATHS) plus the docker and k3s state dirs. A dir is
# seeded from the image on its first boot. Then dockerd is started in the
# background (k3s is left for the agent to start when it wants a cluster) and
# the ordinary container entrypoint takes over.
set -eu

persist="$(printf '%s' "${PLATFORM_VM_PERSIST_PATHS:-}" | tr ',' ' ') /var/lib/docker /var/lib/rancher"
for path in $persist; do
	store="/workspace$path"
	if [ ! -d "$store" ]; then
		mkdir -p "$store"
		[ -d "$path" ] && cp -a "$path/." "$store/"
	fi
	mkdir -p "$path"
	mount --bind "$store" "$path"
done

# k3s airgap images: the inner cluster's own pause/coredns/traefik pulls would
# otherwise cross the gateway as egress approvals.
mkdir -p /var/lib/rancher/k3s/agent/images
[ -e /var/lib/rancher/k3s/agent/images/k3s-airgap-images.tar.zst ] ||
	ln -s /usr/local/share/platform-vm/k3s-airgap-images.tar.zst /var/lib/rancher/k3s/agent/images/

if command -v dockerd >/dev/null 2>&1; then
	dockerd >/var/log/dockerd.log 2>&1 &
fi

exec /usr/libexec/catatonit/catatonit -- /usr/local/bin/agent-entrypoint "$@"
