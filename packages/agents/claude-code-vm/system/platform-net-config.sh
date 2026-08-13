#!/bin/bash
# Pre-docker network config the guest can't ship statically:
#
# 1. Docker daemon MTU. The guest NIC rides the cluster pod network (MTU
#    1400 here, discovered at boot); docker0 would default to 1500 and
#    large transfers inside containers/builds then hang after a successful
#    TCP handshake. k3s (flannel) auto-derives its MTU; docker does not.
#
# 2. Docker client proxy config. The daemon gets proxy env via its systemd
#    drop-in (image pulls work), but BuildKit injects proxy env into RUN
#    steps only from the client's ~/.docker/config.json — without it every
#    build step that fetches (npm, pip, dnf) dials the internet directly
#    and dies against the egress lockdown.
set -eu

iface=$(ip -o route show default | awk '{print $5; exit}')
mtu=$(cat "/sys/class/net/${iface}/mtu")
mkdir -p /etc/docker
printf '{\n  "mtu": %s\n}\n' "$mtu" > /etc/docker/daemon.json

. /etc/platform/env 2>/dev/null || true
[ -n "${HTTPS_PROXY:-}" ] || exit 0

no_proxy_list="localhost,127.0.0.1,10.0.0.0/8,172.16.0.0/12,192.168.0.0/16,.svc,.cluster.local"
for home in /root /home/agent; do
	cfg="$home/.docker/config.json"
	# Never clobber an existing config — docker login writes credentials
	# here. Ceiling: a hand-edited config keeps stale proxy settings; the
	# gateway ClusterIP is stable for the agent's lifetime, so in practice
	# absent-only is enough.
	[ -e "$cfg" ] && continue
	mkdir -p "$home/.docker"
	cat > "$cfg" <<EOF
{
  "proxies": {
    "default": {
      "httpProxy": "$HTTPS_PROXY",
      "httpsProxy": "$HTTPS_PROXY",
      "noProxy": "$no_proxy_list"
    }
  }
}
EOF
	chown -R 65532:1000 "$home/.docker" 2>/dev/null || true
done
