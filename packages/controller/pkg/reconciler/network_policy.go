package reconciler

import (
	"context"
	"fmt"

	corev1 "k8s.io/api/core/v1"
	networkingv1 "k8s.io/api/networking/v1"
	"k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/util/intstr"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/util/retry"

	"github.com/kagenti/platform/packages/controller/pkg/config"
)

// Per-pair agent egress NetworkPolicy.
//
// The agent pod opts out of ambient mesh (`istio.io/dataplane-mode: none`),
// so no ztunnel iptables redirect intercepts its outbound traffic. Real
// destination IP/port hit the kernel NetworkPolicy filter, and the agent
// pod's only admitted intra-cluster destination is its paired gateway pod.
// All egress that matters — external upstreams, harness, ext-authz — is
// proxied through the gateway, gated by Envoy's ext_authz filter (ADR-035).
//
// Allowed egress:
//   - DNS to `kube-system` on UDP/TCP 53. CoreDNS / kube-dns pods on
//     upstream Kubernetes listen on 53 directly, so the kernel sees
//     53 as the destination port after kube-proxy translation.
//   - DNS to `openshift-dns` on UDP/TCP 5353. OpenShift's `dns-default`
//     pods listen on 5353; the cluster DNS Service (172.30.0.10:53)
//     targets pod port 5353, and NetworkPolicy evaluates pod-IP and
//     pod-port after kube-proxy translation, not the Service port.
//     Pinning to 53 here would silently drop every lookup on
//     OpenShift. Both rules are admitted; a given cluster runs DNS in
//     only one of these namespaces, so the unused rule is harmless.
//   - The paired gateway pod (`pair=<id>, role=gateway`) on the Envoy
//     proxy port only. The per-pair selector pins reachability to *this*
//     agent's gateway; the gateway pod itself is the only structural
//     gate (NP is identity-blind, but L3/L4-pinned to one pod set).
//
// HBONE port 15008 is deliberately NOT admitted. The agent has no ztunnel
// and never speaks HBONE; opening 15008 here would just hand the agent a
// bypass to anything in the mesh.
//
// Everything else (external internet, other in-cluster Services like
// Postgres / Redis / Keycloak, the harness and ext-authz Services
// directly) is denied at the kernel layer.

// BuildAgentEgressNetworkPolicy renders the per-pair egress NetworkPolicy
// for the agent pod of `pairKey`. Long-lived pairs use the instance name
// as `pairKey`; forks use the fork name. The selector pins to the pair's
// agent pod specifically — the paired gateway pod's egress stays
// unrestricted (it dials external upstreams for credential injection).
func BuildAgentEgressNetworkPolicy(pairKey string, cfg *config.Config, ownerCM *corev1.ConfigMap) *networkingv1.NetworkPolicy {
	envoyPort := intstr.FromInt(cfg.EnvoyPort)
	corednsPort := intstr.FromInt(53)
	openshiftDNSPort := intstr.FromInt(5353)
	tcp := corev1.ProtocolTCP
	udp := corev1.ProtocolUDP

	return &networkingv1.NetworkPolicy{
		ObjectMeta: metav1.ObjectMeta{
			Name:      pairKey + "-agent-egress",
			Namespace: cfg.Namespace,
			Labels: map[string]string{
				LabelInstance:                  pairKey,
				LabelPair:                      pairKey,
				LabelRole:                      RoleAgent,
				"agent-platform.ai/managed-by": "platform-controller",
			},
			OwnerReferences: []metav1.OwnerReference{
				*metav1.NewControllerRef(ownerCM, corev1.SchemeGroupVersion.WithKind("ConfigMap")),
			},
		},
		Spec: networkingv1.NetworkPolicySpec{
			PodSelector: metav1.LabelSelector{
				MatchLabels: map[string]string{
					LabelPair: pairKey,
					LabelRole: RoleAgent,
				},
			},
			PolicyTypes: []networkingv1.PolicyType{networkingv1.PolicyTypeEgress},
			Egress: []networkingv1.NetworkPolicyEgressRule{
				{
					// Upstream Kubernetes: CoreDNS / kube-dns in
					// `kube-system` listening on pod port 53.
					To: []networkingv1.NetworkPolicyPeer{{
						NamespaceSelector: &metav1.LabelSelector{
							MatchLabels: map[string]string{"kubernetes.io/metadata.name": "kube-system"},
						},
					}},
					Ports: []networkingv1.NetworkPolicyPort{
						{Protocol: &udp, Port: &corednsPort},
						{Protocol: &tcp, Port: &corednsPort},
					},
				},
				{
					// OpenShift: `dns-default` pods in `openshift-dns`
					// listen on pod port 5353. NetworkPolicy filters on
					// pod port after kube-proxy translation, so the
					// upstream rule (53) does not match here.
					To: []networkingv1.NetworkPolicyPeer{{
						NamespaceSelector: &metav1.LabelSelector{
							MatchLabels: map[string]string{"kubernetes.io/metadata.name": "openshift-dns"},
						},
					}},
					Ports: []networkingv1.NetworkPolicyPort{
						{Protocol: &udp, Port: &openshiftDNSPort},
						{Protocol: &tcp, Port: &openshiftDNSPort},
					},
				},
				{
					// Bare PodSelector with no NamespaceSelector implicitly
					// scopes to the policy's own namespace — correct today
					// since agent + gateway pods of a pair share
					// `cfg.Namespace`. If pods ever split across namespaces
					// this peer must grow a NamespaceSelector or the rule
					// silently denies the legitimate egress path.
					To: []networkingv1.NetworkPolicyPeer{{
						PodSelector: &metav1.LabelSelector{
							MatchLabels: map[string]string{
								LabelPair: pairKey,
								LabelRole: RoleGateway,
							},
						},
					}},
					Ports: []networkingv1.NetworkPolicyPort{
						{Protocol: &tcp, Port: &envoyPort},
					},
				},
			},
		},
	}
}

// applyNetworkPolicy creates or updates a NetworkPolicy. Mirrors
// applyAuthorizationPolicy / applyServiceAccount shape.
func applyNetworkPolicy(ctx context.Context, client kubernetes.Interface, desired *networkingv1.NetworkPolicy) error {
	cli := client.NetworkingV1().NetworkPolicies(desired.Namespace)
	return retry.RetryOnConflict(retry.DefaultRetry, func() error {
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
}

func (r *InstanceReconciler) applyAgentEgressNetworkPolicy(ctx context.Context, np *networkingv1.NetworkPolicy) error {
	if err := applyNetworkPolicy(ctx, r.client, np); err != nil {
		return fmt.Errorf("applying agent egress NetworkPolicy: %w", err)
	}
	return nil
}

func (r *ForkReconciler) applyAgentEgressNetworkPolicy(ctx context.Context, np *networkingv1.NetworkPolicy) error {
	if err := applyNetworkPolicy(ctx, r.client, np); err != nil {
		return fmt.Errorf("applying fork agent egress NetworkPolicy: %w", err)
	}
	return nil
}
