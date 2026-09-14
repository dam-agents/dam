#!/usr/bin/env bash
# Boots the prepared guest under Cloud Hypervisor with EDK2 firmware (the cloud
# image's own kernel), a balloon with free page reporting, and a tap on the
# prototype NAT; records boot/k3s timings from the console and the VMM's host
# RSS before, during and after the guest's 1 GiB allocate-and-free.
set -euo pipefail
PROTO=${PROTO:-/opt/proto}; cd "$PROTO"
cp -f noble.raw ch.raw; rm -f ch.sock ch-console.log
./cloud-hypervisor --api-socket ch.sock --firmware CLOUDHV_EFI.fd --cpus boot=2 --memory size=2048M --balloon size=0,deflate_on_oom=on,free_page_reporting=on \
  --disk path=ch.raw path=seed.img --net tap=tap-proto,mac=52:54:00:00:00:02 --serial file=ch-console.log --console off &
pid=$!; t0=$(date +%s)
rss() { awk '/VmRSS/{print $2}' /proc/$pid/status; }
until grep -q "PROTO DONE" ch-console.log 2>/dev/null || ! kill -0 $pid 2>/dev/null || [ $(( $(date +%s) - t0 )) -gt 900 ]; do
  grep -q "PROTO kernel=" ch-console.log 2>/dev/null && [ -z "${idle:-}" ] && idle=$(rss)
  grep -q "PROTO alloc_free_done" ch-console.log 2>/dev/null && [ -z "${after0:-}" ] && after0=$(rss)
  sleep 2; done
sleep 45; after45=$(rss)
echo "== cloud-hypervisor $(./cloud-hypervisor --version | head -1) wall=$(( $(date +%s) - t0 ))s"; grep -a "PROTO" ch-console.log
echo "PROTO host_rss_kb idle=${idle:-?} after_free=${after0:-?} after_free_45s=${after45:-?}"
./ch-remote --api-socket ch.sock shutdown >/dev/null 2>&1 || kill $pid; wait $pid 2>/dev/null || true
