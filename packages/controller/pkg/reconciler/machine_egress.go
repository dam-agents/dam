package reconciler

import (
	corev1 "k8s.io/api/core/v1"
	networkingv1 "k8s.io/api/networking/v1"
	"k8s.io/apimachinery/pkg/api/resource"
	"k8s.io/apimachinery/pkg/util/intstr"

	"github.com/dam-agents/dam/packages/controller/pkg/config"
)

// UNIT_BOUNDARY_DESCRIPTION: transparent egress for a vm Agent's machine. Everything in a machine — the harness, docker containers and builds, k3s pods, a platform nested inside — reaches the network through its gateway without proxy settings: the runner points smolvm's relay of every guest DNS query at the gateway's resolver, which answers every name with the gateway's own address, and the gateway accepts TLS routed by SNI and plain HTTP routed by Host on the ordinary ports. The DNS answer grants nothing: a connection lands in the same chains a CONNECT does, where every chain that dials a host of the agent's choosing checks egress first, so a never-approved host is held for approval exactly as through the proxy. The resolver never forwards or recurses, so no query name leaves the gateway, and a denied host is never resolved anywhere. Container Agents keep the explicit proxy only.
const (
	gatewayTransparentTLSPort = 10443
	gatewayMachineDNSPort     = 10053
	machineDNSCorefileKey     = "Corefile"
	machineDNSGatewayIPEnv    = "GATEWAY_IP"
)

// UNIT_BOUNDARY_DESCRIPTION: A gets the gateway's own address, AAAA an empty answer so clients fall back to IPv4, and every other type is refused. There is no forward plugin, so nothing is ever resolved upstream, and no log plugin, because a query name can carry data the agent should not get to write anywhere.
const machineDNSCorefile = `.:10053 {
    template IN A {
        answer "{{ .Name }} 60 IN A {$` + machineDNSGatewayIPEnv + `}"
    }
    template IN AAAA {
        rcode NOERROR
    }
    template ANY ANY {
        rcode REFUSED
    }
}
`

// UNIT_BOUNDARY_DESCRIPTION: the machine's resolver, beside Envoy in the gateway pod. It answers from the address the controller hands it rather than from anything the machine says. CoreDNS's binary carries the bind capability as a file capability, and the kernel refuses to exec such a file when the capability is outside the container's bounding set, so NET_BIND_SERVICE is the one capability kept.
func machineDNSContainer(cfg *config.Config, gatewayIP string) corev1.Container {
	return corev1.Container{
		Name:            "machine-dns",
		Image:           cfg.MachineDNSImage,
		ImagePullPolicy: corev1.PullIfNotPresent,
		Args:            []string{"-conf", envoyBootstrapMount + "/" + machineDNSCorefileKey},
		Env:             []corev1.EnvVar{{Name: machineDNSGatewayIPEnv, Value: gatewayIP}},
		Ports: []corev1.ContainerPort{
			{Name: "dns", ContainerPort: gatewayMachineDNSPort, Protocol: corev1.ProtocolUDP},
			{Name: "dns-tcp", ContainerPort: gatewayMachineDNSPort, Protocol: corev1.ProtocolTCP},
		},
		VolumeMounts: []corev1.VolumeMount{{Name: envoyBootstrapVolume, MountPath: envoyBootstrapMount, ReadOnly: true}},
		Resources: corev1.ResourceRequirements{
			Requests: corev1.ResourceList{
				corev1.ResourceCPU:    resource.MustParse("10m"),
				corev1.ResourceMemory: resource.MustParse("16Mi"),
			},
		},
		SecurityContext: &corev1.SecurityContext{
			Capabilities: &corev1.Capabilities{
				Drop: []corev1.Capability{"ALL"},
				Add:  []corev1.Capability{"NET_BIND_SERVICE"},
			},
			AllowPrivilegeEscalation: new(false),
			ReadOnlyRootFilesystem:   new(true),
			RunAsNonRoot:             new(true),
		},
	}
}

// UNIT_BOUNDARY_DESCRIPTION: raw TLS arriving on the transparent port is handed to the same internal listener a CONNECT tunnel is unwrapped into, so it reaches exactly what a CONNECT reaches. Every chain there that dials a host of the agent's choosing checks egress first — the credential and path-rule chains in their HTTP filters, and the SNI-miss chain that holds a never-approved host for approval. The telemetry collector's chain has no check and reaches only the platform's own collector, as a CONNECT to it does. This listener adds a way in and no way around any of them.
func buildTransparentTLSListener(p bootstrapParams) ev {
	return ev{
		"name":    "transparent_tls",
		"address": ev{"socket_address": ev{"address": p.ListenAddress, "port_value": gatewayTransparentTLSPort}},
		"filter_chains": []any{
			ev{"filters": []any{ev{
				"name": "envoy.filters.network.tcp_proxy",
				"typed_config": ev{
					"@type":       "type.googleapis.com/envoy.extensions.filters.network.tcp_proxy.v3.TcpProxy",
					"stat_prefix": "transparent_tls",
					"cluster":     "tls_inspect_internal",
				},
			}}},
		},
	}
}

// UNIT_BOUNDARY_DESCRIPTION: the ports a machine reaches its gateway on once every name resolves to the gateway. Plain HTTP goes to the proxy listener itself, which already routes an ordinary request by its Host through the same egress check as an absolute-form one.
func machineGatewayServicePorts(cfg *config.Config) []corev1.ServicePort {
	return []corev1.ServicePort{
		{Name: "http", Port: 80, TargetPort: intstr.FromInt32(portInt32(cfg.EnvoyPort)), Protocol: corev1.ProtocolTCP},
		{Name: "tls", Port: 443, TargetPort: intstr.FromInt32(gatewayTransparentTLSPort), Protocol: corev1.ProtocolTCP},
		{Name: "dns", Port: 53, TargetPort: intstr.FromInt32(gatewayMachineDNSPort), Protocol: corev1.ProtocolUDP},
		{Name: "dns-tcp", Port: 53, TargetPort: intstr.FromInt32(gatewayMachineDNSPort), Protocol: corev1.ProtocolTCP},
	}
}

// UNIT_BOUNDARY_DESCRIPTION: the gateway pod ports the machine's traffic arrives at, after the Service has mapped it. NetworkPolicy is evaluated against these rather than the Service ports, so both the gateway's ingress policy and its runner's egress policy name exactly this list beside the proxy port.
func machineGatewayPolicyPorts() []networkingv1.NetworkPolicyPort {
	tcp, udp := corev1.ProtocolTCP, corev1.ProtocolUDP
	tls, dns := intstr.FromInt(gatewayTransparentTLSPort), intstr.FromInt(gatewayMachineDNSPort)
	return []networkingv1.NetworkPolicyPort{
		{Protocol: &tcp, Port: &tls},
		{Protocol: &udp, Port: &dns},
		{Protocol: &tcp, Port: &dns},
	}
}
