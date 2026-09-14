#!/usr/bin/env bash
# Boots the prepared guest under Firecracker with the project's aarch64 CI
# kernel (no modules; the cloud image's own kernel cannot be used), a balloon
# with free page reporting, and the prototype tap; records the same numbers as
# the Cloud Hypervisor run.
set -euo pipefail
PROTO=${PROTO:-/opt/proto}; cd "$PROTO"
cp -f noble-root.raw fc.raw; rm -f fc.sock fc-console.log
./firecracker --api-sock fc.sock --log-path fc.log --level Error >fc-console.log 2>&1 &
pid=$!; sleep 1
api() { curl -s --unix-socket fc.sock -X PUT "http://localhost$1" -H 'Content-Type: application/json' -d "$2"; }
api /machine-config '{"vcpu_count":2,"mem_size_mib":2048}'
api /boot-source '{"kernel_image_path":"vmlinux-6.1","boot_args":"console=ttyS0 reboot=k panic=1 rw"}'
api /drives/rootfs '{"drive_id":"rootfs","path_on_host":"fc.raw","is_root_device":true,"is_read_only":false}'
api /drives/seed '{"drive_id":"seed","path_on_host":"seed.img","is_root_device":false,"is_read_only":true}'
api /network-interfaces/eth0 '{"iface_id":"eth0","guest_mac":"52:54:00:00:00:02","host_dev_name":"tap-proto"}'
api /balloon '{"amount_mib":0,"deflate_on_oom":true,"stats_polling_interval_s":5,"free_page_reporting":true}' || api /balloon '{"amount_mib":0,"deflate_on_oom":true,"stats_polling_interval_s":5}'
api /actions '{"action_type":"InstanceStart"}'; t0=$(date +%s)
rss() { awk '/VmRSS/{print $2}' /proc/$pid/status; }
until grep -q "PROTO DONE" fc-console.log 2>/dev/null || ! kill -0 $pid 2>/dev/null || [ $(( $(date +%s) - t0 )) -gt 900 ]; do
  grep -q "PROTO kernel=" fc-console.log 2>/dev/null && [ -z "${idle:-}" ] && idle=$(rss)
  grep -q "PROTO alloc_free_done" fc-console.log 2>/dev/null && [ -z "${after0:-}" ] && after0=$(rss)
  sleep 2; done
sleep 45; after45=$(rss)
echo "== firecracker $(./firecracker --version | head -1) wall=$(( $(date +%s) - t0 ))s"; grep -a "PROTO" fc-console.log; grep -aiE "panic|Kernel panic|error" fc-console.log | head -3
echo "PROTO host_rss_kb idle=${idle:-?} after_free=${after0:-?} after_free_45s=${after45:-?}"
kill $pid 2>/dev/null; wait $pid 2>/dev/null || true
