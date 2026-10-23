package reconciler

import (
	"context"
	"fmt"
	"maps"
	"net/netip"

	corev1 "k8s.io/api/core/v1"
	networkingv1 "k8s.io/api/networking/v1"
	"k8s.io/apimachinery/pkg/api/equality"
	"k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/util/intstr"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/util/retry"

	"github.com/dam-agents/dam/packages/controller/pkg/config"
)

// UNIT_BOUNDARY_DESCRIPTION: a gateway injects its owner's credentials into whatever reaches its proxy port, so the only callers it may admit are the ones it serves — the owner's VM runner, which dials it on each machine's behalf, on the proxy port and on the resolver the machine reaches without proxy settings. Without this, each caller's own egress policy is the only gate, so any pod whose egress reaches the gateway — a runner a guest has escaped into, or any other pod in the namespace — gets another owner's credentials injected. HBONE 15008 is not admitted: nothing dials a gateway over the mesh.
func BuildGatewayIngressNetworkPolicy(pairKey, owner string, cfg *config.Config, ownerRef metav1.OwnerReference) *networkingv1.NetworkPolicy {
	envoyPort := intstr.FromInt(cfg.EnvoyPort)
	tcp := corev1.ProtocolTCP
	ingress := []networkingv1.NetworkPolicyIngressRule{}
	if owner == "" {
		ingress = append(ingress, networkingv1.NetworkPolicyIngressRule{
			Ports: []networkingv1.NetworkPolicyPort{{Protocol: &tcp, Port: &envoyPort}},
		})
	} else {
		runner := networkingv1.NetworkPolicyPeer{PodSelector: &metav1.LabelSelector{MatchLabels: vmRunnerSelector(owner)}}
		ingress = append(ingress, networkingv1.NetworkPolicyIngressRule{
			From:  []networkingv1.NetworkPolicyPeer{runner},
			Ports: []networkingv1.NetworkPolicyPort{{Protocol: &tcp, Port: &envoyPort}},
		}, networkingv1.NetworkPolicyIngressRule{
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

// UNIT_BOUNDARY_DESCRIPTION: ext_authz decides on the host name an agent asks for, and Envoy then resolves that name and dials whatever address comes back, so an approved name that resolves to a private address — by its owner's DNS record or by rebinding after approval — would carry the agent into the cluster, the node, or the cloud metadata endpoint. The kernel closes that path whatever a name resolves to: the gateway reaches the public internet, minus the private, loopback, link-local, CGNAT and this-network ranges. Inside the network it reaches only what its own clusters dial: the cluster DNS pods, the api-server on ext-authz and harness, the harness waypoint, the object store and the telemetry collector, each on its own port and on HBONE 15008, because the gateway is in the ambient mesh and ztunnel carries its in-mesh hops there. The in-cluster peers and the ranges an install opens for its enterprise services come on top, each peer on its own ports, plus HBONE for a peer in the mesh, with the metadata endpoints excepted inside the ranges.
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
	for _, peer := range cfg.GatewayEgress.Peers {
		var ports []int
		for _, p := range peer.Ports {
			ports = append(ports, int(p))
		}
		if peer.Mesh {
			ports = append(ports, hbonePort)
		}
		egress = append(egress, networkingv1.NetworkPolicyEgressRule{
			To: []networkingv1.NetworkPolicyPeer{{
				NamespaceSelector: &metav1.LabelSelector{MatchLabels: map[string]string{"kubernetes.io/metadata.name": peer.Namespace}},
				PodSelector:       &metav1.LabelSelector{MatchLabels: peer.PodLabels},
			}},
			Ports: tcpPorts(ports...),
		})
	}
	for _, cidr := range cfg.GatewayEgress.ExtraCIDRs {
		except, metadata := exceptMetadata(cidr)
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

// UNIT_BOUNDARY_DESCRIPTION: every egress block that contains a metadata endpoint has it subtracted, whatever the install listed, so a wide block such as 0.0.0.0/0 never opens the node's credentials by omission. A block lying wholly inside one names the endpoint itself, and is reported so the caller drops it rather than render the one destination this exists to close.
func exceptMetadata(cidr string) ([]string, bool) {
	block, err := netip.ParsePrefix(cidr)
	if err != nil {
		return nil, false
	}
	block = block.Masked()
	var except []string
	for _, m := range gatewayMetadataCIDRs {
		if block.Addr().Is4() != m.Addr().Is4() {
			continue
		}
		if m.Bits() <= block.Bits() && m.Contains(block.Addr()) {
			return nil, true
		}
		if block.Contains(m.Addr()) {
			except = append(except, m.String())
		}
	}
	return except, false
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
		if equality.Semantic.DeepEqual(existing.Spec, desired.Spec) && objectMetaCurrent(existing.ObjectMeta, desired.ObjectMeta) {
			return nil
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

func objectMetaCurrent(existing, desired metav1.ObjectMeta) bool {
	return maps.Equal(existing.Labels, desired.Labels) && maps.Equal(existing.Annotations, desired.Annotations) &&
		equality.Semantic.DeepEqual(existing.OwnerReferences, desired.OwnerReferences)
}
