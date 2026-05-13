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

// Per pair (ADR-041 + ADR-042) we run **two** ServiceAccounts in the
// agent namespace: agent SA (`<instanceID>`) and gateway SA
// (`<instanceID>-gateway`). The split gives the gateway a distinct
// SPIFFE principal so destination AuthorizationPolicies can admit
// "the gateway" without admitting "the agent" — strict enforcement of
// "agent only calls gateway."
//
// Fork pairs (ADR-027) follow the same split: `<forkName>` for the
// fork agent, `<forkName>-gateway` for the fork gateway.
//
// `automountServiceAccountToken: false` is preserved on both: Istio
// workload identity does not depend on SA-token mounts, and we keep
// the agent + gateway pods credential-free at the K8s API surface.
// K8s GC reaps each SA on instance/fork delete via the owner reference
// to the matching ConfigMap.

// BuildServiceAccount renders a ServiceAccount with the given `name` in
// the agent namespace, owner-refed to `ownerCM`. Used for both agent
// (`<id>`) and gateway (`<id>-gateway`) SAs.
func BuildServiceAccount(name, instanceLabel string, cfg *config.Config, ownerCM *corev1.ConfigMap) *corev1.ServiceAccount {
	falseVal := false
	return &corev1.ServiceAccount{
		ObjectMeta: metav1.ObjectMeta{
			Name:      name,
			Namespace: cfg.Namespace,
			Labels: map[string]string{
				LabelInstance:                  instanceLabel,
				"agent-platform.ai/managed-by": "platform",
			},
			OwnerReferences: []metav1.OwnerReference{
				*metav1.NewControllerRef(ownerCM, corev1.SchemeGroupVersion.WithKind("ConfigMap")),
			},
		},
		AutomountServiceAccountToken: &falseVal,
	}
}

// applyServiceAccount creates or reconciles the per-instance ServiceAccount.
// Idempotent under label drift, owner-ref drift, and AutomountServiceAccountToken
// drift — a pre-existing SA from a prior install / manual creation gets
// reconciled rather than silently accepted.
func (r *InstanceReconciler) applyServiceAccount(ctx context.Context, desired *corev1.ServiceAccount) error {
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

// ensureServiceAccount is the convenience wrapper used by Reconcile. Renders
// both the agent SA (`<instanceName>`) and the gateway SA
// (`<instanceName>-gateway`).
func (r *InstanceReconciler) ensureServiceAccount(ctx context.Context, instanceName string, ownerCM *corev1.ConfigMap) error {
	agentSA := BuildServiceAccount(r.config.AgentServiceAccountName(instanceName), instanceName, r.config, ownerCM)
	if err := r.applyServiceAccount(ctx, agentSA); err != nil {
		return fmt.Errorf("applying agent serviceaccount: %w", err)
	}
	gatewaySA := BuildServiceAccount(r.config.GatewayServiceAccountName(instanceName), instanceName, r.config, ownerCM)
	if err := r.applyServiceAccount(ctx, gatewaySA); err != nil {
		return fmt.Errorf("applying gateway serviceaccount: %w", err)
	}
	return nil
}
