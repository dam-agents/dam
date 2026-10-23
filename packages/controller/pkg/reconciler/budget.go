package reconciler

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"sync"
	"time"

	"k8s.io/apimachinery/pkg/api/errors"
	"k8s.io/apimachinery/pkg/api/resource"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/types"

	apiv1 "github.com/dam-agents/dam/packages/controller/api/v1"
)

func (r *AgentReconciler) agentDesiredUp(ctx context.Context, name string, vm bool) (bool, error) {
	if vm {
		if up, ok, err := r.servedDesiredUp(ctx, name); err != nil || ok {
			return up, err
		}
		name = GatewayName(name)
	}
	ss, err := r.client.AppsV1().StatefulSets(r.config.Namespace).Get(ctx, name, metav1.GetOptions{})
	if errors.IsNotFound(err) {
		return false, nil
	}
	if err != nil {
		return false, fmt.Errorf("reading agent statefulset: %w", err)
	}
	return ss.Spec.Replicas != nil && *ss.Spec.Replicas >= 1, nil
}

func (r *AgentReconciler) ensureConcreteSize(ctx context.Context, agent *apiv1.Agent) error {
	fill := map[string]string{}
	if agent.Spec.Resources.Limits["cpu"] == "" {
		fill["cpu"] = r.config.LegacyAgentCPULimit.String()
	}
	if agent.Spec.Resources.Limits["memory"] == "" {
		fill["memory"] = r.config.LegacyAgentMemoryLimit.String()
	}
	if len(fill) == 0 {
		return nil
	}
	raw, err := json.Marshal(map[string]any{
		"spec": map[string]any{"resources": map[string]any{"limits": fill}},
	})
	if err != nil {
		return fmt.Errorf("encoding size fill patch: %w", err)
	}
	if _, err := r.dynamic.Resource(AgentsGVR).Namespace(r.config.Namespace).
		Patch(ctx, agent.Name, types.MergePatchType, raw, metav1.PatchOptions{}); err != nil {
		return fmt.Errorf("materializing agent size: %w", err)
	}
	if agent.Spec.Resources.Limits == nil {
		agent.Spec.Resources.Limits = map[string]string{}
	}
	for k, v := range fill {
		agent.Spec.Resources.Limits[k] = v
	}
	slog.Info("materialized concrete agent size into spec", "agent", agent.Name, "fill", fill)
	return nil
}

func (r *AgentReconciler) limitsOf(spec *apiv1.AgentSpec) (resource.Quantity, resource.Quantity) {
	cpu := parseQuantityOr(spec.Resources.Limits["cpu"], r.config.LegacyAgentCPULimit)
	mem := parseQuantityOr(spec.Resources.Limits["memory"], r.config.LegacyAgentMemoryLimit)
	return cpu, mem
}

func parseQuantityOr(s string, def resource.Quantity) resource.Quantity {
	if s == "" {
		return def
	}
	q, err := resource.ParseQuantity(s)
	if err != nil || q.Sign() <= 0 {
		return def
	}
	return q
}

func (r *AgentReconciler) wakeAlreadyDenied(name, lastActivity string) bool {
	r.budgetMu.Lock()
	defer r.budgetMu.Unlock()
	denied, ok := r.deniedWakes[name]
	return ok && denied == lastActivity
}

func (r *AgentReconciler) recordDeniedWake(name, lastActivity string) {
	r.budgetMu.Lock()
	defer r.budgetMu.Unlock()
	if r.deniedWakes == nil {
		r.deniedWakes = make(map[string]string)
	}
	r.deniedWakes[name] = lastActivity
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

func (r *AgentReconciler) clearDeniedWake(name string) {
	r.budgetMu.Lock()
	defer r.budgetMu.Unlock()
	delete(r.deniedWakes, name)
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
