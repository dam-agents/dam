package reconciler

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	corev1 "k8s.io/api/core/v1"
	networkingv1 "k8s.io/api/networking/v1"
)

// ADR-041: per-pair agent egress NetworkPolicy closes the kernel-level
// perimeter that mesh AuthorizationPolicy can't (AuthorizationPolicy is
// destination-side ingress; without an egress NP the agent process can
// bypass HTTPS_PROXY and dial external hosts directly).
func TestBuildAgentEgressNetworkPolicy_LongLivedPair(t *testing.T) {
	np := BuildAgentEgressNetworkPolicy("my-instance", testConfig, testOwnerCM)

	assert.Equal(t, "my-instance-agent-egress", np.Name)
	assert.Equal(t, testConfig.Namespace, np.Namespace)
	require.Len(t, np.OwnerReferences, 1)
	assert.Equal(t, "my-instance", np.OwnerReferences[0].Name)

	// Selector pins to THIS pair's agent pod — the gateway pod's egress
	// stays unrestricted (it dials external upstreams for credential
	// injection).
	assert.Equal(t, "my-instance", np.Spec.PodSelector.MatchLabels[LabelPair])
	assert.Equal(t, RoleAgent, np.Spec.PodSelector.MatchLabels[LabelRole])

	// Egress only — ingress is governed by mesh AuthorizationPolicy on
	// other workloads.
	require.Len(t, np.Spec.PolicyTypes, 1)
	assert.Equal(t, networkingv1.PolicyTypeEgress, np.Spec.PolicyTypes[0])

	require.Len(t, np.Spec.Egress, 3, "DNS + paired gateway + istio-system HBONE")

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

	// Paired gateway pod — per-pair selector pins reachability; mesh
	// AuthorizationPolicy on the gateway side cryptographically enforces
	// the same boundary on top.
	gwRule := np.Spec.Egress[1]
	require.Len(t, gwRule.To, 1)
	require.NotNil(t, gwRule.To[0].PodSelector)
	assert.Equal(t, "my-instance", gwRule.To[0].PodSelector.MatchLabels[LabelPair])
	assert.Equal(t, RoleGateway, gwRule.To[0].PodSelector.MatchLabels[LabelRole])
	// Envoy proxy port + HBONE 15008 (ambient redirect lands here when
	// istio-cni rewrites the destination port).
	ports := map[int32]bool{}
	for _, p := range gwRule.Ports {
		ports[p.Port.IntVal] = true
	}
	assert.True(t, ports[int32(testConfig.EnvoyPort)], "must allow Envoy proxy port")
	assert.True(t, ports[15008], "must allow HBONE — see migrate-stale-netpols.yaml for the prior incident this guards against")

	// istio-system HBONE — covers the path where istio-cni redirects
	// outbound to ztunnel before NetworkPolicy filter sees it.
	hboneRule := np.Spec.Egress[2]
	require.Len(t, hboneRule.To, 1)
	require.NotNil(t, hboneRule.To[0].NamespaceSelector)
	assert.Equal(t, "istio-system", hboneRule.To[0].NamespaceSelector.MatchLabels["kubernetes.io/metadata.name"])
	require.Len(t, hboneRule.Ports, 1)
	assert.Equal(t, int32(15008), hboneRule.Ports[0].Port.IntVal)
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

// Label-managed-by lets operators bulk-list controller-managed NPs and
// distinguishes them from any chart-rendered namespace-level perimeter.
func TestBuildAgentEgressNetworkPolicy_ManagedByLabel(t *testing.T) {
	np := BuildAgentEgressNetworkPolicy("my-instance", testConfig, testOwnerCM)
	assert.Equal(t, "platform-controller", np.Labels["agent-platform.ai/managed-by"])
	assert.Equal(t, "my-instance", np.Labels[LabelInstance])
}
