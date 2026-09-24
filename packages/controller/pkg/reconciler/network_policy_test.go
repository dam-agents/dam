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

// TEST_SCENARIO: a gateway injects its owner's credentials into whatever reaches its proxy port. A container agent's gateway must admit only its paired agent pod, on the proxy port alone — no HBONE, no other pod in the namespace.
func TestGatewayIngressAdmitsOnlyThePairedAgent(t *testing.T) {
	np := BuildGatewayIngressNetworkPolicy("my-instance", testOwner, false, testConfig, configMapOwnerRef(testOwnerCM))

	assert.Equal(t, "my-instance-gateway-ingress", np.Name)
	assert.Equal(t, testConfig.Namespace, np.Namespace)
	require.Len(t, np.OwnerReferences, 1)
	assert.Equal(t, map[string]string{LabelPair: "my-instance", LabelRole: RoleGateway}, np.Spec.PodSelector.MatchLabels)
	assert.Equal(t, []networkingv1.PolicyType{networkingv1.PolicyTypeIngress}, np.Spec.PolicyTypes)

	require.Len(t, np.Spec.Ingress, 1)
	rule := np.Spec.Ingress[0]
	require.Len(t, rule.From, 1, "the paired agent only — not the owner's runner, which serves vm agents")
	assert.Nil(t, rule.From[0].NamespaceSelector, "the peer is in the gateway's own namespace")
	assert.Equal(t, map[string]string{LabelPair: "my-instance", LabelRole: RoleAgent}, rule.From[0].PodSelector.MatchLabels)
	require.Len(t, rule.Ports, 1, "Envoy proxy port only — HBONE 15008 must NOT be admitted")
	assert.Equal(t, int32(testConfig.EnvoyPort), rule.Ports[0].Port.IntVal)
	assert.Equal(t, corev1.ProtocolTCP, *rule.Ports[0].Protocol)
}

// TEST_SCENARIO: a vm agent's traffic leaves from the owner's VM runner, not from an agent pod, so its gateway admits that runner too — and only that owner's runner, because a guest that escapes into another owner's runner must not reach this gateway.
func TestGatewayIngressAdmitsTheOwnersRunnerForAVMAgent(t *testing.T) {
	np := BuildGatewayIngressNetworkPolicy("my-instance", testOwner, true, testConfig, configMapOwnerRef(testOwnerCM))

	require.Len(t, np.Spec.Ingress, 1)
	from := np.Spec.Ingress[0].From
	require.Len(t, from, 2, "the paired agent and the owner's runner")
	assert.Equal(t, vmRunnerSelector(testOwner), from[1].PodSelector.MatchLabels)
	assert.Equal(t, testOwner, from[1].PodSelector.MatchLabels[envoyOwnerLabel])
}
