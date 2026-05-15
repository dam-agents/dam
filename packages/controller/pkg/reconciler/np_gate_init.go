package reconciler

import (
	"fmt"

	corev1 "k8s.io/api/core/v1"

	"github.com/kagenti/platform/packages/controller/pkg/config"
)

const npGateInitContainerName = "np-gate"

// buildNPGateInitContainer renders an unprivileged init container that
// blocks the agent's main container until the egress NetworkPolicy is
// verifiably enforced — used on runtimes where the in-pod iptables init
// can't run (Kata/CoCo guest kernels without netfilter).
//
// Probes the kube-apiserver Service (kubelet-injected
// KUBERNETES_SERVICE_HOST / KUBERNETES_SERVICE_PORT) expecting the NP
// to DROP it, and the paired gateway expecting it to be reachable;
// only releases when both hold. Hard-coded to the kube-apiserver
// because it's the only target that's always actively listening AND
// always silently DROPped by the agent egress NP — other choices
// admit TCP-RST false positives that `nc -z` can't distinguish.
//
// Fail-closed: timeout → exit 1 → pod stays in Init:CrashLoopBackOff.
//
// Returns nil when the feature is off or inputs aren't ready. The
// instance and fork reconcilers requeue until the gateway ClusterIP is
// assigned, so this never sees an empty IP at steady state.
func buildNPGateInitContainer(cfg *config.Config, gatewayClusterIP string) *corev1.Container {
	cfgGate := cfg.AgentBase.NPGateInit
	if cfgGate == nil || !cfgGate.Enabled || cfgGate.Image == "" || gatewayClusterIP == "" {
		return nil
	}

	timeoutSeconds := cfgGate.TimeoutSeconds
	if timeoutSeconds == 0 {
		timeoutSeconds = 30
	}

	// KUBERNETES_SERVICE_HOST / KUBERNETES_SERVICE_PORT are auto-injected
	// by kubelet into every pod — no plumbing needed here.
	script := `set -u
deadline=$(($(date +%s) + ${TIMEOUT_SECONDS}))
echo "np-gate: probing denied=${KUBERNETES_SERVICE_HOST}:${KUBERNETES_SERVICE_PORT} allowed=${GATEWAY_IP}:${ENVOY_PORT}, deadline=${TIMEOUT_SECONDS}s"
while [ "$(date +%s)" -lt "${deadline}" ]; do
    if ! nc -w 2 -z "${KUBERNETES_SERVICE_HOST}" "${KUBERNETES_SERVICE_PORT}" 2>/dev/null; then
        if nc -w 2 -z "${GATEWAY_IP}" "${ENVOY_PORT}" 2>/dev/null; then
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

	return &corev1.Container{
		Name:    npGateInitContainerName,
		Image:   cfgGate.Image,
		Command: []string{"/bin/sh", "-c", script},
		Env:     env,
		SecurityContext: &corev1.SecurityContext{
			RunAsNonRoot:             ptrBool(true),
			AllowPrivilegeEscalation: ptrBool(false),
			ReadOnlyRootFilesystem:   ptrBool(true),
			Capabilities: &corev1.Capabilities{
				Drop: []corev1.Capability{"ALL"},
			},
		},
	}
}
