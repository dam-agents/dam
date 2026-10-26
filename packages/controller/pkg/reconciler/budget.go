package reconciler

import (
	"context"
	"fmt"
	"sync"
	"time"

	"k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"

	apiv1 "github.com/dam-agents/dam/packages/controller/api/v1"
)

// UNIT_BOUNDARY_DESCRIPTION: whether the Agent should be running, read from the record its reconcile keeps on its gateway Service, and from the gateway's own replicas for an Agent that has not written one yet.
func (r *AgentReconciler) agentDesiredUp(ctx context.Context, name string) (bool, error) {
	if up, ok, err := r.servedDesiredUp(ctx, name); err != nil || ok {
		return up, err
	}
	ss, err := r.client.AppsV1().StatefulSets(r.config.Namespace).Get(ctx, GatewayName(name), metav1.GetOptions{})
	if errors.IsNotFound(err) {
		return false, nil
	}
	if err != nil {
		return false, fmt.Errorf("reading the gateway statefulset: %w", err)
	}
	return ss.Spec.Replicas != nil && *ss.Spec.Replicas >= 1, nil
}

func (r *AgentReconciler) recordParkedRetry(name string) {
	r.budgetMu.Lock()
	defer r.budgetMu.Unlock()
	if r.parkedRetry == nil {
		r.parkedRetry = make(map[string]struct{})
	}
	r.parkedRetry[name] = struct{}{}
}

func (r *AgentReconciler) clearParkedRetry(name string) {
	r.budgetMu.Lock()
	defer r.budgetMu.Unlock()
	delete(r.parkedRetry, name)
}

func (r *AgentReconciler) ParkedForRetry() []string {
	r.budgetMu.Lock()
	defer r.budgetMu.Unlock()
	names := make([]string, 0, len(r.parkedRetry))
	for name := range r.parkedRetry {
		names = append(names, name)
	}
	return names
}

// UNIT_BOUNDARY_DESCRIPTION: the grace a start refused for room is given before the
// UNIT_BOUNDARY_DESCRIPTION: refusal is read as the pool's, kept beside the reconciler
// UNIT_BOUNDARY_DESCRIPTION: against the activity stamp it was refused under: a retry of
// UNIT_BOUNDARY_DESCRIPTION: that same start reads the refusal rather than the loader
// UNIT_BOUNDARY_DESCRIPTION: again, and a newer start gets a grace of its own. None of it
// UNIT_BOUNDARY_DESCRIPTION: survives the process, which costs a restarted controller one
// UNIT_BOUNDARY_DESCRIPTION: more loader rather than a failed wake, and keeps the stamp on
// UNIT_BOUNDARY_DESCRIPTION: the Agent meaning only the room a reclaim earned.
type memoryGrace struct {
	lastActivity string
	until        time.Time
}

// UNIT_BOUNDARY_DESCRIPTION: whether this start is inside its grace, opening one if it has
// UNIT_BOUNDARY_DESCRIPTION: never been given one; a start whose grace has run out, or that
// UNIT_BOUNDARY_DESCRIPTION: has had its wait already, is answered false.
func (r *AgentReconciler) memoryGrace(name, lastActivity string) bool {
	r.budgetMu.Lock()
	defer r.budgetMu.Unlock()
	grace, ok := r.memoryGraces[name]
	if !ok || grace.lastActivity != lastActivity {
		if r.memoryGraces == nil {
			r.memoryGraces = make(map[string]memoryGrace)
		}
		r.memoryGraces[name] = memoryGrace{lastActivity: lastActivity, until: r.clockNow().Add(memoryGraceWait)}
		return true
	}
	return r.clockNow().Before(grace.until)
}

// UNIT_BOUNDARY_DESCRIPTION: this start has had its wait, so the refusal that follows is
// UNIT_BOUNDARY_DESCRIPTION: the pool's rather than one given a grace of its own.
func (r *AgentReconciler) markMemoryGraced(name, lastActivity string) {
	r.budgetMu.Lock()
	defer r.budgetMu.Unlock()
	if r.memoryGraces == nil {
		r.memoryGraces = make(map[string]memoryGrace)
	}
	r.memoryGraces[name] = memoryGrace{lastActivity: lastActivity}
}

func (r *AgentReconciler) clearMemoryGrace(name string) {
	r.budgetMu.Lock()
	defer r.budgetMu.Unlock()
	delete(r.memoryGraces, name)
}

func (r *AgentReconciler) ownerLock(owner string) *sync.Mutex {
	r.budgetMu.Lock()
	defer r.budgetMu.Unlock()
	if r.ownerLocks == nil {
		r.ownerLocks = make(map[string]*sync.Mutex)
	}
	l, ok := r.ownerLocks[owner]
	if !ok {
		l = &sync.Mutex{}
		r.ownerLocks[owner] = l
	}
	return l
}

// UNIT_BOUNDARY_DESCRIPTION: the conditions a parked agent carries, for the reconcile that writes them beside the kill in one status update.
func parkStatus(s *apiv1.AgentStatus, gen int64, reason, msg string) {
	setStatusCondition(s, apiv1.ConditionReady, false, "AllPodsReady", reason, msg, gen)
	setStatusCondition(s, apiv1.ConditionAgentPodReady, false, "PodReady", reason, msg, gen)
	setStatusCondition(s, apiv1.ConditionReconciled, true, "Reconciled", "", "", gen)
	s.ObservedGeneration = gen
}

// UNIT_BOUNDARY_DESCRIPTION: a parked agent is not ready for a reason of the caller's, and a start waiting for the node reads as a start in progress rather than as a refusal: its own reasons keep a wake waiting for it, where OverBudget fails the wake at once, and leave the budget surfaces that key on OverBudget alone. It is written beside the kill in one status update, since both conditions belong to the same reconcile.
// UNIT_BOUNDARY_DESCRIPTION: the owner's lock, for a caller outside this package that must serialize with the reconciler's own work on that owner. The idle checker takes it around its pin read and its halt, so a runner roll cannot start in between.
func (r *AgentReconciler) OwnerLock(owner string) *sync.Mutex {
	return r.ownerLock(owner)
}
