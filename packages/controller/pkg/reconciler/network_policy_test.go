package reconciler

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	corev1 "k8s.io/api/core/v1"
	networkingv1 "k8s.io/api/networking/v1"
)

func TestBuildAgentEgressNetworkPolicy_LongLivedPair(t *testing.T) {
	np := BuildAgentEgressNetworkPolicy("my-instance", testConfig, configMapOwnerRef(testOwnerCM))

	assert.Equal(t, "my-instance-agent-egress", np.Name)
	assert.Equal(t, testConfig.Namespace, np.Namespace)
	require.Len(t, np.OwnerReferences, 1)
	assert.Equal(t, "my-instance", np.OwnerReferences[0].Name)

	assert.Equal(t, "my-instance", np.Spec.PodSelector.MatchLabels[LabelPair])
	assert.Equal(t, RoleAgent, np.Spec.PodSelector.MatchLabels[LabelRole])

	require.Len(t, np.Spec.PolicyTypes, 1)
	assert.Equal(t, networkingv1.PolicyTypeEgress, np.Spec.PolicyTypes[0])

	require.Len(t, np.Spec.Egress, 1, "paired gateway only — no DNS, no anything else")

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

func TestBuildAgentEgressNetworkPolicy_NoDNS(t *testing.T) {
	np := BuildAgentEgressNetworkPolicy("my-instance", testConfig, configMapOwnerRef(testOwnerCM))
	for _, rule := range np.Spec.Egress {
		for _, p := range rule.Ports {
			assert.NotEqual(t, int32(53), p.Port.IntVal, "DNS port 53 must not appear")
			assert.NotEqual(t, int32(5353), p.Port.IntVal, "DNS port 5353 must not appear")
		}
	}
}

func TestBuildAgentEgressNetworkPolicy_NoHBONE(t *testing.T) {
	np := BuildAgentEgressNetworkPolicy("my-instance", testConfig, configMapOwnerRef(testOwnerCM))
	for i, rule := range np.Spec.Egress {
		for _, port := range rule.Ports {
			assert.NotEqual(t, int32(15008), port.Port.IntVal,
				"egress rule %d must not admit HBONE 15008", i)
		}
	}
}

func TestBuildAgentEgressNetworkPolicy_ManagedByLabel(t *testing.T) {
	np := BuildAgentEgressNetworkPolicy("my-instance", testConfig, configMapOwnerRef(testOwnerCM))
	assert.Equal(t, "platform-controller", np.Labels["agent-platform.ai/managed-by"])
	assert.Equal(t, "my-instance", np.Labels[LabelAgent])
}
