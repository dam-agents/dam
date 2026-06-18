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

// Per-pair agent egress NetworkPolicy. Agent opts out of ambient mesh
// (`istio.io/dataplane-mode: none`) so NetworkPolicy sees real
// destinations, not ztunnel-redirected ones. Combined with the
// chart-rendered namespace-scope deny-all baseline, the agent's only
// admitted destination is its paired gateway. All other egress —
// external, harness, ext-authz — flows through the gateway.

// BuildAgentEgressNetworkPolicy renders the per-pair egress NP for the
// agent pod of `pairKey`. Long-lived pairs use the instance name;
// forks use the fork name. Selector pins to the pair's agent pod —
// the paired gateway pod's egress stays unrestricted.
func BuildAgentEgressNetworkPolicy(pairKey string, cfg *config.Config, ownerRef metav1.OwnerReference) *networkingv1.NetworkPolicy {
	envoyPort := intstr.FromInt(cfg.EnvoyPort)
	tcp := corev1.ProtocolTCP

	egress := []networkingv1.NetworkPolicyEgressRule{{
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
	}}

	return &networkingv1.NetworkPolicy{
		ObjectMeta: metav1.ObjectMeta{
			Name:      pairKey + "-agent-egress",
			Namespace: cfg.Namespace,
			Labels: map[string]string{
				LabelAgent:                     pairKey,
				LabelPair:                      pairKey,
				LabelRole:                      RoleAgent,
				"agent-platform.ai/managed-by": "platform-controller",
			},
			OwnerReferences: []metav1.OwnerReference{ownerRef},
		},
		Spec: networkingv1.NetworkPolicySpec{
			PodSelector: metav1.LabelSelector{
				MatchLabels: map[string]string{
					LabelPair: pairKey,
					LabelRole: RoleAgent,
				},
			},
			PolicyTypes: []networkingv1.PolicyType{networkingv1.PolicyTypeEgress},
			Egress:      egress,
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

func (r *AgentReconciler) applyAgentEgressNetworkPolicy(ctx context.Context, np *networkingv1.NetworkPolicy) error {
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
