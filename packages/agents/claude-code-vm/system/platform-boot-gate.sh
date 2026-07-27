#!/bin/sh
# Block the workload until the paired gateway answers its health path — the
# guest analogue of the pod model's np-gate init container. Weaker than the
# pod version by design: the guest cannot probe "kube-apiserver unreachable"
# (no kubelet-injected env), so this is a positive-only readiness gate; the
# NetworkPolicy on the virt-launcher pod remains the authoritative boundary.
# Fail-closed: timeout ⇒ exit 1 ⇒ agent-runtime (Requires=) never starts.
set -eu

. /etc/platform/env
gw="${HTTPS_PROXY#http://}"
deadline=$(($(date +%s) + ${PLATFORM_BOOT_GATE_TIMEOUT:-60}))
echo "platform-boot-gate: probing gateway http://${gw}/__platform_healthz"
while [ "$(date +%s)" -lt "$deadline" ]; do
	code=$(curl -s -o /dev/null --connect-timeout 2 -m 3 -w '%{http_code}' "http://${gw}/__platform_healthz" 2>/dev/null || true)
	if [ "$code" = "200" ]; then
		echo "platform-boot-gate: gateway ready"
		exit 0
	fi
	sleep 0.5
done
echo "platform-boot-gate: FATAL — gateway did not answer within the deadline" >&2
exit 1
