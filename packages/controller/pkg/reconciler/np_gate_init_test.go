package reconciler

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	corev1 "k8s.io/api/core/v1"

	"github.com/kagenti/platform/packages/controller/pkg/config"
)

func TestBuildNPGateInitContainer_DisabledReturnsNil(t *testing.T) {
	cfg := *testConfig
	cfg.AgentBase.NPGateInit = nil
	assert.Nil(t, buildNPGateInitContainer(&cfg, "agent:img", "10.96.42.42"))

	cfg.AgentBase.NPGateInit = &config.AgentNPGateInit{Enabled: false, Image: "busybox"}
	assert.Nil(t, buildNPGateInitContainer(&cfg, "agent:img", "10.96.42.42"))
}

// With no override image the gate reuses the agent image (which ships the
// probe via platform-base); with neither set there's no image to run.
func TestBuildNPGateInitContainer_ImageFallback(t *testing.T) {
	cfg := *testConfig
	cfg.AgentBase.NPGateInit = &config.AgentNPGateInit{Enabled: true}

	ic := buildNPGateInitContainer(&cfg, "quay.io/dam-agents/claude-code:v1", "10.96.42.42")
	require.NotNil(t, ic)
	assert.Equal(t, "quay.io/dam-agents/claude-code:v1", ic.Image, "empty override falls back to the agent image")

	assert.Nil(t, buildNPGateInitContainer(&cfg, "", "10.96.42.42"),
		"no override and no agent image — nothing to run")
}

// An explicit override image wins over the agent image.
func TestBuildNPGateInitContainer_OverrideImageWins(t *testing.T) {
	cfg := *testConfig
	cfg.AgentBase.NPGateInit = &config.AgentNPGateInit{Enabled: true, Image: "custom/np-gate:1.0"}

	ic := buildNPGateInitContainer(&cfg, "agent:img", "10.96.42.42")
	require.NotNil(t, ic)
	assert.Equal(t, "custom/np-gate:1.0", ic.Image)
}

// Without a gateway ClusterIP the positive-probe target is unknown.
// Skip — the reconciler requeues until the IP is assigned.
func TestBuildNPGateInitContainer_NoGatewayIPReturnsNil(t *testing.T) {
	cfg := *testConfig
	cfg.AgentBase.NPGateInit = &config.AgentNPGateInit{Enabled: true}
	assert.Nil(t, buildNPGateInitContainer(&cfg, "agent:img", ""), "no gateway IP yet — re-attach on next reconcile")
}

func TestBuildNPGateInitContainer_NoCapsUnprivileged(t *testing.T) {
	cfg := *testConfig
	cfg.AgentBase.NPGateInit = &config.AgentNPGateInit{Enabled: true}

	ic := buildNPGateInitContainer(&cfg, "agent:img", "10.96.42.42")
	require.NotNil(t, ic)
	assert.Equal(t, "np-gate", ic.Name)
	require.NotNil(t, ic.SecurityContext)
	// Pure userspace TCP probe — no caps, no root, no writable rootfs.
	// Same security floor as a normal unprivileged sidecar.
	require.NotNil(t, ic.SecurityContext.RunAsNonRoot)
	assert.True(t, *ic.SecurityContext.RunAsNonRoot, "np-gate must run unprivileged")
	require.NotNil(t, ic.SecurityContext.ReadOnlyRootFilesystem)
	assert.True(t, *ic.SecurityContext.ReadOnlyRootFilesystem, "static probe needs no writable rootfs")
	require.NotNil(t, ic.SecurityContext.Capabilities)
	assert.Contains(t, ic.SecurityContext.Capabilities.Drop, corev1.Capability("ALL"))
	assert.Empty(t, ic.SecurityContext.Capabilities.Add, "no capabilities — pure TCP probe")
}

func TestBuildNPGateInitContainer_ProbeShape(t *testing.T) {
	cfg := *testConfig
	cfg.AgentBase.NPGateInit = &config.AgentNPGateInit{
		Enabled:        true,
		TimeoutSeconds: 30,
	}

	ic := buildNPGateInitContainer(&cfg, "agent:img", "10.96.42.42")
	require.NotNil(t, ic)

	// Runs the static probe binary directly — no shell, no `nc`.
	assert.Equal(t, []string{npGateBinaryPath}, ic.Command)

	envMap := map[string]string{}
	for _, e := range ic.Env {
		envMap[e.Name] = e.Value
	}
	assert.Equal(t, "10.96.42.42", envMap["GATEWAY_IP"], "positive-probe target (paired gateway)")
	assert.Equal(t, "30", envMap["TIMEOUT_SECONDS"], "fail-closed deadline")
	assert.NotEmpty(t, envMap["ENVOY_PORT"])
	// kube-apiserver (the negative-probe target) isn't plumbed via our env
	// block — kubelet injects it into every pod.
	_, kubeHostSet := envMap["KUBERNETES_SERVICE_HOST"]
	_, kubePortSet := envMap["KUBERNETES_SERVICE_PORT"]
	assert.False(t, kubeHostSet, "KUBERNETES_SERVICE_HOST comes from kubelet, not the controller")
	assert.False(t, kubePortSet, "KUBERNETES_SERVICE_PORT comes from kubelet, not the controller")
}
