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

// Per-pair agent egress NetworkPolicy (ADR-041 "namespace-level egress
// allowlist" specialised to a single pair).
//
// AuthorizationPolicy on the gateway side already pins ingress to the
// matching SA principal cryptographically — but it is a destination-side
// gate. Without an egress restriction on the agent pod, the agent process
// can bypass HTTPS_PROXY and dial external services directly, escaping
// the Envoy MITM, credential-injection, and ext-authz HITL gates.
// `kernel-level NetworkPolicy` is what closes that loop: it is identity-
// blind but enforces at the L3/L4 perimeter regardless of what the agent
// process does at L7.
//
// Allowed egress:
//   - DNS to kube-system (TCP/UDP 53) — needed for resolving the gateway
//     Service hostname.
//   - The paired gateway pod (`pair=<id>, role=gateway`) on the Envoy
//     proxy port and HBONE 15008. Per-pair selector pins reachability
//     to *this* agent's gateway; mesh AuthorizationPolicy still enforces
//     it cryptographically.
//   - istio-system on HBONE 15008 — covers ambient-mesh routing where
//     istio-cni redirects pod egress to ztunnel before NetworkPolicy
//     enforcement. Without this, in-mesh traffic appears blocked even
//     though the destination is admitted at the AuthorizationPolicy
//     layer. (Mirror of the rationale in `migrate-stale-netpols.yaml`.)
//
// Everything else (external internet, other in-cluster Services) is
// denied at the kernel layer.

// BuildAgentEgressNetworkPolicy renders the per-pair egress NetworkPolicy
// for the agent pod of `pairKey`. Long-lived pairs use the instance name
// as `pairKey`; forks use the fork name. The selector pins to the pair's
// agent pod specifically — the paired gateway pod's egress stays
// unrestricted (it dials external upstreams for credential injection).
func BuildAgentEgressNetworkPolicy(pairKey string, cfg *config.Config, ownerCM *corev1.ConfigMap) *networkingv1.NetworkPolicy {
	envoyPort := intstr.FromInt(cfg.EnvoyPort)
	hbonePort := intstr.FromInt(15008)
	dnsPort := intstr.FromInt(53)
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
					To: []networkingv1.NetworkPolicyPeer{{
						NamespaceSelector: &metav1.LabelSelector{
							MatchLabels: map[string]string{"kubernetes.io/metadata.name": "kube-system"},
						},
					}},
					Ports: []networkingv1.NetworkPolicyPort{
						{Protocol: &udp, Port: &dnsPort},
						{Protocol: &tcp, Port: &dnsPort},
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
						{Protocol: &tcp, Port: &hbonePort},
					},
				},
				{
					To: []networkingv1.NetworkPolicyPeer{{
						NamespaceSelector: &metav1.LabelSelector{
							MatchLabels: map[string]string{"kubernetes.io/metadata.name": "istio-system"},
						},
					}},
					Ports: []networkingv1.NetworkPolicyPort{
						{Protocol: &tcp, Port: &hbonePort},
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
