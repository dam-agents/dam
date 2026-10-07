package reconciler

import (
	"context"
	"fmt"
	"net/netip"

	corev1 "k8s.io/api/core/v1"
	networkingv1 "k8s.io/api/networking/v1"
	"k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/util/intstr"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/util/retry"

	"github.com/dam-agents/dam/packages/controller/pkg/config"
)

func BuildAgentEgressNetworkPolicy(pairKey string, cfg *config.Config, ownerRef metav1.OwnerReference) *networkingv1.NetworkPolicy {
	selectorPair, gatewayPair := pairKey, pairKey
	envoyPort := intstr.FromInt(cfg.EnvoyPort)
	tcp := corev1.ProtocolTCP

	egress := []networkingv1.NetworkPolicyEgressRule{{
		To: []networkingv1.NetworkPolicyPeer{{
			PodSelector: &metav1.LabelSelector{
				MatchLabels: map[string]string{
					LabelPair: gatewayPair,
					LabelRole: RoleGateway,
				},
			},
		}},
		Ports: []networkingv1.NetworkPolicyPort{
			{Protocol: &tcp, Port: &envoyPort},
		},
	}}

	return &networkingv1.NetworkPolicy{
		ObjectMeta: metav1.ObjectMeta{
			Name:      selectorPair + "-agent-egress",
			Namespace: cfg.Namespace,
			Labels: map[string]string{
				LabelAgent:                     selectorPair,
				LabelPair:                      selectorPair,
				LabelRole:                      RoleAgent,
				"agent-platform.ai/managed-by": "platform-controller",
			},
			OwnerReferences: []metav1.OwnerReference{ownerRef},
		},
		Spec: networkingv1.NetworkPolicySpec{
			PodSelector: metav1.LabelSelector{
				MatchLabels: map[string]string{
					LabelPair: selectorPair,
					LabelRole: RoleAgent,
				},
			},
			PolicyTypes: []networkingv1.PolicyType{networkingv1.PolicyTypeEgress},
			Egress:      egress,
		},
	}
}

// UNIT_BOUNDARY_DESCRIPTION: a gateway injects its owner's credentials into whatever reaches its proxy port, so the only callers it may admit are the ones it serves — its paired agent pod, and for a vm agent the owner's VM runner, which dials it on each machine's behalf, on the proxy port and on the resolver the machine reaches without proxy settings. Without this, each caller's own egress policy is the only gate, so any pod whose egress reaches the gateway — a runner a guest has escaped into, or any other pod in the namespace — gets another owner's credentials injected. HBONE 15008 is not admitted: nothing dials a gateway over the mesh.
func BuildGatewayIngressNetworkPolicy(pairKey, owner string, vm bool, cfg *config.Config, ownerRef metav1.OwnerReference) *networkingv1.NetworkPolicy {
	envoyPort := intstr.FromInt(cfg.EnvoyPort)
	tcp := corev1.ProtocolTCP
	from := []networkingv1.NetworkPolicyPeer{{
		PodSelector: &metav1.LabelSelector{MatchLabels: map[string]string{LabelPair: pairKey, LabelRole: RoleAgent}},
	}}
	ingress := []networkingv1.NetworkPolicyIngressRule{{
		From:  from,
		Ports: []networkingv1.NetworkPolicyPort{{Protocol: &tcp, Port: &envoyPort}},
	}}
	if vm && owner != "" {
		runner := networkingv1.NetworkPolicyPeer{PodSelector: &metav1.LabelSelector{MatchLabels: vmRunnerSelector(owner)}}
		ingress[0].From = append(ingress[0].From, runner)
		ingress = append(ingress, networkingv1.NetworkPolicyIngressRule{
			From:  []networkingv1.NetworkPolicyPeer{runner},
			Ports: machineGatewayPolicyPorts(),
		})
	}
	return &networkingv1.NetworkPolicy{
		ObjectMeta: metav1.ObjectMeta{
			Name:      pairKey + "-gateway-ingress",
			Namespace: cfg.Namespace,
			Labels: map[string]string{
				LabelAgent:                     pairKey,
				LabelPair:                      pairKey,
				LabelRole:                      RoleGateway,
				"agent-platform.ai/managed-by": "platform-controller",
			},
			OwnerReferences: []metav1.OwnerReference{ownerRef},
		},
		Spec: networkingv1.NetworkPolicySpec{
			PodSelector: metav1.LabelSelector{MatchLabels: map[string]string{LabelPair: pairKey, LabelRole: RoleGateway}},
			PolicyTypes: []networkingv1.PolicyType{networkingv1.PolicyTypeIngress},
			Ingress:     ingress,
		},
	}
}

// UNIT_BOUNDARY_DESCRIPTION: ext_authz decides on the host name an agent asks for, and Envoy then resolves that name and dials whatever address comes back, so an approved name that resolves to a private address — by its owner's DNS record or by rebinding after approval — would carry the agent into the cluster, the node, or the cloud metadata endpoint. The kernel closes that path whatever a name resolves to: the gateway reaches the public internet, minus the private, loopback, link-local, CGNAT and this-network ranges. Inside the network it reaches only what its own clusters dial: the cluster DNS pods, the api-server on ext-authz and harness, the harness waypoint, the object store and the telemetry collector, each on its own port and on HBONE 15008, because the gateway is in the ambient mesh and ztunnel carries its in-mesh hops there. The ranges an install opens for its enterprise services come on top, with the metadata endpoints excepted inside them.
func BuildGatewayEgressNetworkPolicy(pairKey string, cfg *config.Config, ownerRef metav1.OwnerReference) *networkingv1.NetworkPolicy {
	tcp := corev1.ProtocolTCP
	tcpPorts := func(ports ...int) []networkingv1.NetworkPolicyPort {
		out := make([]networkingv1.NetworkPolicyPort, 0, len(ports))
		for _, p := range ports {
			port := intstr.FromInt(p)
			out = append(out, networkingv1.NetworkPolicyPort{Protocol: &tcp, Port: &port})
		}
		return out
	}
	platformPods := func(labels map[string]string) []networkingv1.NetworkPolicyPeer {
		return []networkingv1.NetworkPolicyPeer{{
			NamespaceSelector: &metav1.LabelSelector{MatchLabels: map[string]string{"kubernetes.io/metadata.name": cfg.ReleaseNamespace}},
			PodSelector:       &metav1.LabelSelector{MatchLabels: labels},
		}}
	}
	component := func(name string) map[string]string {
		return map[string]string{"app.kubernetes.io/component": name, "app.kubernetes.io/instance": cfg.APIServerInstanceLabel}
	}
	egress := []networkingv1.NetworkPolicyEgressRule{
		{To: []networkingv1.NetworkPolicyPeer{
			{IPBlock: &networkingv1.IPBlock{CIDR: "0.0.0.0/0", Except: gatewayNonPublicIPv4}},
			{IPBlock: &networkingv1.IPBlock{CIDR: "::/0", Except: gatewayNonPublicIPv6}},
		}},
		{To: platformPods(component("apiserver")), Ports: tcpPorts(cfg.ExtAuthzPort, cfg.HarnessServerPort, hbonePort)},
		{To: platformPods(map[string]string{"gateway.networking.k8s.io/gateway-name": cfg.IstioWaypointName}), Ports: tcpPorts(hbonePort)},
	}
	if cfg.ObjectStoreHost != "" {
		egress = append(egress, networkingv1.NetworkPolicyEgressRule{To: platformPods(component("seaweedfs")), Ports: tcpPorts(cfg.ObjectStorePort, hbonePort)})
	}
	if cfg.TelemetryEnabled() {
		ports := []int{cfg.TelemetryCollectorPort, hbonePort}
		if exp, ok := cfg.OTelExporter(); ok {
			ports = append(ports, exp.Port)
		}
		egress = append(egress, networkingv1.NetworkPolicyEgressRule{To: platformPods(component("clickstack-collector")), Ports: tcpPorts(ports...)})
	}
	if dns := cfg.GatewayEgress.ClusterDNS; dns.Namespace != "" && len(dns.PodLabels) > 0 {
		udp := corev1.ProtocolUDP
		rule := networkingv1.NetworkPolicyEgressRule{To: []networkingv1.NetworkPolicyPeer{{
			NamespaceSelector: &metav1.LabelSelector{MatchLabels: map[string]string{"kubernetes.io/metadata.name": dns.Namespace}},
			PodSelector:       &metav1.LabelSelector{MatchLabels: dns.PodLabels},
		}}}
		ports := dns.Ports
		if len(ports) == 0 {
			ports = []int32{53}
		}
		for _, p := range ports {
			port := intstr.FromInt32(p)
			rule.Ports = append(rule.Ports, networkingv1.NetworkPolicyPort{Protocol: &udp, Port: &port}, networkingv1.NetworkPolicyPort{Protocol: &tcp, Port: &port})
		}
		egress = append(egress, rule)
	}
	for _, cidr := range cfg.GatewayEgress.ExtraCIDRs {
		except, metadata := exceptMetadata(cidr, nil, gatewayMetadataCIDRs)
		if metadata {
			continue
		}
		egress = append(egress, networkingv1.NetworkPolicyEgressRule{
			To: []networkingv1.NetworkPolicyPeer{{IPBlock: &networkingv1.IPBlock{CIDR: cidr, Except: except}}},
		})
	}
	return &networkingv1.NetworkPolicy{
		ObjectMeta: metav1.ObjectMeta{
			Name:      pairKey + "-gateway-egress",
			Namespace: cfg.Namespace,
			Labels: map[string]string{
				LabelAgent:                     pairKey,
				LabelPair:                      pairKey,
				LabelRole:                      RoleGateway,
				"agent-platform.ai/managed-by": "platform-controller",
			},
			OwnerReferences: []metav1.OwnerReference{ownerRef},
		},
		Spec: networkingv1.NetworkPolicySpec{
			PodSelector: metav1.LabelSelector{MatchLabels: map[string]string{LabelPair: pairKey, LabelRole: RoleGateway}},
			PolicyTypes: []networkingv1.PolicyType{networkingv1.PolicyTypeEgress},
			Egress:      egress,
		},
	}
}

const hbonePort = 15008

var (
	gatewayNonPublicIPv4 = []string{"0.0.0.0/8", "10.0.0.0/8", "100.64.0.0/10", "127.0.0.0/8", "169.254.0.0/16", "172.16.0.0/12", "192.168.0.0/16"}
	gatewayNonPublicIPv6 = []string{"::1/128", "fc00::/7", "fe80::/10"}
)

// UNIT_BOUNDARY_DESCRIPTION: the cloud metadata endpoints themselves, which stay closed inside any range an install opens for its gateways. They are single addresses rather than all of link-local, so an install can still open a node-local resolver such as 169.254.20.10.
var gatewayMetadataCIDRs = []netip.Prefix{
	netip.MustParsePrefix("169.254.169.254/32"),
	netip.MustParsePrefix("100.100.100.200/32"),
	netip.MustParsePrefix("fd00:ec2::254/128"),
}

func applyNetworkPolicy(ctx context.Context, client kubernetes.Interface, desired *networkingv1.NetworkPolicy) error {
	cli := client.NetworkingV1().NetworkPolicies(desired.Namespace)
	err := retry.RetryOnConflict(retry.DefaultRetry, func() error {
		existing, err := cli.Get(ctx, desired.Name, metav1.GetOptions{})
		if errors.IsNotFound(err) {
			_, err = cli.Create(ctx, desired, metav1.CreateOptions{})
			return err
		}
		if err != nil {
			return err
		}
		desired.ResourceVersion = existing.ResourceVersion
		_, err = cli.Update(ctx, desired, metav1.UpdateOptions{})
		return err
	})
	if err != nil {
		return fmt.Errorf("applying NetworkPolicy %s: %w", desired.Name, err)
	}
	return nil
}
