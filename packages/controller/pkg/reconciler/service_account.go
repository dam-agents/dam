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

// ADR-041: per-agent ServiceAccount in the agent namespace, name == agent ID.
//
// Both pods of the long-lived pair (agent-runtime + gateway) mount this SA.
// Fork pairs (ADR-027) get their **own** per-fork SA — distinct from the
// parent's — rendered by the same `BuildServiceAccount` helper with the
// fork name as `agentName`. The fork's narrower harness surface is
// enforced by per-fork AuthorizationPolicies (see authorization_policy.go).
// K8s GC reaps each SA on agent/fork delete via the owner reference to
// the matching ConfigMap.
//
// `automountServiceAccountToken: false` is preserved: Istio workload identity
// does not depend on SA-token mounts, and we keep the agent + gateway pods
// credential-free at the K8s API surface.

// BuildServiceAccount renders the per-agent ServiceAccount for `agentName`.
func BuildServiceAccount(agentName string, cfg *config.Config, ownerCM *corev1.ConfigMap) *corev1.ServiceAccount {
	falseVal := false
	return &corev1.ServiceAccount{
		ObjectMeta: metav1.ObjectMeta{
			Name:      agentName,
			Namespace: cfg.Namespace,
			Labels: map[string]string{
				LabelAgent:                     agentName,
				"agent-platform.ai/managed-by": "platform",
			},
			OwnerReferences: []metav1.OwnerReference{
				*metav1.NewControllerRef(ownerCM, corev1.SchemeGroupVersion.WithKind("ConfigMap")),
			},
		},
		AutomountServiceAccountToken: &falseVal,
	}
}

// applyServiceAccount creates or reconciles the per-agent ServiceAccount.
// Idempotent under label drift, owner-ref drift, and AutomountServiceAccountToken
// drift — a pre-existing SA from a prior install / manual creation gets
// reconciled rather than silently accepted.
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
		// Reconcile fields we own; preserve everything else (other controllers
		// may add their own ImagePullSecrets / labels).
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

// ensureSA is the convenience wrapper used by Reconcile. Returns a wrapped
// error that names the operation for callers that surface it via setError.
func (r *AgentReconciler) ensureServiceAccount(ctx context.Context, agentName string, ownerCM *corev1.ConfigMap) error {
	sa := BuildServiceAccount(agentName, r.config, ownerCM)
	if err := r.applyServiceAccount(ctx, sa); err != nil {
		return fmt.Errorf("applying serviceaccount: %w", err)
	}
	return nil
}
