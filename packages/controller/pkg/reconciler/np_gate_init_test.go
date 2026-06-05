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

// Without a gateway ClusterIP the positive-probe target is unknown.
// Skip — the reconciler requeues until the IP is assigned.
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
	// Pure userspace probe — no caps, no root, no writable rootfs. Pin a
	// non-root uid so RunAsNonRoot admission passes whatever the image's USER.
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

	// Probe shape: the denied target (kube-apiserver) is a handshake test read
	// from %{time_connect} — it must be DROPped. The allowed target (gateway)
	// is an HTTP 200 from the platform health path read from %{http_code} —
	// that route is answered by the health_check filter before ext_authz, so
	// the probe never creates a HITL hold for the gateway IP (#675). Both
	// conditions must hold before exit 0; fail-closed on the deadline.
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
	// The probe path is plumbed from the controller and must match the path
	// the gateway's health_check filter answers (envoy.go).
	assert.Equal(t, platformGatewayHealthPath, envMap["HEALTH_PATH"])
	// kube-apiserver isn't plumbed via our env block — kubelet does it.
	_, kubeHostSet := envMap["KUBERNETES_SERVICE_HOST"]
	_, kubePortSet := envMap["KUBERNETES_SERVICE_PORT"]
	assert.False(t, kubeHostSet, "KUBERNETES_SERVICE_HOST comes from kubelet, not the controller")
	assert.False(t, kubePortSet, "KUBERNETES_SERVICE_PORT comes from kubelet, not the controller")
}
