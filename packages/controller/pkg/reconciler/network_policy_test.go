package reconciler

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	corev1 "k8s.io/api/core/v1"
	networkingv1 "k8s.io/api/networking/v1"
)

// Per-pair NP admits exactly the paired gateway on the Envoy port —
// nothing else, no DNS, no HBONE. Combined with the chart-rendered
// namespace deny-all baseline, this is the only allow rule for the
// agent.
func TestBuildAgentEgressNetworkPolicy_LongLivedPair(t *testing.T) {
	np := BuildAgentEgressNetworkPolicy("my-instance", testConfig, testOwnerCM)

	assert.Equal(t, "my-instance-agent-egress", np.Name)
	assert.Equal(t, testConfig.Namespace, np.Namespace)
	require.Len(t, np.OwnerReferences, 1)
	assert.Equal(t, "my-instance", np.OwnerReferences[0].Name)

	// Selector pins to this pair's agent pod — gateway pod is
	// unaffected (ADR-035 gates its egress at L7 ext_authz).
	assert.Equal(t, "my-instance", np.Spec.PodSelector.MatchLabels[LabelPair])
	assert.Equal(t, RoleAgent, np.Spec.PodSelector.MatchLabels[LabelRole])

	require.Len(t, np.Spec.PolicyTypes, 1)
	assert.Equal(t, networkingv1.PolicyTypeEgress, np.Spec.PolicyTypes[0])

	require.Len(t, np.Spec.Egress, 1, "paired gateway only — no DNS, no anything else")

	// Paired gateway pod — Envoy proxy port only.
	gwRule := np.Spec.Egress[0]
	require.Len(t, gwRule.To, 1)
	require.NotNil(t, gwRule.To[0].PodSelector)
	assert.Equal(t, "my-instance", gwRule.To[0].PodSelector.MatchLabels[LabelPair])
	assert.Equal(t, RoleGateway, gwRule.To[0].PodSelector.MatchLabels[LabelRole])
	require.Len(t, gwRule.Ports, 1, "Envoy proxy port only — HBONE 15008 must NOT be admitted")
	assert.Equal(t, int32(testConfig.EnvoyPort), gwRule.Ports[0].Port.IntVal)
	require.NotNil(t, gwRule.Ports[0].Protocol)
	assert.Equal(t, corev1.ProtocolTCP, *gwRule.Ports[0].Protocol)
}

// Fork pair: same shape, keyed on the fork name (ADR-027 isolation).
func TestBuildAgentEgressNetworkPolicy_Fork(t *testing.T) {
	np := BuildAgentEgressNetworkPolicy("fork-abc", testConfig, testForkOwnerCM)

	assert.Equal(t, "fork-abc-agent-egress", np.Name)
	assert.Equal(t, "fork-abc", np.Spec.PodSelector.MatchLabels[LabelPair])
	assert.Equal(t, RoleAgent, np.Spec.PodSelector.MatchLabels[LabelRole])

	// Gateway peer must scope to the fork's own gateway (ADR-027).
	gwRule := np.Spec.Egress[0]
	require.NotNil(t, gwRule.To[0].PodSelector)
	assert.Equal(t, "fork-abc", gwRule.To[0].PodSelector.MatchLabels[LabelPair],
		"fork agent NP must scope to the fork's own gateway")
}

// DNS deny is structural — proxy is IP-direct.
func TestBuildAgentEgressNetworkPolicy_NoDNS(t *testing.T) {
	np := BuildAgentEgressNetworkPolicy("my-instance", testConfig, testOwnerCM)
	for _, rule := range np.Spec.Egress {
		for _, p := range rule.Ports {
			assert.NotEqual(t, int32(53), p.Port.IntVal, "DNS port 53 must not appear")
			assert.NotEqual(t, int32(5353), p.Port.IntVal, "DNS port 5353 must not appear")
		}
	}
}

// HBONE port 15008 must NOT appear in the agent egress policy.
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
	assert.Equal(t, "my-instance", np.Labels[LabelAgent])
}
