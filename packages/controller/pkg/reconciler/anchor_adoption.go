package reconciler

import (
	"context"
	stderrors "errors"
	"fmt"
	"log/slog"
	"strings"

	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime/schema"

	apiv1 "github.com/dam-agents/dam/packages/controller/api/v1"
)

// UNIT_BOUNDARY_DESCRIPTION: hands an Agent's existing children to its anchor at the switch. The
// UNIT_BOUNDARY_DESCRIPTION: reconcile adopts a child it renders, but a reconcile can fail before it reaches
// UNIT_BOUNDARY_DESCRIPTION: one — a machine on an unreachable runner is enough — and the anchor pass is the only
// UNIT_BOUNDARY_DESCRIPTION: step the api-server's barrier waits for. So the pass itself lists what the anchor
// UNIT_BOUNDARY_DESCRIPTION: owns and converges the owner references, whatever the fleet is doing: a child left
// UNIT_BOUNDARY_DESCRIPTION: owned by a custom resource that the contract release deletes would be garbage-collected
// UNIT_BOUNDARY_DESCRIPTION: with it, taking a live machine.
func (r *AgentReconciler) ensureChildrenOwnedByAnchor(ctx context.Context, agent *apiv1.Agent, owner metav1.OwnerReference) error {
	if !r.anchors {
		return nil
	}
	selector := metav1.ListOptions{LabelSelector: LabelAgent + "=" + agent.Name}
	var errs []error

	converge := func(kind string, object metav1.Object, update func() error) {
		if needsAdoption(object.GetOwnerReferences(), owner) {
			if err := update(); err != nil && !apierrors.IsNotFound(err) {
				errs = append(errs, fmt.Errorf("adopting the %s %s: %w", kind, object.GetName(), err))
			}
		}
	}

	statefulSets, err := r.client.AppsV1().StatefulSets(r.config.Namespace).List(ctx, selector)
	if err != nil {
		errs = append(errs, fmt.Errorf("listing StatefulSets: %w", err))
	} else {
		for i := range statefulSets.Items {
			statefulSet := &statefulSets.Items[i]
			converge("StatefulSet", statefulSet, func() error {
				statefulSet.OwnerReferences = adoptOwnerRefs(statefulSet.OwnerReferences, owner)
				_, err := r.client.AppsV1().StatefulSets(r.config.Namespace).Update(ctx, statefulSet, metav1.UpdateOptions{})
				return err
			})
		}
	}

	services, err := r.client.CoreV1().Services(r.config.Namespace).List(ctx, selector)
	if err != nil {
		errs = append(errs, fmt.Errorf("listing Services: %w", err))
	} else {
		for i := range services.Items {
			service := &services.Items[i]
			converge("Service", service, func() error {
				service.OwnerReferences = adoptOwnerRefs(service.OwnerReferences, owner)
				_, err := r.client.CoreV1().Services(r.config.Namespace).Update(ctx, service, metav1.UpdateOptions{})
				return err
			})
		}
	}

	serviceAccounts, err := r.client.CoreV1().ServiceAccounts(r.config.Namespace).List(ctx, selector)
	if err != nil {
		errs = append(errs, fmt.Errorf("listing ServiceAccounts: %w", err))
	} else {
		for i := range serviceAccounts.Items {
			account := &serviceAccounts.Items[i]
			converge("ServiceAccount", account, func() error {
				account.OwnerReferences = adoptOwnerRefs(account.OwnerReferences, owner)
				_, err := r.client.CoreV1().ServiceAccounts(r.config.Namespace).Update(ctx, account, metav1.UpdateOptions{})
				return err
			})
		}
	}

	configMaps, err := r.client.CoreV1().ConfigMaps(r.config.Namespace).List(ctx, selector)
	if err != nil {
		errs = append(errs, fmt.Errorf("listing ConfigMaps: %w", err))
	} else {
		for i := range configMaps.Items {
			configMap := &configMaps.Items[i]
			if strings.HasSuffix(configMap.Name, anchorSuffix) {
				continue
			}
			converge("ConfigMap", configMap, func() error {
				configMap.OwnerReferences = adoptOwnerRefs(configMap.OwnerReferences, owner)
				_, err := r.client.CoreV1().ConfigMaps(r.config.Namespace).Update(ctx, configMap, metav1.UpdateOptions{})
				return err
			})
		}
	}

	networkPolicies, err := r.client.NetworkingV1().NetworkPolicies(r.config.Namespace).List(ctx, selector)
	if err != nil {
		errs = append(errs, fmt.Errorf("listing NetworkPolicies: %w", err))
	} else {
		for i := range networkPolicies.Items {
			policy := &networkPolicies.Items[i]
			converge("NetworkPolicy", policy, func() error {
				policy.OwnerReferences = adoptOwnerRefs(policy.OwnerReferences, owner)
				_, err := r.client.NetworkingV1().NetworkPolicies(r.config.Namespace).Update(ctx, policy, metav1.UpdateOptions{})
				return err
			})
		}
	}

	secrets, err := r.client.CoreV1().Secrets(r.config.Namespace).List(ctx, selector)
	if err != nil {
		errs = append(errs, fmt.Errorf("listing Secrets: %w", err))
	} else {
		for i := range secrets.Items {
			secret := &secrets.Items[i]
			converge("Secret", secret, func() error {
				secret.OwnerReferences = adoptOwnerRefs(secret.OwnerReferences, owner)
				_, err := r.client.CoreV1().Secrets(r.config.Namespace).Update(ctx, secret, metav1.UpdateOptions{})
				return err
			})
		}
	}

	for _, gvr := range []schema.GroupVersionResource{certificateGVR, authzPolicyGVR} {
		list, err := r.dynamic.Resource(gvr).Namespace(r.config.Namespace).List(ctx, selector)
		if err != nil {
			if apierrors.IsNotFound(err) || isNoMatch(err) {
				continue
			}
			errs = append(errs, fmt.Errorf("listing %s: %w", gvr.Resource, err))
			continue
		}
		for i := range list.Items {
			object := list.Items[i].DeepCopy()
			converge(gvr.Resource, object, func() error {
				object.SetOwnerReferences(adoptOwnerRefs(object.GetOwnerReferences(), owner))
				_, err := r.dynamic.Resource(gvr).Namespace(r.config.Namespace).Update(ctx, object, metav1.UpdateOptions{})
				return err
			})
		}
	}

	if len(errs) > 0 {
		slog.Warn("the anchor pass could not hand every child to its anchor", "agent", agent.Name, "errors", len(errs))
	}
	return stderrors.Join(errs...)
}

func needsAdoption(existing []metav1.OwnerReference, owner metav1.OwnerReference) bool {
	hasOwner := false
	for _, ref := range existing {
		if ref.UID == owner.UID {
			hasOwner = true
			continue
		}
		if ref.Kind == agentGVK.Kind || (ref.Kind == "ConfigMap" && strings.HasSuffix(ref.Name, anchorSuffix)) {
			return true
		}
	}
	return !hasOwner
}

func isNoMatch(err error) bool {
	return apierrors.IsNotFound(err) || strings.Contains(err.Error(), "no matches for kind")
}
