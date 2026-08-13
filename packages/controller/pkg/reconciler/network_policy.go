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
		return fmt.Errorf("applying agent egress NetworkPolicy: %w", err)
	}
	return nil
}
