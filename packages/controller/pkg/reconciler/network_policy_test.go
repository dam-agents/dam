package reconciler

import (
	"fmt"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	corev1 "k8s.io/api/core/v1"
	networkingv1 "k8s.io/api/networking/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/util/intstr"

	"github.com/dam-agents/dam/packages/controller/pkg/config"
)

// TEST_SCENARIO: a machine's traffic leaves from the owner's VM runner, so its gateway admits that runner on the proxy port — and only that owner's runner, because a guest that escapes into another owner's runner must not reach this gateway.
func TestGatewayIngressAdmitsTheOwnersRunnerForAVMAgent(t *testing.T) {
	np := BuildGatewayIngressNetworkPolicy("my-instance", testOwner, testConfig, configMapOwnerRef(testOwnerCM))

	require.Len(t, np.Spec.Ingress, 2)
	from := np.Spec.Ingress[0].From
	require.Len(t, from, 1, "the owner's runner alone: no pod carries the agent role any more")
	assert.Equal(t, vmRunnerSelector(testOwner), from[0].PodSelector.MatchLabels)
	assert.Equal(t, testOwner, from[0].PodSelector.MatchLabels[envoyOwnerLabel])
}

// TEST_SCENARIO: a machine reaches its gateway without proxy settings on the proxy port, which the runner is already admitted on, and on the machine resolver, only through the owner's runner.
func TestGatewayIngressAdmitsTheMachinesTransparentPortsFromItsRunnerOnly(t *testing.T) {
	np := BuildGatewayIngressNetworkPolicy("my-instance", testOwner, testConfig, configMapOwnerRef(testOwnerCM))

	machine := np.Spec.Ingress[1]
	require.Len(t, machine.From, 1)
	assert.Equal(t, vmRunnerSelector(testOwner), machine.From[0].PodSelector.MatchLabels)
	var got []string
	for _, p := range machine.Ports {
		got = append(got, fmt.Sprintf("%s/%d", *p.Protocol, p.Port.IntVal))
	}
	assert.ElementsMatch(t, []string{"UDP/10053", "TCP/10053"}, got)

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

func TestGatewayEgressAdmitsOperatorPeersOnTheirPortsAndHBONEOnlyInMesh(t *testing.T) {
	cfg := *testConfig
	peer := config.GatewayEgressPeer{Namespace: "gpu", PodLabels: map[string]string{"app": "llm"}, Ports: []int32{8000}}
	tcp := corev1.ProtocolTCP
	port, hbone := intstr.FromInt(8000), intstr.FromInt(hbonePort)
	to := []networkingv1.NetworkPolicyPeer{{
		NamespaceSelector: &metav1.LabelSelector{MatchLabels: map[string]string{"kubernetes.io/metadata.name": "gpu"}},
		PodSelector:       &metav1.LabelSelector{MatchLabels: map[string]string{"app": "llm"}},
	}}
	cfg.GatewayEgress.Peers = []config.GatewayEgressPeer{peer}
	np := BuildGatewayEgressNetworkPolicy("my-instance", &cfg, configMapOwnerRef(testOwnerCM))
	assert.Contains(t, np.Spec.Egress, networkingv1.NetworkPolicyEgressRule{To: to, Ports: []networkingv1.NetworkPolicyPort{{Protocol: &tcp, Port: &port}}})
	peer.Mesh = true
	cfg.GatewayEgress.Peers = []config.GatewayEgressPeer{peer}
	assert.Contains(t, BuildGatewayEgressNetworkPolicy("my-instance", &cfg, configMapOwnerRef(testOwnerCM)).Spec.Egress,
		networkingv1.NetworkPolicyEgressRule{To: to, Ports: []networkingv1.NetworkPolicyPort{{Protocol: &tcp, Port: &port}, {Protocol: &tcp, Port: &hbone}}})
	cfg.GatewayEgress.Peers = nil
	assert.Len(t, BuildGatewayEgressNetworkPolicy("my-instance", &cfg, configMapOwnerRef(testOwnerCM)).Spec.Egress, len(np.Spec.Egress)-1, "no peer adds no rule")
}

func TestGatewayEgressOpensOperatorRangesButNeverTheMetadataEndpoint(t *testing.T) {
	blocks := ipBlocks(gatewayEgressFor(t, []string{"10.20.0.0/16", "169.254.0.0/16", "fd00::/8", "169.254.169.254/32"}))
	assert.Empty(t, blocks["10.20.0.0/16"])
	assert.Equal(t, []string{"169.254.169.254/32"}, blocks["169.254.0.0/16"])
	assert.Equal(t, []string{"fd00:ec2::254/128"}, blocks["fd00::/8"])
	assert.NotContains(t, blocks, "169.254.169.254/32", "a range that is only the metadata endpoint is dropped")
}
