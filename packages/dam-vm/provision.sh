#!/usr/bin/env bash
set -euo pipefail

# Incus + dam-vm-server install for an Ubuntu VPS (24.04 LTS or newer).
# Run as root (or via sudo) from inside this directory's copy on the VPS:
#   scp -r packages/dam-vm ubuntu@<ip>: && ssh ubuntu@<ip> sudo ./dam-vm/provision.sh
# Idempotent — safe to re-run (also how you upgrade the server code).

SRC_DIR="$(cd "$(dirname "$0")" && pwd)"

# --- Phase 1: packages ---------------------------------------------------
export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y incus incus-client btrfs-progs nodejs npm

# --- Phase 2: uid/gid maps for root (idempotent) --------------------------
# The Ubuntu package usually adds these itself, but make sure.
grep -q '^root:1000000:1000000000$' /etc/subuid 2>/dev/null || echo "root:1000000:1000000000" >> /etc/subuid
grep -q '^root:1000000:1000000000$' /etc/subgid 2>/dev/null || echo "root:1000000:1000000000" >> /etc/subgid

# --- Phase 3: host kernel prep for k3s inside containers -------------------
# Containers share the host kernel and cannot modprobe; k3s needs these
# modules and sysctls present on the HOST.
K3S_MODULES="overlay br_netfilter \
ip_tables iptable_nat iptable_filter iptable_mangle \
ip6_tables ip6table_nat ip6table_filter ip6table_mangle \
nf_nat xt_conntrack"
for mod in $K3S_MODULES; do modprobe "$mod"; done
printf '%s\n' $K3S_MODULES > /etc/modules-load.d/k3s.conf

cat > /etc/sysctl.d/90-k3s.conf << 'EOF'
net.bridge.bridge-nf-call-iptables = 1
net.bridge.bridge-nf-call-ip6tables = 1
net.ipv4.ip_forward = 1
EOF
sysctl --system > /dev/null

# --- Phase 4: start the daemon --------------------------------------------
systemctl enable --now incus

# --- Phase 5: preseed init --------------------------------------------------
# VPS root disk is typically ext4/xfs, so the pool is a loop-backed btrfs
# image at /var/lib/incus/disks/default.img (sparse, grows up to `size`).
# If you attach a secondary block volume, replace `size: 50GiB` with
# `source: /dev/vdb` (or whatever the device is) for better performance.
incus admin init --preseed << '__LOCKI_EOF__'
storage_pools:
  - name: default
    driver: btrfs
    config:
      size: 50GiB
      btrfs.mount_options: compress=zstd:1,noatime
networks:
  - name: incusbr0
    type: bridge
    config:
      ipv4.address: 10.99.0.1/24
      ipv4.nat: "true"
      ipv6.address: none
profiles:
  - name: default
    config:
      security.nesting: "true"
      security.privileged: "true"
      raw.lxc: |
        lxc.mount.auto = proc:rw sys:rw
        lxc.cap.drop =
    devices:
      root:
        path: /
        pool: default
        type: disk
      eth0:
        name: eth0
        network: incusbr0
        type: nic
      kmsg:
        path: /dev/kmsg
        source: /dev/kmsg
        type: unix-char
__LOCKI_EOF__

# --- Phase 6: install mTLS material ----------------------------------------
# The api-server dials the VPS over the public internet, authenticated by
# mutual TLS. `mise run dam-vm:issue-certs` writes these into cert/ (which
# rides along in the scp'd dir):
#   cert/tls.crt, cert/tls.key   server leaf (with the VPS IP in the SAN) + key
#   cert/client-ca.crt           CA cert, used to verify the client cert
# The api-server gets the CLIENT leaf+key and the same CA (README → helm).
install -d -m 700 /etc/dam-vm
for f in tls.crt tls.key client-ca.crt; do
  [ -s "$SRC_DIR/cert/$f" ] && install -m 600 "$SRC_DIR/cert/$f" "/etc/dam-vm/$f"
done
if [ -s /etc/dam-vm/tls.crt ] && [ -s /etc/dam-vm/client-ca.crt ]; then
  echo "installed mTLS material (server leaf + client CA)"
else
  echo "WARNING: no server cert / client CA at /etc/dam-vm — the relay will"
  echo "         fall back to plain ws:// (dev only). Provide tls.crt, tls.key,"
  echo "         and client-ca.crt and re-run for mutual TLS." >&2
fi

# --- Phase 7: pre-pull the base image --------------------------------------
# Otherwise the very first `dam-vm` call blocks on a ~2 GB image fetch and can
# exceed the server's per-launch budget. Idempotent (no-op once cached).
IMAGE="${DAM_VM_IMAGE:-images:ubuntu/24.04}"
incus image copy "$IMAGE" local: 2>/dev/null || true

# --- Phase 8: dam-vm-server as a systemd service ---------------------------
install -d /opt/dam-vm
install -m 644 "$SRC_DIR/dam-vm-server.mjs" "$SRC_DIR/package.json" /opt/dam-vm/
(cd /opt/dam-vm && npm install --omit=dev --no-fund --no-audit)

cat > /etc/systemd/system/dam-vm.service << 'EOF'
[Unit]
Description=dam-vm agent container relay
Wants=network-online.target
After=network-online.target incus.service

[Service]
ExecStart=/usr/bin/node /opt/dam-vm/dam-vm-server.mjs
Restart=always
RestartSec=2

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable dam-vm
systemctl restart dam-vm # restart, not start: pick up new code on re-provision

# --- Phase 9: report status ------------------------------------------------
sleep 1
if systemctl is-active --quiet dam-vm; then
  MODE=$([ -s /etc/dam-vm/tls.crt ] && echo "wss (mutual TLS)" || echo "PLAIN ws (loopback only — no certs installed)")
  echo
  echo "dam-vm is up: $MODE"
  echo "The helm values for each cluster were printed by 'mise run dam-vm:issue-certs'."
  echo "Then open TCP 8090 to each DAM cluster's egress IP (cloud security group)."
else
  echo "ERROR: dam-vm did not come up — journalctl -u dam-vm" >&2
  exit 1
fi
