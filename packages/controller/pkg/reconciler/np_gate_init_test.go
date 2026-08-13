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

	cfg.AgentBase.NPGateInit = &config.AgentNPGateInit{Enabled: false, Image: "registry.access.redhat.com/hi/curl:8.20-builder"}
	assert.Nil(t, buildNPGateInitContainer(&cfg, "10.96.42.42"))
}

func TestBuildNPGateInitContainer_EmptyImageReturnsNil(t *testing.T) {
	cfg := *testConfig
	cfg.AgentBase.NPGateInit = &config.AgentNPGateInit{Enabled: true}
	assert.Nil(t, buildNPGateInitContainer(&cfg, "10.96.42.42"), "no image configured — chart sets a default")
}

func TestBuildNPGateInitContainer_NoGatewayIPReturnsNil(t *testing.T) {
	cfg := *testConfig
	cfg.AgentBase.NPGateInit = &config.AgentNPGateInit{Enabled: true, Image: "registry.access.redhat.com/hi/curl:8.20-builder"}
	assert.Nil(t, buildNPGateInitContainer(&cfg, ""), "no gateway IP yet — re-attach on next reconcile")
}

func TestBuildNPGateInitContainer_NoCapsUnprivileged(t *testing.T) {
	cfg := *testConfig
	cfg.AgentBase.NPGateInit = &config.AgentNPGateInit{Enabled: true, Image: "registry.access.redhat.com/hi/curl:8.20-builder"}

	ic := buildNPGateInitContainer(&cfg, "10.96.42.42")
	require.NotNil(t, ic)
	assert.Equal(t, "np-gate", ic.Name)
	assert.Equal(t, "registry.access.redhat.com/hi/curl:8.20-builder", ic.Image)
	require.NotNil(t, ic.SecurityContext)
	require.NotNil(t, ic.SecurityContext.RunAsNonRoot)
	assert.True(t, *ic.SecurityContext.RunAsNonRoot, "np-gate must run unprivileged")
	require.NotNil(t, ic.SecurityContext.RunAsUser)
	assert.NotZero(t, *ic.SecurityContext.RunAsUser, "explicit non-root uid")
	require.NotNil(t, ic.SecurityContext.ReadOnlyRootFilesystem)
	assert.True(t, *ic.SecurityContext.ReadOnlyRootFilesystem)
	require.NotNil(t, ic.SecurityContext.Capabilities)
	assert.Contains(t, ic.SecurityContext.Capabilities.Drop, corev1.Capability("ALL"))
	assert.Empty(t, ic.SecurityContext.Capabilities.Add, "no capabilities — pure TCP probe")
}

func TestBuildNPGateInitContainer_ProbeShape(t *testing.T) {
	cfg := *testConfig
	cfg.AgentBase.NPGateInit = &config.AgentNPGateInit{
		Enabled:        true,
		Image:          "registry.access.redhat.com/hi/curl:8.20-builder",
		TimeoutSeconds: 30,
	}

	ic := buildNPGateInitContainer(&cfg, "10.96.42.42")
	require.NotNil(t, ic)
	require.GreaterOrEqual(t, len(ic.Command), 3)
	assert.Equal(t, "/bin/sh", ic.Command[0])
	script := ic.Command[2]

	assert.Contains(t, script, `--connect-timeout 2`)
	assert.Contains(t, script, `%{time_connect}`, "denied target uses TCP-handshake timing")
	assert.Contains(t, script, `%{http_code}`, "allowed target asserts a 200 from the health endpoint")
	assert.Contains(t, script, `reachable "${KUBERNETES_SERVICE_HOST}" "${KUBERNETES_SERVICE_PORT}"`,
		"negative probe against kube-apiserver (kubelet-injected env)")
	assert.Contains(t, script, `gateway_ready`, "positive probe is the gateway health check")
	assert.Contains(t, script, `${HEALTH_PATH}`, "gateway probe targets the namespaced health path, not /")
	assert.Contains(t, script, `[ "$code" = "200" ]`, "gateway probe requires a 200, not just a connect")
	assert.Contains(t, script, "exit 1", "fail-closed on timeout — NP didn't converge")
	assert.Contains(t, script, "exit 0", "release the workload when both probes match expectation")

	envMap := map[string]string{}
	for _, e := range ic.Env {
		envMap[e.Name] = e.Value
	}
	assert.Equal(t, "10.96.42.42", envMap["GATEWAY_IP"])
	assert.Equal(t, "30", envMap["TIMEOUT_SECONDS"])
	assert.NotEmpty(t, envMap["ENVOY_PORT"])
	assert.Equal(t, platformGatewayHealthPath, envMap["HEALTH_PATH"])
	_, kubeHostSet := envMap["KUBERNETES_SERVICE_HOST"]
	_, kubePortSet := envMap["KUBERNETES_SERVICE_PORT"]
	assert.False(t, kubeHostSet, "KUBERNETES_SERVICE_HOST comes from kubelet, not the controller")
	assert.False(t, kubePortSet, "KUBERNETES_SERVICE_PORT comes from kubelet, not the controller")
}
