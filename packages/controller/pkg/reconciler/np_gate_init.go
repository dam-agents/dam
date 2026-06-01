package reconciler

import (
	"fmt"

	corev1 "k8s.io/api/core/v1"

	"github.com/kagenti/platform/packages/controller/pkg/config"
)

const npGateInitContainerName = "np-gate"

// npGateUser is the non-root uid the probe runs as. The configured image
// (a hardened curl -builder image) may default to root, but the pod sets
// RunAsNonRoot, so pin an explicit non-root uid to satisfy admission
// regardless of the image's USER. curl needs no writable home for the probe.
const npGateUser int64 = 65532

// buildNPGateInitContainer renders an unprivileged init container that blocks
// the agent's main container until the egress NetworkPolicy is verifiably
// enforced — used on runtimes where the in-pod iptables init can't run
// (Kata/CoCo guest kernels without netfilter).
//
// It runs a small shell+curl probe (from a hardened curl image) in a loop:
// the kube-apiserver (kubelet-injected KUBERNETES_SERVICE_HOST/PORT) must be
// UNREACHABLE — the agent egress NP DROPs it — while the paired gateway must
// be REACHABLE. The apiserver is the chosen "denied" target because it's the
// only one always actively listening AND always silently DROPped by the NP;
// other targets admit TCP-RST false positives. Reachability is read from
// curl's %{time_connect}: a completed TCP handshake records a non-zero time,
// a silent DROP yields 0.000000. The http:// scheme only drives the connect —
// the response is discarded — so it works against any TCP port regardless of
// the protocol it actually speaks.
//
// Fail-closed: timeout → exit 1 → pod stays in Init:CrashLoopBackOff.
//
// Returns nil when the feature is off or inputs aren't ready; the instance and
// fork reconcilers requeue until the gateway ClusterIP is assigned, so this
// never sees an empty IP at steady state.
func buildNPGateInitContainer(cfg *config.Config, gatewayClusterIP string) *corev1.Container {
	cfgGate := cfg.AgentBase.NPGateInit
	if cfgGate == nil || !cfgGate.Enabled || cfgGate.Image == "" || gatewayClusterIP == "" {
		return nil
	}

	timeoutSeconds := cfgGate.TimeoutSeconds
	if timeoutSeconds == 0 {
		timeoutSeconds = 30
	}

	// KUBERNETES_SERVICE_HOST / KUBERNETES_SERVICE_PORT are auto-injected by
	// kubelet into every pod — no plumbing needed here.
	script := `set -u
deadline=$(($(date +%s) + ${TIMEOUT_SECONDS}))
echo "np-gate: probing denied=${KUBERNETES_SERVICE_HOST}:${KUBERNETES_SERVICE_PORT} allowed=${GATEWAY_IP}:${ENVOY_PORT}, deadline=${TIMEOUT_SECONDS}s"
# connected HOST PORT -> 0 if the TCP handshake completes. curl's
# %{time_connect} is 0.000000 only when no connection established (silent DROP
# or refused); any completed handshake records a non-zero time, whatever the
# port speaks afterwards. -o /dev/null discards the (irrelevant) response.
connected() {
    tc=$(curl -s -o /dev/null --connect-timeout 2 -m 3 -w '%{time_connect}' "http://$1:$2" 2>/dev/null)
    [ -n "$tc" ] && [ "$tc" != "0.000000" ]
}
while [ "$(date +%s)" -lt "${deadline}" ]; do
    if ! connected "${KUBERNETES_SERVICE_HOST}" "${KUBERNETES_SERVICE_PORT}"; then
        if connected "${GATEWAY_IP}" "${ENVOY_PORT}"; then
            echo "np-gate: NetworkPolicy enforced (denied ${KUBERNETES_SERVICE_HOST}:${KUBERNETES_SERVICE_PORT} blocked, gateway ${GATEWAY_IP}:${ENVOY_PORT} reachable)"
            exit 0
        fi
    fi
    sleep 0.3
done
echo "np-gate: FATAL — NetworkPolicy did not converge within ${TIMEOUT_SECONDS}s (denied=${KUBERNETES_SERVICE_HOST}:${KUBERNETES_SERVICE_PORT} allowed=${GATEWAY_IP}:${ENVOY_PORT})" >&2
exit 1
`

	env := []corev1.EnvVar{
		{Name: "GATEWAY_IP", Value: gatewayClusterIP},
		{Name: "ENVOY_PORT", Value: fmt.Sprintf("%d", cfg.EnvoyPort)},
		{Name: "TIMEOUT_SECONDS", Value: fmt.Sprintf("%d", timeoutSeconds)},
	}

	user := npGateUser
	return &corev1.Container{
		Name:    npGateInitContainerName,
		Image:   cfgGate.Image,
		Command: []string{"/bin/sh", "-c", script},
		Env:     env,
		SecurityContext: &corev1.SecurityContext{
			RunAsNonRoot:             ptrBool(true),
			RunAsUser:                &user,
			AllowPrivilegeEscalation: ptrBool(false),
			ReadOnlyRootFilesystem:   ptrBool(true),
			Capabilities: &corev1.Capabilities{
				Drop: []corev1.Capability{"ALL"},
			},
		},
	}
}
