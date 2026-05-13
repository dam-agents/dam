package reconciler

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	corev1 "k8s.io/api/core/v1"
	networkingv1 "k8s.io/api/networking/v1"
)

// Agent pod opts out of ambient mesh, so kernel NetworkPolicy is the sole
// gate on agent egress. The policy admits exactly DNS + paired gateway
// pod on the Envoy proxy port — nothing else. HBONE port 15008 is
// deliberately denied: the agent has no ztunnel and admitting 15008 would
// give it a route to anything in the mesh.
func TestBuildAgentEgressNetworkPolicy_LongLivedPair(t *testing.T) {
	np := BuildAgentEgressNetworkPolicy("my-instance", testConfig, testOwnerCM)

	assert.Equal(t, "my-instance-agent-egress", np.Name)
	assert.Equal(t, testConfig.Namespace, np.Namespace)
	require.Len(t, np.OwnerReferences, 1)
	assert.Equal(t, "my-instance", np.OwnerReferences[0].Name)

	// Selector pins to THIS pair's agent pod — the gateway pod's egress
	// stays unrestricted (it dials external upstreams for credential
	// injection, gated by ext_authz inside its own Envoy).
	assert.Equal(t, "my-instance", np.Spec.PodSelector.MatchLabels[LabelPair])
	assert.Equal(t, RoleAgent, np.Spec.PodSelector.MatchLabels[LabelRole])

	require.Len(t, np.Spec.PolicyTypes, 1)
	assert.Equal(t, networkingv1.PolicyTypeEgress, np.Spec.PolicyTypes[0])

	require.Len(t, np.Spec.Egress, 2, "DNS + paired gateway, nothing else")

	// DNS to kube-system (resolving the gateway Service hostname).
	dnsRule := np.Spec.Egress[0]
	require.Len(t, dnsRule.To, 1)
	require.NotNil(t, dnsRule.To[0].NamespaceSelector)
	assert.Equal(t, "kube-system", dnsRule.To[0].NamespaceSelector.MatchLabels["kubernetes.io/metadata.name"])
	assert.Len(t, dnsRule.Ports, 2, "both UDP/53 and TCP/53 — modern resolvers fall through to TCP")
	protocols := map[corev1.Protocol]bool{}
	for _, p := range dnsRule.Ports {
		protocols[*p.Protocol] = true
		assert.Equal(t, int32(53), p.Port.IntVal)
	}
	assert.True(t, protocols[corev1.ProtocolUDP] && protocols[corev1.ProtocolTCP])

	// Paired gateway pod — Envoy proxy port only.
	gwRule := np.Spec.Egress[1]
	require.Len(t, gwRule.To, 1)
	require.NotNil(t, gwRule.To[0].PodSelector)
	assert.Equal(t, "my-instance", gwRule.To[0].PodSelector.MatchLabels[LabelPair])
	assert.Equal(t, RoleGateway, gwRule.To[0].PodSelector.MatchLabels[LabelRole])
	require.Len(t, gwRule.Ports, 1, "Envoy proxy port only — HBONE 15008 must NOT be admitted")
	assert.Equal(t, int32(testConfig.EnvoyPort), gwRule.Ports[0].Port.IntVal)
	require.NotNil(t, gwRule.Ports[0].Protocol)
	assert.Equal(t, corev1.ProtocolTCP, *gwRule.Ports[0].Protocol)
}

// Fork pair: same shape, keyed on the fork name. ADR-027's fork-pair
// isolation property only holds because the agent NP scopes the agent's
// egress to its OWN gateway — without this, a compromised fork agent
// could dial the parent's gateway directly.
func TestBuildAgentEgressNetworkPolicy_Fork(t *testing.T) {
	np := BuildAgentEgressNetworkPolicy("fork-abc", testConfig, testForkOwnerCM)

	assert.Equal(t, "fork-abc-agent-egress", np.Name)
	assert.Equal(t, "fork-abc", np.Spec.PodSelector.MatchLabels[LabelPair])
	assert.Equal(t, RoleAgent, np.Spec.PodSelector.MatchLabels[LabelRole])

	// The gateway-pod egress rule must reference the FORK's gateway, not
	// the parent's — otherwise the fork agent could reach the parent's
	// gateway and inject under the parent owner's credentials.
	gwRule := np.Spec.Egress[1]
	require.NotNil(t, gwRule.To[0].PodSelector)
	assert.Equal(t, "fork-abc", gwRule.To[0].PodSelector.MatchLabels[LabelPair],
		"fork agent NP must scope to the FORK's gateway, not the parent's")
}

// HBONE port 15008 must NOT appear anywhere in the agent egress policy.
// The agent has no ztunnel and never speaks HBONE; admitting 15008 here
// would let the agent reach any in-mesh destination via ztunnel.
func TestBuildAgentEgressNetworkPolicy_NoHBONE(t *testing.T) {
	np := BuildAgentEgressNetworkPolicy("my-instance", testConfig, testOwnerCM)
	for i, rule := range np.Spec.Egress {
		for _, port := range rule.Ports {
			assert.NotEqual(t, int32(15008), port.Port.IntVal,
				"egress rule %d must not admit HBONE 15008", i)
		}
	}
}

// Label-managed-by lets operators bulk-list controller-managed NPs and
// distinguishes them from any chart-rendered namespace-level perimeter.
func TestBuildAgentEgressNetworkPolicy_ManagedByLabel(t *testing.T) {
	np := BuildAgentEgressNetworkPolicy("my-instance", testConfig, testOwnerCM)
	assert.Equal(t, "platform-controller", np.Labels["agent-platform.ai/managed-by"])
	assert.Equal(t, "my-instance", np.Labels[LabelInstance])
}
