#!/bin/sh
# Block the workload until the egress boundary is verifiably in place — the
# guest analogue of the pod model's np-gate init container. Two probes, same
# as np_gate_init.go: the kube-apiserver (denied target, authority passed by
# the controller via /etc/platform/gate.env since the guest has no
# kubelet-injected env) must be UNREACHABLE, and the paired gateway must
# answer its health path. Fail-closed: timeout ⇒ exit 1 ⇒ agent-runtime
# (Requires=) never starts. The NetworkPolicy on the virt-launcher pod
# remains the authoritative boundary; an in-guest iptables lockdown
# (defense-in-depth like the pod egress-lockdown init) is a follow-up.
set -eu

. /etc/platform/env
[ -f /etc/platform/gate.env ] && . /etc/platform/gate.env
gw="${HTTPS_PROXY#http://}"
deny="${PLATFORM_KUBE_API_DENY:-}"
deadline=$(($(date +%s) + ${PLATFORM_BOOT_GATE_TIMEOUT:-60}))
echo "platform-boot-gate: allowed=http://${gw}/__platform_healthz denied=${deny:-<none>}"

# Handshake completed iff %{time_connect} != 0 (the apiserver answers TLS /
# non-200 when reachable, so HTTP status is not the signal).
reachable() {
	tc=$(curl -s -o /dev/null --connect-timeout 2 -m 3 -w '%{time_connect}' "http://$1" 2>/dev/null)
	[ -n "$tc" ] && [ "$tc" != "0.000000" ]
}
gateway_ready() {
	code=$(curl -s -o /dev/null --connect-timeout 2 -m 3 -w '%{http_code}' "http://${gw}/__platform_healthz" 2>/dev/null || true)
	[ "$code" = "200" ]
}

while [ "$(date +%s)" -lt "$deadline" ]; do
	if [ -n "$deny" ] && reachable "$deny"; then
		sleep 0.5
		continue
	fi
	if gateway_ready; then
		echo "platform-boot-gate: egress boundary in place (denied target blocked, gateway serving)"
		exit 0
	fi
	sleep 0.5
done
echo "platform-boot-gate: FATAL — egress boundary did not converge within the deadline" >&2
exit 1
