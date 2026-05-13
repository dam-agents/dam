package reconciler

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	corev1 "k8s.io/api/core/v1"
	networkingv1 "k8s.io/api/networking/v1"
)

// ADR-042: agent egress NP is the structural boundary for non-ambient
// agent pods. Allows only DNS (resolving the gateway Service hostname)
// and the paired gateway pod on the Envoy proxy port. No mesh entrance,
// no other in-cluster destinations, no external.
func TestBuildAgentEgressNetworkPolicy_LongLivedPair(t *testing.T) {
	np := BuildAgentEgressNetworkPolicy("my-instance", testConfig, testOwnerCM)

	assert.Equal(t, "my-instance-agent-egress", np.Name)
	assert.Equal(t, testConfig.Namespace, np.Namespace)
	require.Len(t, np.OwnerReferences, 1)
	assert.Equal(t, "my-instance", np.OwnerReferences[0].Name)

	// Selector pins to THIS pair's agent pod only.
	assert.Equal(t, "my-instance", np.Spec.PodSelector.MatchLabels[LabelPair])
	assert.Equal(t, RoleAgent, np.Spec.PodSelector.MatchLabels[LabelRole])

	require.Len(t, np.Spec.PolicyTypes, 1)
	assert.Equal(t, networkingv1.PolicyTypeEgress, np.Spec.PolicyTypes[0])

	require.Len(t, np.Spec.Egress, 2, "DNS + paired gateway only — no mesh entrance, no external")

	// DNS to kube-system.
	dns := np.Spec.Egress[0]
	require.Len(t, dns.To, 1)
	require.NotNil(t, dns.To[0].NamespaceSelector)
	assert.Equal(t, "kube-system", dns.To[0].NamespaceSelector.MatchLabels["kubernetes.io/metadata.name"])

	// Paired gateway pod — per-pair selector pins reachability.
	gw := np.Spec.Egress[1]
	require.Len(t, gw.To, 1)
	require.NotNil(t, gw.To[0].PodSelector)
	assert.Equal(t, "my-instance", gw.To[0].PodSelector.MatchLabels[LabelPair])
	assert.Equal(t, RoleGateway, gw.To[0].PodSelector.MatchLabels[LabelRole])
	assert.Nil(t, gw.To[0].NamespaceSelector,
		"bare PodSelector with no NamespaceSelector implicitly scopes to the policy's own namespace where the pair lives")
	require.Len(t, gw.Ports, 1)
	assert.Equal(t, int32(testConfig.EnvoyPort), gw.Ports[0].Port.IntVal)
}

// Fork pair: same shape, keyed on the fork name. The fork agent's
// only egress is to the fork's paired gateway — never the parent's.
func TestBuildAgentEgressNetworkPolicy_Fork(t *testing.T) {
	np := BuildAgentEgressNetworkPolicy("fork-abc", testConfig, testForkOwnerCM)

	assert.Equal(t, "fork-abc-agent-egress", np.Name)
	assert.Equal(t, "fork-abc", np.Spec.PodSelector.MatchLabels[LabelPair])

	gw := np.Spec.Egress[1]
	assert.Equal(t, "fork-abc", gw.To[0].PodSelector.MatchLabels[LabelPair],
		"fork agent egress NP must scope to the fork's gateway, not the parent's")
}

// ADR-042: gateway ingress NP is the symmetric inbound side. Only the
// paired agent pod may reach the gateway's Envoy proxy port.
func TestBuildGatewayIngressNetworkPolicy_LongLivedPair(t *testing.T) {
	np := BuildGatewayIngressNetworkPolicy("my-instance", testConfig, testOwnerCM)

	assert.Equal(t, "my-instance-gateway-ingress", np.Name)
	assert.Equal(t, testConfig.Namespace, np.Namespace)

	// Selector pins to THIS pair's gateway pod.
	assert.Equal(t, "my-instance", np.Spec.PodSelector.MatchLabels[LabelPair])
	assert.Equal(t, RoleGateway, np.Spec.PodSelector.MatchLabels[LabelRole])

	require.Len(t, np.Spec.PolicyTypes, 1)
	assert.Equal(t, networkingv1.PolicyTypeIngress, np.Spec.PolicyTypes[0])

	require.Len(t, np.Spec.Ingress, 1)
	in := np.Spec.Ingress[0]
	require.Len(t, in.From, 1)
	require.NotNil(t, in.From[0].PodSelector)
	assert.Equal(t, "my-instance", in.From[0].PodSelector.MatchLabels[LabelPair])
	assert.Equal(t, RoleAgent, in.From[0].PodSelector.MatchLabels[LabelRole])
	require.Len(t, in.Ports, 1)
	assert.Equal(t, int32(testConfig.EnvoyPort), in.Ports[0].Port.IntVal)
}

// Managed-by label so operators can bulk-list controller-rendered NPs.
func TestBuildAgentEgressNetworkPolicy_ManagedByLabel(t *testing.T) {
	np := BuildAgentEgressNetworkPolicy("my-instance", testConfig, testOwnerCM)
	assert.Equal(t, "platform-controller", np.Labels["agent-platform.ai/managed-by"])
}

// Sanity check the `corev1` import is used (linter).
var _ = corev1.ProtocolTCP
