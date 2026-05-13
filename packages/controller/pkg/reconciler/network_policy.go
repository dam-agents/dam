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

// Per-pair agent ↔ gateway NetworkPolicies.
//
// ADR-042 hybrid model: agent pods opt out of ambient mesh
// (`istio.io/dataplane-mode: none` at the pod template), so the only
// boundary between agent and the rest of the cluster is the kernel
// NetworkPolicy filter — there is no ztunnel redirect to obscure the
// destination, no mesh AuthorizationPolicy on the agent pod's
// ingress, no waypoint to route through. The agent's structural
// guarantee is "kernel L3/L4 only admits the paired gateway pod (and
// DNS)." Gateway pod stays in ambient and keeps all its mesh AuthZ
// for outbound destinations.
//
// Two policies per pair:
//
//   - `<id>-agent-egress` on the agent pod: allow DNS + paired
//     gateway pod (`pair=<id>, role=gateway`) on Envoy proxy port.
//     No istio-system entrance — agent isn't a mesh participant.
//   - `<id>-gateway-ingress` on the gateway pod: allow the paired
//     agent pod (`pair=<id>, role=agent`) on Envoy proxy port. The
//     agent is non-ambient so source has no SPIFFE principal —
//     mesh AuthorizationPolicy can't gate this hop; NetworkPolicy
//     does.
//
// Together these form a kernel-enforced symmetric boundary: the
// agent's only outbound is to its gateway, and the gateway's only
// admitted inbound on the proxy port is from its paired agent.

// BuildAgentEgressNetworkPolicy renders the per-pair egress NP for
// `pairKey`'s agent pod. Long-lived pairs pass the instance name;
// forks pass the fork name.
func BuildAgentEgressNetworkPolicy(pairKey string, cfg *config.Config, ownerCM *corev1.ConfigMap) *networkingv1.NetworkPolicy {
	envoyPort := intstr.FromInt(cfg.EnvoyPort)
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
					// scopes to this policy's own namespace, where agent and
					// gateway pods of a pair both live.
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

// BuildGatewayIngressNetworkPolicy renders the per-pair ingress NP
// for `pairKey`'s gateway pod. Admits only the paired agent pod on
// the Envoy proxy port. The gateway pod is in ambient mesh, so
// ambient ingress traffic from other mesh peers (api-server's mesh
// connections to the gateway, if any) would still hit ztunnel; this
// NP coexists with mesh AuthorizationPolicy.
func BuildGatewayIngressNetworkPolicy(pairKey string, cfg *config.Config, ownerCM *corev1.ConfigMap) *networkingv1.NetworkPolicy {
	envoyPort := intstr.FromInt(cfg.EnvoyPort)
	tcp := corev1.ProtocolTCP

	return &networkingv1.NetworkPolicy{
		ObjectMeta: metav1.ObjectMeta{
			Name:      pairKey + "-gateway-ingress",
			Namespace: cfg.Namespace,
			Labels: map[string]string{
				LabelInstance:                  pairKey,
				LabelPair:                      pairKey,
				LabelRole:                      RoleGateway,
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
					LabelRole: RoleGateway,
				},
			},
			PolicyTypes: []networkingv1.PolicyType{networkingv1.PolicyTypeIngress},
			Ingress: []networkingv1.NetworkPolicyIngressRule{
				{
					From: []networkingv1.NetworkPolicyPeer{{
						PodSelector: &metav1.LabelSelector{
							MatchLabels: map[string]string{
								LabelPair: pairKey,
								LabelRole: RoleAgent,
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

func (r *InstanceReconciler) applyGatewayIngressNetworkPolicy(ctx context.Context, np *networkingv1.NetworkPolicy) error {
	if err := applyNetworkPolicy(ctx, r.client, np); err != nil {
		return fmt.Errorf("applying gateway ingress NetworkPolicy: %w", err)
	}
	return nil
}

func (r *ForkReconciler) applyAgentEgressNetworkPolicy(ctx context.Context, np *networkingv1.NetworkPolicy) error {
	if err := applyNetworkPolicy(ctx, r.client, np); err != nil {
		return fmt.Errorf("applying fork agent egress NetworkPolicy: %w", err)
	}
	return nil
}

func (r *ForkReconciler) applyGatewayIngressNetworkPolicy(ctx context.Context, np *networkingv1.NetworkPolicy) error {
	if err := applyNetworkPolicy(ctx, r.client, np); err != nil {
		return fmt.Errorf("applying fork gateway ingress NetworkPolicy: %w", err)
	}
	return nil
}
