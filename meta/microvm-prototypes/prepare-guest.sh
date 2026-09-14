#!/usr/bin/env bash
# Builds the shared guest artefacts for the microVM prototypes on a Linux/KVM
# host: a raw Ubuntu 24.04 cloud-image disk and a NoCloud seed whose cloud-init
# installs k3s, waits for the node, and prints a machine-readable result on the
# serial console. Idempotent; everything lands in $PROTO (default /opt/proto).
set -euo pipefail
PROTO=${PROTO:-/opt/proto}; cd "$PROTO"
[ -f noble.img ] || curl -sSL -o noble.img https://cloud-images.ubuntu.com/releases/noble/release/ubuntu-24.04-server-cloudimg-arm64.img
qemu-img convert -f qcow2 -O raw noble.img noble.raw && qemu-img resize -f raw noble.raw 8G >/dev/null
cat > user-data <<'YAML'
#cloud-config
password: proto
chpasswd: { expire: false }
ssh_pwauth: true
write_files:
  - path: /usr/local/bin/proto-k3s
    permissions: "0755"
    content: |
      #!/bin/bash
      t0=$(date +%s.%N); up0=$(cut -d' ' -f1 /proc/uptime)
      echo "PROTO boot_to_cloudinit_s=$up0" > /dev/console
      curl -sfL https://get.k3s.io | INSTALL_K3S_EXEC="server --disable=traefik,servicelb,metrics-server" sh - >/tmp/k3s-install.log 2>&1 || echo "PROTO k3s_install=FAIL" > /dev/console
      for i in $(seq 1 120); do kubectl get nodes 2>/dev/null | grep -q ' Ready' && break; sleep 2; done
      echo "PROTO k3s_node=$(kubectl get nodes --no-headers 2>&1 | awk '{print $2}' | head -1) k3s_ready_after_s=$(echo "$(date +%s.%N) - $t0" | bc)" > /dev/console
      kubectl run probe --image=registry.k8s.io/pause:3.10 --restart=Never >/dev/null 2>&1; for i in $(seq 1 60); do kubectl get pod probe 2>/dev/null | grep -qE 'Running' && break; sleep 2; done
      echo "PROTO pod=$(kubectl get pod probe --no-headers 2>&1 | awk '{print $3}')" > /dev/console
      echo "PROTO kernel=$(uname -r) cgroup=$(stat -fc %T /sys/fs/cgroup) balloon_driver=$( [ -d /sys/bus/virtio/drivers/virtio_balloon ] && echo yes || echo no)" > /dev/console
      python3 -c "b=bytearray(1024*1024*1024); b[::4096]=b'x'*len(b[::4096])" ; echo "PROTO alloc_free_done" > /dev/console
      echo "PROTO DONE" > /dev/console
runcmd:
  - [ /usr/local/bin/proto-k3s ]
YAML
cat > network-config <<'YAML'
version: 2
ethernets:
  eth0:
    match: { name: "e*" }
    addresses: [172.20.0.2/24]
    routes: [{ to: default, via: 172.20.0.1 }]
    nameservers: { addresses: [1.1.1.1] }
YAML
cloud-localds -N network-config seed.img user-data
ip link show tap-proto >/dev/null 2>&1 || { ip tuntap add tap-proto mode tap; ip addr add 172.20.0.1/24 dev tap-proto; ip link set tap-proto up; }
sysctl -qw net.ipv4.ip_forward=1
iptables -t nat -C POSTROUTING -s 172.20.0.0/24 -j MASQUERADE 2>/dev/null || iptables -t nat -A POSTROUTING -s 172.20.0.0/24 -j MASQUERADE
iptables -C FORWARD -i tap-proto -j ACCEPT 2>/dev/null || { iptables -I FORWARD -i tap-proto -j ACCEPT; iptables -I FORWARD -o tap-proto -j ACCEPT; }
echo "prepared: $(ls -1 noble.raw seed.img) tap-proto"
