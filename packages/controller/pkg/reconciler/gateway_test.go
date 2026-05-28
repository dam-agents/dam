package reconciler

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	corev1 "k8s.io/api/core/v1"
)

// --- Gateway StatefulSet ---

func TestBuildGatewayStatefulSet_Shape(t *testing.T) {
	secrets := []corev1.Secret{credSecret("platform-cred-aaa", "api.example.com")}
	ss := BuildGatewayStatefulSet("my-instance", false, testConfig, testOwnerCM, secrets)

	require.NotNil(t, ss)
	assert.Equal(t, "my-instance-gateway", ss.Name)
	assert.Equal(t, "test-agents", ss.Namespace)
	assert.Equal(t, int32(1), *ss.Spec.Replicas)

	require.Len(t, ss.OwnerReferences, 1)
	assert.Equal(t, "cm-uid-123", string(ss.OwnerReferences[0].UID))

	labels := ss.Spec.Template.Labels
	assert.Equal(t, "my-instance", labels["agent-platform.ai/agent"])
	assert.Equal(t, "my-instance", labels["agent-platform.ai/pair"])
	assert.Equal(t, "gateway", labels["agent-platform.ai/role"])

	require.Len(t, ss.Spec.Template.Spec.Containers, 1, "gateway pod has exactly one Envoy container")
	envoy := ss.Spec.Template.Spec.Containers[0]
	assert.Equal(t, "envoy", envoy.Name)
	assert.Equal(t, "envoyproxy/envoy:distroless-v1.37.2", envoy.Image)

	mountPaths := map[string]string{}
	for _, m := range envoy.VolumeMounts {
		mountPaths[m.Name] = m.MountPath
	}
	assert.Equal(t, "/etc/envoy/credentials/cred-platform-cred-aaa", mountPaths["cred-platform-cred-aaa"])
	assert.Equal(t, "/etc/envoy/tls", mountPaths["envoy-tls"])
	assert.Equal(t, "/etc/envoy", mountPaths["envoy-bootstrap"])
}

func TestBuildGatewayStatefulSet_Hibernated(t *testing.T) {
	ss := BuildGatewayStatefulSet("my-instance", true, testConfig, testOwnerCM, nil)
	assert.Equal(t, int32(0), *ss.Spec.Replicas, "gateway scales with the agent")
}

func TestBuildGatewayStatefulSet_AutomountSAFalse(t *testing.T) {
	ss := BuildGatewayStatefulSet("my-instance", false, testConfig, testOwnerCM, nil)
	require.NotNil(t, ss.Spec.Template.Spec.AutomountServiceAccountToken)
	assert.False(t, *ss.Spec.Template.Spec.AutomountServiceAccountToken,
		"gateway pod must have no SA token — Secret-read RBAC would bypass volume-mount scoping")
}

func TestBuildGatewayStatefulSet_RollingUpdateMaxUnavailable(t *testing.T) {
	// Gateway is single-replica; default RollingUpdate would deadlock if
	// pod-0 is in CrashLoopBackOff (it never goes Ready, so K8s never
	// evicts it to apply the new template). maxUnavailable: 1 unblocks
	// that path. Without it, the rev-1 → rev-2 transition that happens
	// when grants land after agent creation would strand the pod in
	// CrashLoopBackOff indefinitely.
	ss := BuildGatewayStatefulSet("my-instance", false, testConfig, testOwnerCM, nil)
	require.NotNil(t, ss.Spec.UpdateStrategy.RollingUpdate, "rolling update strategy must be set explicitly")
	require.NotNil(t, ss.Spec.UpdateStrategy.RollingUpdate.MaxUnavailable)
	assert.Equal(t, "1", ss.Spec.UpdateStrategy.RollingUpdate.MaxUnavailable.String(),
		"single-replica gateway must allow 1 unavailable so rollouts can proceed past a CrashLoop pod")
}

func TestBuildGatewayStatefulSet_NoAgentVolumes(t *testing.T) {
	// Workspace PVCs and CA-only mounts belong to the agent pod, not the
	// gateway. The gateway only mounts the bootstrap CM, the leaf TLS
	// Secret, and per-credential Secrets.
	ss := BuildGatewayStatefulSet("my-instance", false, testConfig, testOwnerCM, nil)
	for _, v := range ss.Spec.Template.Spec.Volumes {
		assert.NotContains(t, v.Name, "home-agent",
			"gateway must not mount the workspace PVC (ADR-038)")
		assert.NotEqual(t, "ca-cert", v.Name,
			"ca-cert is the agent-side projection; gateway holds the full leaf Secret")
	}
}

// --- Gateway Service ---

func TestBuildGatewayService(t *testing.T) {
	svc := BuildGatewayService("my-instance", testConfig, testOwnerCM)
	assert.Equal(t, "my-instance-gateway", svc.Name)
	// Not headless ("" means apiserver auto-assigns) — hostAliases /
	// iptables allow-list need a routable virtual IP.
	assert.Empty(t, svc.Spec.ClusterIP, "gateway Service must not be headless")
	require.Len(t, svc.Spec.Ports, 1)
	assert.Equal(t, "proxy", svc.Spec.Ports[0].Name)
	assert.Equal(t, int32(10000), svc.Spec.Ports[0].Port)

	// Selector pins to pair + role=gateway.
	assert.Equal(t, "my-instance", svc.Spec.Selector["agent-platform.ai/pair"])
	assert.Equal(t, "gateway", svc.Spec.Selector["agent-platform.ai/role"])
}

// ADR-041: TestBuildGatewayNetworkPolicy / TestBuildForkAgentNetworkPolicy
// removed — pair-key NetworkPolicies are gone, replaced by per-instance
// mesh AuthorizationPolicies (covered in authorization_policy_test.go).

// --- Fork gateway ---

func TestBuildForkGatewayPod_Labels(t *testing.T) {
	pod := BuildForkGatewayPod("fork-abc", "parent-instance", testConfig, testForkOwnerCM, nil)
	assert.Equal(t, "fork-abc-gateway", pod.Name)
	// Instance label points at the PARENT instance — ext_authz identity
	// flows through this label, and forks inherit the parent's egress
	// rules (ADR-027).
	assert.Equal(t, "parent-instance", pod.Labels["agent-platform.ai/agent"])
	// Pair key is the fork name — the fork pair is structurally isolated
	// from the parent instance pair.
	assert.Equal(t, "fork-abc", pod.Labels["agent-platform.ai/pair"])
	assert.Equal(t, "gateway", pod.Labels["agent-platform.ai/role"])

	require.Len(t, pod.OwnerReferences, 1)
	assert.Equal(t, "fork-abc", pod.OwnerReferences[0].Name)

	require.NotNil(t, pod.Spec.AutomountServiceAccountToken)
	assert.False(t, *pod.Spec.AutomountServiceAccountToken)
}

func TestBuildForkGatewayService(t *testing.T) {
	svc := BuildForkGatewayService("fork-abc", testConfig, testOwnerCM)
	assert.Equal(t, "fork-abc-gateway", svc.Name)
	assert.Equal(t, "fork-abc", svc.Spec.Selector["agent-platform.ai/pair"])
	assert.Equal(t, "gateway", svc.Spec.Selector["agent-platform.ai/role"])
}

// TestLabelContract pins the on-the-wire label keys and values that
// NetworkPolicy selectors and the api-server's pod-IP resolver depend on.
// The TS side has a mirror test in
// `packages/api-server/src/__tests__/unit/label-contract.test.ts`. Drift
// between the two would silently break the credential boundary
// (ADR-038 §Threat Model).
func TestLabelContract(t *testing.T) {
	assert.Equal(t, "agent-platform.ai/agent", LabelAgent)
	assert.Equal(t, "agent-platform.ai/pair", LabelPair)
	assert.Equal(t, "agent-platform.ai/role", LabelRole)
	assert.Equal(t, "agent", RoleAgent)
	assert.Equal(t, "gateway", RoleGateway)
}
