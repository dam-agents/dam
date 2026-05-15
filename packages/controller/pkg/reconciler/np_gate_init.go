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
// Probes a canary destination expected to be denied AND the paired
// gateway expected to be reachable; only releases when both hold.
// Defaults to the kube-apiserver Service IP (KUBERNETES_SERVICE_HOST /
// KUBERNETES_SERVICE_PORT auto-injected by kubelet) — operators can
// override via `npGateInit.deniedHost` / `.deniedPort`.
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

	// DENIED_HOST / DENIED_PORT default to the kubelet-injected
	// KUBERNETES_SERVICE_HOST / KUBERNETES_SERVICE_PORT — shell
	// parameter expansion `${X:-fallback}` honors the kubelet values
	// unless the operator overrode them in env below.
	script := `set -u
DENIED_HOST="${DENIED_HOST:-${KUBERNETES_SERVICE_HOST}}"
DENIED_PORT="${DENIED_PORT:-${KUBERNETES_SERVICE_PORT}}"
deadline=$(($(date +%s) + ${TIMEOUT_SECONDS}))
echo "np-gate: probing denied=${DENIED_HOST}:${DENIED_PORT} allowed=${GATEWAY_IP}:${ENVOY_PORT}, deadline=${TIMEOUT_SECONDS}s"
while [ "$(date +%s)" -lt "${deadline}" ]; do
    if ! nc -w 2 -z "${DENIED_HOST}" "${DENIED_PORT}" 2>/dev/null; then
        if nc -w 2 -z "${GATEWAY_IP}" "${ENVOY_PORT}" 2>/dev/null; then
            echo "np-gate: NetworkPolicy enforced (denied ${DENIED_HOST}:${DENIED_PORT} blocked, gateway ${GATEWAY_IP}:${ENVOY_PORT} reachable)"
            exit 0
        fi
    fi
    sleep 0.3
done
echo "np-gate: FATAL — NetworkPolicy did not converge within ${TIMEOUT_SECONDS}s (denied=${DENIED_HOST}:${DENIED_PORT} allowed=${GATEWAY_IP}:${ENVOY_PORT})" >&2
exit 1
`

	env := []corev1.EnvVar{
		{Name: "GATEWAY_IP", Value: gatewayClusterIP},
		{Name: "ENVOY_PORT", Value: fmt.Sprintf("%d", cfg.EnvoyPort)},
		{Name: "TIMEOUT_SECONDS", Value: fmt.Sprintf("%d", timeoutSeconds)},
	}
	// Only inject when overridden — empty values would mask kubelet's
	// KUBERNETES_SERVICE_HOST/PORT injection.
	if cfgGate.DeniedHost != "" {
		env = append(env, corev1.EnvVar{Name: "DENIED_HOST", Value: cfgGate.DeniedHost})
	}
	if cfgGate.DeniedPort != 0 {
		env = append(env, corev1.EnvVar{Name: "DENIED_PORT", Value: fmt.Sprintf("%d", cfgGate.DeniedPort)})
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
