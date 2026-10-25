package reconciler

import (
	"context"
	stderrors "errors"
	"fmt"
	"log/slog"
	"time"

	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

// UNIT_BOUNDARY_DESCRIPTION: the release-namespace half of the delete protocol: an Agent's ext-authz Service
// UNIT_BOUNDARY_DESCRIPTION: and its two AuthorizationPolicies live beside the api-server, where an owner
// UNIT_BOUNDARY_DESCRIPTION: reference in the Agent namespace cannot reach them. The delete queue names them
// UNIT_BOUNDARY_DESCRIPTION: explicitly, and this sweep is the backstop for a delete that gave up or for an
// UNIT_BOUNDARY_DESCRIPTION: anchor removed out of band. A candidate whose row is still there is left alone,
// UNIT_BOUNDARY_DESCRIPTION: and one whose row is gone waits the same grace an anchor does, because a read that
// UNIT_BOUNDARY_DESCRIPTION: comes back empty is not proof the Agent is gone.
func (r *AgentReconciler) ReconcileOrphanReleaseNsResources(ctx context.Context) error {
	if !r.anchors {
		return nil
	}
	if err := r.assertStoreAbsorbed(ctx); err != nil {
		return err
	}
	now := r.clockNow()

	type candidate struct {
		key   string
		name  string
		agent string
		kind  string
	}
	var candidates []candidate

	services, err := r.client.CoreV1().Services(r.config.ReleaseNamespace).List(ctx, metav1.ListOptions{
		LabelSelector: LabelAgent,
	})
	if err != nil {
		return fmt.Errorf("listing per-agent Services in the release namespace: %w", err)
	}
	for i := range services.Items {
		svc := &services.Items[i]
		candidates = append(candidates, candidate{
			key:   "service/" + svc.Name,
			name:  svc.Name,
			agent: svc.Labels[LabelAgent],
			kind:  "Service",
		})
	}

	policies, err := r.dynamic.Resource(authzPolicyGVR).Namespace(r.config.ReleaseNamespace).
		List(ctx, metav1.ListOptions{LabelSelector: LabelAgent})
	if err != nil && !apierrors.IsNotFound(err) {
		return fmt.Errorf("listing per-agent AuthorizationPolicies in the release namespace: %w", err)
	}
	if policies != nil {
		for i := range policies.Items {
			policy := &policies.Items[i]
			candidates = append(candidates, candidate{
				key:   "authorizationpolicy/" + policy.GetName(),
				name:  policy.GetName(),
				agent: policy.GetLabels()[LabelAgent],
				kind:  "AuthorizationPolicy",
			})
		}
	}

	var errs []error
	for _, one := range candidates {
		if one.agent == "" {
			continue
		}
		live, err := r.backend.Get(ctx, one.agent)
		switch {
		case err == nil && live != nil:
			r.releaseNsOrphanSince.Delete(one.key)
			continue
		case err != nil && !apierrors.IsNotFound(err):
			slog.Warn("release-namespace sweep: reading an Agent failed", "agent", one.agent, "error", err)
			continue
		}
		first, seen := r.releaseNsOrphanSince.LoadOrStore(one.key, now)
		if !seen {
			slog.Info("release-namespace sweep: an object's Agent is gone; it is removed if that lasts",
				"kind", one.kind, "name", one.name, "grace", orphanGrace)
			continue
		}
		if now.Sub(first.(time.Time)) < orphanGrace {
			continue
		}
		if err := r.deleteReleaseNsObject(ctx, one.kind, one.name); err != nil {
			errs = append(errs, err)
			continue
		}
		r.releaseNsOrphanSince.Delete(one.key)
		slog.Info("release-namespace sweep: removed an orphan", "kind", one.kind, "name", one.name, "agent", one.agent)
	}
	return stderrors.Join(errs...)
}

func (r *AgentReconciler) deleteReleaseNsObject(ctx context.Context, kind, name string) error {
	switch kind {
	case "Service":
		if err := r.client.CoreV1().Services(r.config.ReleaseNamespace).
			Delete(ctx, name, metav1.DeleteOptions{}); err != nil && !apierrors.IsNotFound(err) {
			return fmt.Errorf("deleting per-agent Service %s: %w", name, err)
		}
		return nil
	default:
		if err := r.dynamic.Resource(authzPolicyGVR).Namespace(r.config.ReleaseNamespace).
			Delete(ctx, name, metav1.DeleteOptions{}); err != nil && !apierrors.IsNotFound(err) {
			return fmt.Errorf("deleting per-agent AuthorizationPolicy %s: %w", name, err)
		}
		return nil
	}
}
