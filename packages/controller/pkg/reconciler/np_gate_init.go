package reconciler

import (
	"fmt"

	corev1 "k8s.io/api/core/v1"

	"github.com/kagenti/platform/packages/controller/pkg/config"
)

const npGateInitContainerName = "np-gate"

// buildNPGateInitContainer renders an unprivileged init container that
// blocks the agent's main container until the egress NetworkPolicy is
// verifiably enforced.
//
// Threat: OVN-K programs NetworkPolicy ACLs asynchronously after the pod's
// netns is set up. There's a small window (typically ms, occasionally
// longer under churn) where the pod can egress before its NPs are in
// force. The iptables init container closes this race deterministically
// by setting rules inside the pod — but on Kata/CoCo guest kernels that
// lack netfilter modules (see PR #234), the iptables path is unavailable.
// This gate is the alternative: probe an outside-the-allow-list
// destination until it's DROPped, then exit so the agent can start.
//
// Probe shape: TCP-connect to a canary IP (default 1.1.1.1:443) with a
// short timeout. While the connect succeeds, NP isn't in force yet — wait
// and retry. Once the connect fails (timeout/RST), NP is enforcing the
// deny. Also confirm the paired gateway IS reachable — guards against
// "everything denied" false positives on clusters with broken outbound.
//
// Fail-closed: timeout → exit 1 → pod stays in Init:CrashLoopBackOff. The
// agent main container never starts. Operationally noisy; security-wise
// the only correct behavior.
//
// Returns nil when the feature is off, the image is unset, or the
// gateway IP is unknown — caller is expected to either skip this init or
// requeue the reconcile (see needsGatewayIP gating in instance.go/fork.go).
func buildNPGateInitContainer(cfg *config.Config, gatewayClusterIP string) *corev1.Container {
	cfgGate := cfg.AgentBase.NPGateInit
	if cfgGate == nil || !cfgGate.Enabled || cfgGate.Image == "" || gatewayClusterIP == "" {
		return nil
	}

	deniedHost := cfgGate.DeniedHost
	if deniedHost == "" {
		deniedHost = "1.1.1.1"
	}
	deniedPort := cfgGate.DeniedPort
	if deniedPort == 0 {
		deniedPort = 443
	}
	timeoutSeconds := cfgGate.TimeoutSeconds
	if timeoutSeconds == 0 {
		timeoutSeconds = 30
	}

	// `nc -w 2 -z` returns 0 when the TCP connect succeeds, non-zero on
	// timeout/refused/drop. We invert the denied-host check (success on
	// non-zero) and combine with the positive gateway check (success on
	// zero) — both must hold for the gate to release.
	script := `set -u
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

	return &corev1.Container{
		Name:    npGateInitContainerName,
		Image:   cfgGate.Image,
		Command: []string{"/bin/sh", "-c", script},
		Env: []corev1.EnvVar{
			{Name: "GATEWAY_IP", Value: gatewayClusterIP},
			{Name: "ENVOY_PORT", Value: fmt.Sprintf("%d", cfg.EnvoyPort)},
			{Name: "DENIED_HOST", Value: deniedHost},
			{Name: "DENIED_PORT", Value: fmt.Sprintf("%d", deniedPort)},
			{Name: "TIMEOUT_SECONDS", Value: fmt.Sprintf("%d", timeoutSeconds)},
		},
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
