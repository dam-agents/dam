package reconciler

import (
	"context"
	"fmt"

	corev1 "k8s.io/api/core/v1"
	"k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/util/retry"

	"github.com/kagenti/platform/packages/controller/pkg/config"
)

func BuildServiceAccount(agentName string, cfg *config.Config, ownerRef metav1.OwnerReference) *corev1.ServiceAccount {
	falseVal := false
	return &corev1.ServiceAccount{
		ObjectMeta: metav1.ObjectMeta{
			Name:      agentName,
			Namespace: cfg.Namespace,
			Labels: map[string]string{
				LabelAgent:                     agentName,
				"agent-platform.ai/managed-by": "platform",
			},
			OwnerReferences: []metav1.OwnerReference{ownerRef},
		},
		AutomountServiceAccountToken: &falseVal,
	}
}

func (r *AgentReconciler) applyServiceAccount(ctx context.Context, desired *corev1.ServiceAccount) error {
	return retry.RetryOnConflict(retry.DefaultRetry, func() error {
		existing, err := r.client.CoreV1().ServiceAccounts(desired.Namespace).Get(ctx, desired.Name, metav1.GetOptions{})
		if errors.IsNotFound(err) {
			_, err = r.client.CoreV1().ServiceAccounts(desired.Namespace).Create(ctx, desired, metav1.CreateOptions{})
			return err
		}
		if err != nil {
			return err
		}
		changed := false
		if existing.Labels == nil {
			existing.Labels = map[string]string{}
		}
		for k, v := range desired.Labels {
			if existing.Labels[k] != v {
				existing.Labels[k] = v
				changed = true
			}
		}
		if !hasOwnerRef(existing.OwnerReferences, desired.OwnerReferences[0]) {
			existing.OwnerReferences = append(existing.OwnerReferences, desired.OwnerReferences[0])
			changed = true
		}
		if existing.AutomountServiceAccountToken == nil ||
			*existing.AutomountServiceAccountToken != *desired.AutomountServiceAccountToken {
			existing.AutomountServiceAccountToken = desired.AutomountServiceAccountToken
			changed = true
		}
		if !changed {
			return nil
		}
		_, err = r.client.CoreV1().ServiceAccounts(desired.Namespace).Update(ctx, existing, metav1.UpdateOptions{})
		return err
	})
}

func hasOwnerRef(existing []metav1.OwnerReference, want metav1.OwnerReference) bool {
	for _, r := range existing {
		if r.UID == want.UID {
			return true
		}
	}
	return false
}

func (r *AgentReconciler) ensureServiceAccount(ctx context.Context, agentName string, ownerRef metav1.OwnerReference) error {
	sa := BuildServiceAccount(agentName, r.config, ownerRef)
	if err := r.applyServiceAccount(ctx, sa); err != nil {
		return fmt.Errorf("applying serviceaccount: %w", err)
	}
	return nil
}
