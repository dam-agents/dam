package reconciler

import (
	"context"
	"log/slog"
	"maps"
	"slices"
	"time"

	policyv1 "k8s.io/api/policy/v1"
	k8serrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/labels"
	"k8s.io/apimachinery/pkg/util/intstr"

	apiv1 "github.com/dam-agents/dam/packages/controller/api/v1"
	"github.com/dam-agents/dam/packages/controller/pkg/config"
)

const (
	annRunnerDrainSeen = "agent-platform.ai/runner-drain-seen"

	defaultRunnerDrainGrace = 15 * time.Minute
)

func runnerDrainGrace(spec config.VMRunnerSpec) time.Duration {
	if g := spec.Disruption.DrainGrace.AsDuration(); g > 0 {
		return g
	}
	return defaultRunnerDrainGrace
}

// UNIT_BOUNDARY_DESCRIPTION: an eviction of a runner pod reboots every machine of its owner, mid-turn, and a node drain evicts every runner on the node at once. So a runner whose owner has a machine that should run carries a budget that allows no disruption, and a drain waits. It waits only so long: once the runner's node has been unschedulable for the drain grace, the budget is removed and the drain goes ahead. The moment the node was first seen unschedulable is kept on the budget itself, so a controller restart does not start the grace again. A budget removed that way is not put back while the node stays unschedulable, since that would hold the drain off for another grace; a runner with no machine to run has no budget at all.
func runnerDisruptionVerdict(running, cordoned, exists bool, seen, now time.Time, grace time.Duration) (hold bool, seenAt time.Time) {
	switch {
	case !running:
		return false, time.Time{}
	case !cordoned:
		return true, time.Time{}
	case !exists:
		return false, time.Time{}
	case seen.IsZero():
		return true, now
	case now.Sub(seen) >= grace:
		return false, time.Time{}
	default:
		return true, seen
	}
}

func (r *AgentReconciler) buildRunnerPDB(owner string, refs []metav1.OwnerReference, seenAt time.Time) *policyv1.PodDisruptionBudget {
	none := intstr.FromInt32(0)
	pdb := &policyv1.PodDisruptionBudget{
		ObjectMeta: metav1.ObjectMeta{
			Name:            r.runnerName(owner),
			Namespace:       r.config.Namespace,
			Labels:          vmRunnerLabels(owner, r.config.ReleaseName),
			OwnerReferences: refs,
		},
		Spec: policyv1.PodDisruptionBudgetSpec{
			MaxUnavailable: &none,
			Selector:       &metav1.LabelSelector{MatchLabels: vmRunnerSelector(owner)},
		},
	}
	if !seenAt.IsZero() {
		pdb.Annotations = map[string]string{annRunnerDrainSeen: seenAt.UTC().Format(time.RFC3339)}
	}
	return pdb
}

// UNIT_BOUNDARY_DESCRIPTION: the budget is kept in step on every reconcile of the owner's agents, where an agent starting its machine must be protected before the next drain, and on the periodic pass, which is what notices a node staying unschedulable. A reconcile asks the cluster only when whether the owner has a machine to run changed since the last time it did, because a starting machine is reconciled every half second. The caller holds the owner's lock.
func (r *AgentReconciler) guardRunnerDisruption(ctx context.Context, owner string, running bool, refs []metav1.OwnerReference) {
	if last, ok := r.disruptionSeen.Load(owner); ok && last.(bool) == running {
		return
	}
	if _, err := r.syncRunnerDisruption(ctx, owner, running, refs, nil); err != nil {
		slog.Warn("vm runner: keeping the runner's disruption budget in step", "owner", owner, "error", err)
		return
	}
	r.disruptionSeen.Store(owner, running)
}

// UNIT_BOUNDARY_DESCRIPTION: brings the owner's runner budget to what runnerDisruptionVerdict says, and answers whether it is holding a drain off right now. A node that cannot be read leaves the budget as it is, rather than guessing that the node is draining or that it is not. nodes caches what a pass has already read about each node.
func (r *AgentReconciler) syncRunnerDisruption(ctx context.Context, owner string, running bool, refs []metav1.OwnerReference, nodes map[string]bool) (holding bool, err error) {
	name := r.runnerName(owner)
	pdbs := r.client.PolicyV1().PodDisruptionBudgets(r.config.Namespace)
	existing, err := pdbs.Get(ctx, name, metav1.GetOptions{})
	exists := err == nil
	if err != nil && !k8serrors.IsNotFound(err) {
		return false, err
	}
	cordoned := false
	if running {
		if cordoned, err = r.runnerNodeCordoned(ctx, owner, nodes); err != nil {
			return false, err
		}
	}
	var seen time.Time
	if exists {
		seen, _ = time.Parse(time.RFC3339, existing.Annotations[annRunnerDrainSeen])
	}
	grace := runnerDrainGrace(r.config.VM.Runner)
	hold, seenAt := runnerDisruptionVerdict(running, cordoned, exists, seen, time.Now(), grace)
	switch {
	case !hold && exists:
		if running {
			slog.Warn("vm runner: the runner's node has been unschedulable for the drain grace, so its disruption budget is removed and a drain may evict it, rebooting the owner's machines",
				"owner", owner, "runner", name, "since", seen, "grace", grace)
		}
		if err := pdbs.Delete(ctx, name, metav1.DeleteOptions{}); err != nil && !k8serrors.IsNotFound(err) {
			return false, err
		}
		return false, nil
	case hold && !exists:
		_, err := pdbs.Create(ctx, r.buildRunnerPDB(owner, refs, seenAt), metav1.CreateOptions{})
		if k8serrors.IsAlreadyExists(err) {
			err = nil
		}
		return cordoned, err
	case hold:
		desired := r.buildRunnerPDB(owner, refs, seenAt)
		if runnerPDBMatches(existing, desired) {
			return cordoned, nil
		}
		existing.Labels, existing.Annotations, existing.Spec = desired.Labels, desired.Annotations, desired.Spec
		if len(refs) > 0 {
			existing.OwnerReferences = refs
		}
		if cordoned && seen.IsZero() {
			slog.Info("vm runner: the runner's node is unschedulable; its disruption budget holds a drain off for the drain grace", "owner", owner, "runner", name, "grace", grace)
		}
		_, err := pdbs.Update(ctx, existing, metav1.UpdateOptions{})
		return cordoned, err
	default:
		return false, nil
	}
}

func runnerPDBMatches(existing, desired *policyv1.PodDisruptionBudget) bool {
	if existing.Annotations[annRunnerDrainSeen] != desired.Annotations[annRunnerDrainSeen] || !maps.Equal(existing.Labels, desired.Labels) {
		return false
	}
	if existing.Spec.MaxUnavailable == nil || *existing.Spec.MaxUnavailable != *desired.Spec.MaxUnavailable || existing.Spec.MinAvailable != nil {
		return false
	}
	if existing.Spec.Selector == nil || !maps.Equal(existing.Spec.Selector.MatchLabels, desired.Spec.Selector.MatchLabels) {
		return false
	}
	return len(desired.OwnerReferences) == 0 || slices.EqualFunc(existing.OwnerReferences, desired.OwnerReferences, func(a, b metav1.OwnerReference) bool { return a.UID == b.UID })
}

// UNIT_BOUNDARY_DESCRIPTION: a runner is on a draining node when the node its live pod runs on is marked unschedulable, which is the first thing a drain does. A runner with no pod on a node yet is on no node at all.
func (r *AgentReconciler) runnerNodeCordoned(ctx context.Context, owner string, nodes map[string]bool) (bool, error) {
	pods, err := r.client.CoreV1().Pods(r.config.Namespace).List(ctx, metav1.ListOptions{
		LabelSelector: labels.Set(vmRunnerSelector(owner)).String(),
	})
	if err != nil {
		return false, err
	}
	for i := range pods.Items {
		pod := &pods.Items[i]
		if pod.DeletionTimestamp != nil || pod.Spec.NodeName == "" {
			continue
		}
		return r.nodeCordoned(ctx, pod.Spec.NodeName, nodes)
	}
	return false, nil
}

func (r *AgentReconciler) nodeCordoned(ctx context.Context, name string, nodes map[string]bool) (bool, error) {
	if cordoned, ok := nodes[name]; ok {
		return cordoned, nil
	}
	node, err := r.client.CoreV1().Nodes().Get(ctx, name, metav1.GetOptions{})
	if err != nil {
		return false, err
	}
	cordoned := node.Spec.Unschedulable
	if nodes != nil {
		nodes[name] = cordoned
	}
	return cordoned, nil
}

// UNIT_BOUNDARY_DESCRIPTION: whether any of the owner's vm agents should have its machine running, as its own last reconcile decided. It is what a budget is kept for, read from the informer cache like the runner's demand.
func (r *AgentReconciler) ownerRunsMachines(ctx context.Context, owner string) (bool, error) {
	items, err := r.ownerAgents(ctx, owner)
	if err != nil {
		return false, err
	}
	for _, obj := range items {
		a, err := FromCacheObject[apiv1.Agent](obj)
		if err != nil {
			return false, err
		}
		vm := vmSideOf(a)
		if vm == nil {
			continue
		}
		running, err := r.peerShouldRun(ctx, vm.Name)
		if err != nil {
			return false, err
		}
		if running {
			return true, nil
		}
	}
	return false, nil
}
