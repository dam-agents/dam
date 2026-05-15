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
	assert.Nil(t, buildNPGateInitContainer(&cfg, "10.96.42.42"))

	cfg.AgentBase.NPGateInit = &config.AgentNPGateInit{Enabled: false, Image: "busybox"}
	assert.Nil(t, buildNPGateInitContainer(&cfg, "10.96.42.42"))
}

func TestBuildNPGateInitContainer_EmptyImageReturnsNil(t *testing.T) {
	cfg := *testConfig
	cfg.AgentBase.NPGateInit = &config.AgentNPGateInit{Enabled: true}
	assert.Nil(t, buildNPGateInitContainer(&cfg, "10.96.42.42"), "missing image must not crash; chart enforces non-empty")
}

// Without a gateway ClusterIP the positive-probe target is unknown — the
// init can't tell "NP applied" from "everything broken." Skip until the
// next reconcile picks up the assigned IP (caller's needsGatewayIP gate).
func TestBuildNPGateInitContainer_NoGatewayIPReturnsNil(t *testing.T) {
	cfg := *testConfig
	cfg.AgentBase.NPGateInit = &config.AgentNPGateInit{Enabled: true, Image: "busybox:1.36"}
	assert.Nil(t, buildNPGateInitContainer(&cfg, ""), "no gateway IP yet — re-attach on next reconcile")
}

func TestBuildNPGateInitContainer_NoCapsUnprivileged(t *testing.T) {
	cfg := *testConfig
	cfg.AgentBase.NPGateInit = &config.AgentNPGateInit{Enabled: true, Image: "busybox:1.36"}

	ic := buildNPGateInitContainer(&cfg, "10.96.42.42")
	require.NotNil(t, ic)
	assert.Equal(t, "np-gate", ic.Name)
	assert.Equal(t, "busybox:1.36", ic.Image)
	require.NotNil(t, ic.SecurityContext)
	// Pure userspace TCP probe — no caps, no root, no writable rootfs.
	// Same security floor as a normal unprivileged sidecar.
	require.NotNil(t, ic.SecurityContext.RunAsNonRoot)
	assert.True(t, *ic.SecurityContext.RunAsNonRoot, "np-gate must run unprivileged")
	require.NotNil(t, ic.SecurityContext.Capabilities)
	assert.Contains(t, ic.SecurityContext.Capabilities.Drop, corev1.Capability("ALL"))
	assert.Empty(t, ic.SecurityContext.Capabilities.Add, "no capabilities — pure TCP probe")
}

func TestBuildNPGateInitContainer_ProbeShape(t *testing.T) {
	cfg := *testConfig
	cfg.AgentBase.NPGateInit = &config.AgentNPGateInit{
		Enabled:        true,
		Image:          "busybox:1.36",
		DeniedHost:     "1.1.1.1",
		DeniedPort:     443,
		TimeoutSeconds: 30,
	}

	ic := buildNPGateInitContainer(&cfg, "10.96.42.42")
	require.NotNil(t, ic)
	require.GreaterOrEqual(t, len(ic.Command), 3)
	script := ic.Command[2]

	// Probe shape: nc against denied host expected to FAIL, against
	// gateway expected to SUCCEED. Both must hold before exit 0.
	assert.Contains(t, script, `nc -w 2 -z "${DENIED_HOST}" "${DENIED_PORT}"`, "TCP probe against canary denied destination")
	assert.Contains(t, script, `nc -w 2 -z "${GATEWAY_IP}" "${ENVOY_PORT}"`, "positive probe against the paired gateway")
	assert.Contains(t, script, "exit 1", "fail-closed on timeout — NP didn't converge")
	assert.Contains(t, script, "exit 0", "release the workload when both probes match expectation")

	envMap := map[string]string{}
	for _, e := range ic.Env {
		envMap[e.Name] = e.Value
	}
	assert.Equal(t, "10.96.42.42", envMap["GATEWAY_IP"])
	assert.Equal(t, "1.1.1.1", envMap["DENIED_HOST"])
	assert.Equal(t, "443", envMap["DENIED_PORT"])
	assert.Equal(t, "30", envMap["TIMEOUT_SECONDS"])
	assert.NotEmpty(t, envMap["ENVOY_PORT"])
}

func TestBuildNPGateInitContainer_Defaults(t *testing.T) {
	cfg := *testConfig
	cfg.AgentBase.NPGateInit = &config.AgentNPGateInit{Enabled: true, Image: "busybox:1.36"}

	ic := buildNPGateInitContainer(&cfg, "10.96.42.42")
	require.NotNil(t, ic)
	envMap := map[string]string{}
	for _, e := range ic.Env {
		envMap[e.Name] = e.Value
	}
	// Defaults fill in when chart doesn't override.
	assert.Equal(t, "1.1.1.1", envMap["DENIED_HOST"])
	assert.Equal(t, "443", envMap["DENIED_PORT"])
	assert.Equal(t, "30", envMap["TIMEOUT_SECONDS"])
}
