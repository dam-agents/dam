package reconciler

import (
	"fmt"

	corev1 "k8s.io/api/core/v1"

	"github.com/kagenti/platform/packages/controller/pkg/config"
)

const npGateInitContainerName = "np-gate"
const npGateBinaryPath = "/usr/local/bin/np-gate"

// buildNPGateInitContainer renders an unprivileged init container that
// blocks the agent's main container until the egress NetworkPolicy is
// verifiably enforced — used on runtimes where the in-pod iptables init
// can't run (Kata/CoCo guest kernels without netfilter).
//
// Fail-closed: timeout → exit 1 → pod stays in Init:CrashLoopBackOff.
func buildNPGateInitContainer(cfg *config.Config, agentImage, gatewayClusterIP string) *corev1.Container {
	cfgGate := cfg.AgentBase.NPGateInit
	if cfgGate == nil || !cfgGate.Enabled || gatewayClusterIP == "" {
		return nil
	}

	// Default to the agent image (probe baked in via platform-base); an
	// explicit chart override wins.
	image := cfgGate.Image
	if image == "" {
		image = agentImage
	}
	if image == "" {
		return nil
	}

	timeoutSeconds := cfgGate.TimeoutSeconds
	if timeoutSeconds == 0 {
		timeoutSeconds = 30
	}

	// KUBERNETES_SERVICE_HOST / KUBERNETES_SERVICE_PORT are auto-injected
	// by kubelet into every pod — no plumbing needed here.
	env := []corev1.EnvVar{
		{Name: "GATEWAY_IP", Value: gatewayClusterIP},
		{Name: "ENVOY_PORT", Value: fmt.Sprintf("%d", cfg.EnvoyPort)},
		{Name: "TIMEOUT_SECONDS", Value: fmt.Sprintf("%d", timeoutSeconds)},
	}

	return &corev1.Container{
		Name:    npGateInitContainerName,
		Image:   image,
		Command: []string{npGateBinaryPath},
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
