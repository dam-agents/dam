package reconciler

import (
	"fmt"
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

	require.Len(t, np.Spec.Ingress, 2)
	from := np.Spec.Ingress[0].From
	require.Len(t, from, 2, "the paired agent and the owner's runner")
	assert.Equal(t, vmRunnerSelector(testOwner), from[1].PodSelector.MatchLabels)
	assert.Equal(t, testOwner, from[1].PodSelector.MatchLabels[envoyOwnerLabel])
}

// TEST_SCENARIO: a machine reaches its gateway without proxy settings on the proxy port, which the runner is already admitted on, and on the machine resolver, only through the owner's runner. The resolver port is admitted from that runner alone — the proxy rule's other peer, the agent pod a container agent would have, gets nothing new — and a container agent's gateway admits none of them.
func TestGatewayIngressAdmitsTheMachinesTransparentPortsFromItsRunnerOnly(t *testing.T) {
	np := BuildGatewayIngressNetworkPolicy("my-instance", testOwner, true, testConfig, configMapOwnerRef(testOwnerCM))

	machine := np.Spec.Ingress[1]
	require.Len(t, machine.From, 1)
	assert.Equal(t, vmRunnerSelector(testOwner), machine.From[0].PodSelector.MatchLabels)
	var got []string
	for _, p := range machine.Ports {
		got = append(got, fmt.Sprintf("%s/%d", *p.Protocol, p.Port.IntVal))
	}
	assert.ElementsMatch(t, []string{"UDP/10053", "TCP/10053"}, got)

	container := BuildGatewayIngressNetworkPolicy("my-instance", testOwner, false, testConfig, configMapOwnerRef(testOwnerCM))
	require.Len(t, container.Spec.Ingress, 1, "a container agent's gateway keeps the proxy port alone")
}

func gatewayEgressFor(t *testing.T, extra []string) *networkingv1.NetworkPolicy {
	t.Helper()
	cfg := *testConfig
	cfg.APIServerInstanceLabel = "platform"
	cfg.ObjectStoreHost, cfg.ObjectStorePort = "platform-seaweedfs.default.svc.cluster.local", 8333
	cfg.TelemetryCollectorHost, cfg.TelemetryCollectorPort = "platform-clickstack-collector.default.svc.cluster.local", 4318
	cfg.GatewayEgress.ExtraCIDRs = extra
	cfg.GatewayEgress.ClusterDNS.Namespace = "kube-system"
	cfg.GatewayEgress.ClusterDNS.PodLabels = map[string]string{"k8s-app": "kube-dns"}
	return BuildGatewayEgressNetworkPolicy("my-instance", &cfg, configMapOwnerRef(testOwnerCM))
}

func ipBlocks(np *networkingv1.NetworkPolicy) map[string][]string {
	out := map[string][]string{}
	for _, rule := range np.Spec.Egress {
		for _, peer := range rule.To {
			if peer.IPBlock != nil {
				out[peer.IPBlock.CIDR] = peer.IPBlock.Except
			}
		}
	}
	return out
}

func TestGatewayEgressSelectsOnlyThePairedGateway(t *testing.T) {
	np := gatewayEgressFor(t, nil)
	assert.Equal(t, "my-instance-gateway-egress", np.Name)
	assert.Equal(t, map[string]string{LabelPair: "my-instance", LabelRole: RoleGateway}, np.Spec.PodSelector.MatchLabels)
	assert.Equal(t, []networkingv1.PolicyType{networkingv1.PolicyTypeEgress}, np.Spec.PolicyTypes)
}

func TestGatewayEgressReachesThePublicInternetButNoPrivateRange(t *testing.T) {
	blocks := ipBlocks(gatewayEgressFor(t, nil))
	require.Len(t, blocks, 2, "only the two public blocks without operator ranges")
	assert.ElementsMatch(t, []string{"0.0.0.0/8", "10.0.0.0/8", "100.64.0.0/10", "127.0.0.0/8", "169.254.0.0/16", "172.16.0.0/12", "192.168.0.0/16"}, blocks["0.0.0.0/0"])
	assert.ElementsMatch(t, []string{"::1/128", "fc00::/7", "fe80::/10"}, blocks["::/0"])
}

func TestGatewayEgressAdmitsThePlatformPodsItDialsOnTheirPortsOnly(t *testing.T) {
	np := gatewayEgressFor(t, nil)
	ports := map[string][]int32{}
	for _, rule := range np.Spec.Egress {
		for _, peer := range rule.To {
			if peer.PodSelector == nil {
				continue
			}
			key := fmt.Sprint(peer.NamespaceSelector.MatchLabels["kubernetes.io/metadata.name"], "/", peer.PodSelector.MatchLabels)
			for _, p := range rule.Ports {
				ports[key] = append(ports[key], p.Port.IntVal)
			}
		}
	}
	assert.Equal(t, map[string][]int32{
		"default/map[app.kubernetes.io/component:apiserver app.kubernetes.io/instance:platform]":            {4002, 4001, 15008},
		"default/map[gateway.networking.k8s.io/gateway-name:apiserver-waypoint]":                            {15008},
		"default/map[app.kubernetes.io/component:seaweedfs app.kubernetes.io/instance:platform]":            {8333, 15008},
		"default/map[app.kubernetes.io/component:clickstack-collector app.kubernetes.io/instance:platform]": {4318, 15008},
		"kube-system/map[k8s-app:kube-dns]":                                                                 {53, 53},
	}, ports)
}

func TestGatewayEgressOpensOperatorRangesButNeverTheMetadataEndpoint(t *testing.T) {
	blocks := ipBlocks(gatewayEgressFor(t, []string{"10.20.0.0/16", "169.254.0.0/16", "fd00::/8", "169.254.169.254/32"}))
	assert.Empty(t, blocks["10.20.0.0/16"])
	assert.Equal(t, []string{"169.254.169.254/32"}, blocks["169.254.0.0/16"])
	assert.Equal(t, []string{"fd00:ec2::254/128"}, blocks["fd00::/8"])
	assert.NotContains(t, blocks, "169.254.169.254/32", "a range that is only the metadata endpoint is dropped")
}
