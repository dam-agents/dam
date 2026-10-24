package reconciler

import (
	"context"
	stderrors "errors"
	"fmt"
	"log/slog"
	"strings"
	"time"

	corev1 "k8s.io/api/core/v1"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/labels"

	apiv1 "github.com/dam-agents/dam/packages/controller/api/v1"
)

// UNIT_BOUNDARY_DESCRIPTION: once the rows own an Agent there is no object for
// UNIT_BOUNDARY_DESCRIPTION: its children to be owned by, and Kubernetes' cascading delete is what makes
// UNIT_BOUNDARY_DESCRIPTION: a deletion complete. So each Agent gets one empty ConfigMap as its anchor:
// UNIT_BOUNDARY_DESCRIPTION: it owns the gateway StatefulSet, the Services, the bootstrap ConfigMap, the
// UNIT_BOUNDARY_DESCRIPTION: certificate and its Secret, the ServiceAccount and the policies. It is
// UNIT_BOUNDARY_DESCRIPTION: created before any of them and deleted after the machine and the
// UNIT_BOUNDARY_DESCRIPTION: release-namespace objects are gone, which makes it the durable record that a
// UNIT_BOUNDARY_DESCRIPTION: deletion still has work to do even when the controller was down when the row
// UNIT_BOUNDARY_DESCRIPTION: went away.
const (
	anchorSuffix      = "-anchor"
	anchorIncarnation = "incarnation"
)

// UNIT_BOUNDARY_DESCRIPTION: errAnchorStale marks the anchor of a previous incarnation. Its cleanup is the delete worker's, and a startup pass that treated it as a failure would retry for ever while the worker that could remove it waits for that same pass.
var errAnchorStale = stderrors.New("the anchor belongs to a previous Agent")

func anchorName(agent string) string { return agent + anchorSuffix }

func (r *AgentReconciler) childrenOwner(ctx context.Context, agent *apiv1.Agent) (metav1.OwnerReference, error) {
	if !r.anchors {
		return agentOwnerRef(agent), nil
	}
	return r.ensureAnchor(ctx, agent)
}

// UNIT_BOUNDARY_DESCRIPTION: ensureAnchor creates the Agent's anchor before anything is rendered, or
// UNIT_BOUNDARY_DESCRIPTION: converges the metadata of one that is already there. An anchor carrying
// UNIT_BOUNDARY_DESCRIPTION: another incarnation is the previous Agent of that name still being cleaned
// UNIT_BOUNDARY_DESCRIPTION: up: adopting it would hand the new Agent the old one's gateway and machine,
// UNIT_BOUNDARY_DESCRIPTION: so the reconcile waits for the delete worker instead.
func (r *AgentReconciler) ensureAnchor(ctx context.Context, agent *apiv1.Agent) (metav1.OwnerReference, error) {
	name := anchorName(agent.Name)
	desired := &corev1.ConfigMap{
		ObjectMeta: metav1.ObjectMeta{
			Name:      name,
			Namespace: r.config.Namespace,
			Labels:    map[string]string{envoyOwnerLabel: agent.Labels[envoyOwnerLabel], LabelAgent: agent.Name},
		},
		Data: map[string]string{anchorIncarnation: string(agent.UID)},
	}
	existing, err := r.client.CoreV1().ConfigMaps(r.config.Namespace).Get(ctx, name, metav1.GetOptions{})
	switch {
	case apierrors.IsNotFound(err):
		created, err := r.client.CoreV1().ConfigMaps(r.config.Namespace).Create(ctx, desired, metav1.CreateOptions{})
		if apierrors.IsAlreadyExists(err) {
			return metav1.OwnerReference{}, fmt.Errorf("agent %s: its anchor was created concurrently; retrying", agent.Name)
		}
		if err != nil {
			return metav1.OwnerReference{}, fmt.Errorf("agent %s: creating its anchor: %w", agent.Name, err)
		}
		return anchorOwnerRef(created), nil
	case err != nil:
		return metav1.OwnerReference{}, fmt.Errorf("agent %s: reading its anchor: %w", agent.Name, err)
	}
	if existing.Data[anchorIncarnation] != string(agent.UID) {
		return metav1.OwnerReference{}, fmt.Errorf(
			"%w: agent %s: the anchor still belongs to the previous Agent of that name", errAnchorStale, agent.Name)
	}
	if existing.Labels[envoyOwnerLabel] != desired.Labels[envoyOwnerLabel] || existing.Labels[LabelAgent] != agent.Name {
		updated := existing.DeepCopy()
		updated.Labels = desired.Labels
		updated.Data = desired.Data
		if updated, err = r.client.CoreV1().ConfigMaps(r.config.Namespace).Update(ctx, updated, metav1.UpdateOptions{}); err != nil {
			return metav1.OwnerReference{}, fmt.Errorf("agent %s: converging its anchor: %w", agent.Name, err)
		}
		return anchorOwnerRef(updated), nil
	}
	return anchorOwnerRef(existing), nil
}

func anchorOwnerRef(anchor *corev1.ConfigMap) metav1.OwnerReference {
	return *metav1.NewControllerRef(anchor, corev1.SchemeGroupVersion.WithKind("ConfigMap"))
}

// UNIT_BOUNDARY_DESCRIPTION: a child that already exists keeps the owner
// UNIT_BOUNDARY_DESCRIPTION: reference it was created with. That reference may name the custom resource, or an anchor of the same name with an earlier incarnation, and either one is garbage-collected while the child is still wanted. Converging the metadata is what hands the child to the anchor this Agent has now, without touching its spec.
func adoptOwnerRefs(existing []metav1.OwnerReference, desired metav1.OwnerReference) []metav1.OwnerReference {
	out := make([]metav1.OwnerReference, 0, len(existing)+1)
	for _, ref := range existing {
		if ref.UID == desired.UID {
			continue
		}
		if ref.Kind == agentGVK.Kind || (ref.Kind == "ConfigMap" && strings.HasSuffix(ref.Name, anchorSuffix)) {
			continue
		}
		out = append(out, ref)
	}
	return append(out, desired)
}

// UNIT_BOUNDARY_DESCRIPTION: deleteByAnchor runs the durable deletion protocol: everything the anchor
// UNIT_BOUNDARY_DESCRIPTION: cannot cascade goes first, and the anchor last, so a failure keeps the record
// UNIT_BOUNDARY_DESCRIPTION: that there is work left.
func (r *AgentReconciler) deleteByAnchor(ctx context.Context, name string) error {
	// UNIT_BOUNDARY_DESCRIPTION: every delete asks the database's half of the fence first. A relist against a
	// UNIT_BOUNDARY_DESCRIPTION: store this cluster never moved into reads every Agent as gone, and without
	// UNIT_BOUNDARY_DESCRIPTION: this check the feed would hand the whole fleet to the delete in one pass.
	if err := r.assertStoreAbsorbed(ctx); err != nil {
		return err
	}
	anchor, err := r.client.CoreV1().ConfigMaps(r.config.Namespace).Get(ctx, anchorName(name), metav1.GetOptions{})
	if apierrors.IsNotFound(err) {
		return nil
	}
	if err != nil {
		return fmt.Errorf("reading the anchor of deleted agent %s: %w", name, err)
	}
	incarnation := anchor.Data[anchorIncarnation]
	owner := anchor.Labels[envoyOwnerLabel]

	live, err := r.backend.Get(ctx, name)
	switch {
	case err == nil && string(live.GetUID()) == incarnation:
		return fmt.Errorf("the deleted agent %s is still there", name)
	case err != nil && !apierrors.IsNotFound(err):
		return fmt.Errorf("reading the deleted agent %s: %w", name, err)
	}

	if err := r.deleteReleaseNsAgentResources(ctx, name); err != nil {
		return err
	}
	if err := r.deletePVCs(ctx, name); err != nil {
		return err
	}
	if err := r.deleteMachine(ctx, name, owner); err != nil {
		return err
	}
	// UNIT_BOUNDARY_DESCRIPTION: The preconditions make the delete the one made from the anchor this pass
	// UNIT_BOUNDARY_DESCRIPTION: read: a concurrent convergence of the same anchor is retried from what it
	// UNIT_BOUNDARY_DESCRIPTION: now says.
	uid, version := anchor.UID, anchor.ResourceVersion
	if err := r.client.CoreV1().ConfigMaps(r.config.Namespace).Delete(ctx, anchor.Name, metav1.DeleteOptions{
		Preconditions: &metav1.Preconditions{UID: &uid, ResourceVersion: &version},
	}); err != nil && !apierrors.IsNotFound(err) {
		return fmt.Errorf("deleting the anchor of %s: %w", name, err)
	}
	r.forgetAgent(name)
	slog.Info("deleted agent cleanup: anchor removed", "agent", name, "owner", owner, "incarnation", incarnation)
	return nil
}

func (r *AgentReconciler) forgetAgent(name string) {
	r.vmRunning.Delete(name)
	r.vmAnswers.Delete(name)
	r.vmDiskGrows.Delete(name)
	r.notReadyPolls.Delete(name)
	r.vmStartClocks.Delete(name)
	r.ownerGatewayRevisions.Delete(name)
	r.ownerGatewayAnswered.Delete(name)
	r.ownerGatewayLegacyRevisions.Delete(name)
	r.ownerGatewayEpochs.Delete(name)
	r.clearParkedRetry(name)
	r.memoryWaitWrites.Delete(name)
	unresolvedGrants.forget(name)
}

// UNIT_BOUNDARY_DESCRIPTION: ReconcileOrphanAnchors hands every anchor whose Agent is gone, or is a later
// UNIT_BOUNDARY_DESCRIPTION: incarnation, to the delete worker. It is the cold-start half of the protocol:
// UNIT_BOUNDARY_DESCRIPTION: a deletion the controller never saw still has its record, and nothing is
// UNIT_BOUNDARY_DESCRIPTION: inferred from a cache. An anchor with no row is a deletion; one with a row of
// UNIT_BOUNDARY_DESCRIPTION: another incarnation is the previous Agent's, which the current reconcile is
// UNIT_BOUNDARY_DESCRIPTION: waiting on.
func (r *AgentReconciler) ReconcileOrphanAnchors(ctx context.Context, enqueue func(name string)) error {
	if !r.anchors {
		return nil
	}
	if err := r.assertStoreAbsorbed(ctx); err != nil {
		return err
	}
	anchors, err := r.client.CoreV1().ConfigMaps(r.config.Namespace).List(ctx, metav1.ListOptions{
		LabelSelector: LabelAgent,
	})
	if err != nil {
		return fmt.Errorf("listing agent anchors: %w", err)
	}
	now := r.clockNow()
	for i := range anchors.Items {
		anchor := &anchors.Items[i]
		name := anchor.Labels[LabelAgent]
		if name == "" || anchorName(name) != anchor.Name {
			continue
		}
		live, err := r.backend.Get(ctx, name)
		orphaned := false
		switch {
		case apierrors.IsNotFound(err):
			orphaned = true
		case err != nil:
			slog.Warn("anchor sweep: reading an Agent failed", "agent", name, "error", err)
			continue
		case string(live.GetUID()) != anchor.Data[anchorIncarnation]:
			orphaned = true
		}
		if !orphaned {
			r.anchorOrphanSince.Delete(name)
			continue
		}
		// UNIT_BOUNDARY_DESCRIPTION: a sweep that finds an anchor unclaimed waits the
		// UNIT_BOUNDARY_DESCRIPTION: same grace a machine gets, because a read that comes
		// UNIT_BOUNDARY_DESCRIPTION: back empty is not proof the Agent is gone and its disk
		// UNIT_BOUNDARY_DESCRIPTION: has no backup. The feed's own delete is immediate.
		first, seen := r.anchorOrphanSince.LoadOrStore(name, now)
		if !seen {
			slog.Info("anchor sweep: an anchor's Agent is gone; it is removed if that lasts", "agent", name, "grace", orphanGrace)
			continue
		}
		if now.Sub(first.(time.Time)) < orphanGrace {
			continue
		}
		enqueue(name)
	}
	return nil
}

// UNIT_BOUNDARY_DESCRIPTION: eventReference is what an Event's involvedObject names. Once the custom
// UNIT_BOUNDARY_DESCRIPTION: resource is gone that must be a real object, so it is the anchor.
func (r *AgentReconciler) eventReference(ctx context.Context, agent *apiv1.Agent) (corev1.ObjectReference, bool) {
	if !r.anchors {
		return corev1.ObjectReference{
			APIVersion: agentGVK.GroupVersion().String(),
			Kind:       agentGVK.Kind,
			Name:       agent.Name,
			Namespace:  r.config.Namespace,
			UID:        agent.UID,
		}, true
	}
	anchor, err := r.client.CoreV1().ConfigMaps(r.config.Namespace).Get(ctx, anchorName(agent.Name), metav1.GetOptions{})
	if err != nil {
		slog.Debug("writing an event on an agent with no anchor", "agent", agent.Name, "error", err)
		return corev1.ObjectReference{}, false
	}
	return corev1.ObjectReference{
		APIVersion: "v1",
		Kind:       "ConfigMap",
		Name:       anchor.Name,
		Namespace:  anchor.Namespace,
		UID:        anchor.UID,
	}, true
}

// UNIT_BOUNDARY_DESCRIPTION: EnsureAnchors is the startup pass: every Agent the store holds has its anchor
// UNIT_BOUNDARY_DESCRIPTION: before any work is served, so a deletion that happened while the controller
// UNIT_BOUNDARY_DESCRIPTION: was down always has a record to find.
func (r *AgentReconciler) EnsureAnchors(ctx context.Context, enqueue func(name string)) (pending int, err error) {
	if !r.anchors {
		return 0, nil
	}
	agents, err := r.backend.List(ctx, labels.Everything())
	if err != nil {
		return 0, fmt.Errorf("listing Agents to ensure their anchors: %w", err)
	}
	var errs []error
	for i := range agents {
		agent, err := FromCacheObject[apiv1.Agent](&agents[i])
		if err != nil {
			errs = append(errs, err)
			continue
		}
		if _, err := r.ensureAnchor(ctx, agent); err != nil {
			if stderrors.Is(err, errAnchorStale) {
				// UNIT_BOUNDARY_DESCRIPTION: the previous incarnation's anchor is a deletion to work, not a
				// UNIT_BOUNDARY_DESCRIPTION: failure to retry: the delete worker removes it, and the pass reports
				// UNIT_BOUNDARY_DESCRIPTION: that the fleet is not ready for its record yet.
				enqueue(agent.Name)
				pending++
				continue
			}
			errs = append(errs, err)
		}
	}
	return pending, stderrors.Join(errs...)
}

// UNIT_BOUNDARY_DESCRIPTION: StoreHealthy is the gate the passes outside a reconcile ask before deciding
// UNIT_BOUNDARY_DESCRIPTION: anything that stops, reclaims or collects.
func (r *AgentReconciler) StoreHealthy() error { return r.backendHealthy() }

// UNIT_BOUNDARY_DESCRIPTION: ForgetVMPools drops the pools this process cached: a budget write is the one
// UNIT_BOUNDARY_DESCRIPTION: change that reaches no Agent, so the next read of each owner asks again.
func (r *AgentReconciler) ForgetVMPools() {
	r.vmPools.Range(func(key, _ any) bool {
		r.vmPools.Delete(key)
		return true
	})
}
