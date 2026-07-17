package reconciler

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"sync"

	corev1 "k8s.io/api/core/v1"
	"k8s.io/apimachinery/pkg/api/errors"
	"k8s.io/apimachinery/pkg/api/resource"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/types"

	apiv1 "github.com/kagenti/platform/packages/controller/api/v1"
)

// Budget enforcement (#1900). The reconciler is the single actuator of the
// 0→1 scale transition, so the ceiling is checked here — no api-server code
// path can start pods around it. The rule stays deliberately dumb: sum the
// owner's scaled-up agents' `spec.resources.limits` — the user-facing "size",
// i.e. what the agents can actually consume — compare against the owner's
// Ceiling (UserBudget CR, else chart default), refuse the start when either
// dimension would overflow. Because limits hard-cap usage, a user's agents
// can never consume past the Ceiling. Running agents are never re-checked or
// evicted; the budget constrains starting, not running. The uniform per-agent
// gateway overhead is deliberately excluded from the sum.

type budgetVerdict struct {
	allowed bool
	message string
}

var allowedVerdict = budgetVerdict{allowed: true}

// budgetAllows decides whether scaling this agent's pair 0→1 fits the owner's
// Ceiling. Already-running agents pass without any reads.
//
// Race note: the check reads desired SS replicas, but the admitted agent's
// own scale-up happens later in Reconcile, after this returns — an admitted
// but not-yet-scaled agent is invisible to a concurrent check. That gap is
// safe ONLY because agent reconciles are drained by a single worker
// goroutine (see the runAgentWorker call in main.go), so two same-owner
// checks can never interleave with it. The per-owner mutex below is
// belt-and-suspenders for that invariant, not a substitute: if agent workers
// are ever parallelized, the lock must be held through the scale-up.
func (r *AgentReconciler) budgetAllows(ctx context.Context, agent *apiv1.Agent, owner string) (budgetVerdict, error) {
	// Ownerless agents (nothing to account against) are not gated.
	if owner == "" {
		return allowedVerdict, nil
	}
	ns := r.config.Namespace
	existing, err := r.client.AppsV1().StatefulSets(ns).Get(ctx, agent.Name, metav1.GetOptions{})
	if err != nil && !errors.IsNotFound(err) {
		return budgetVerdict{}, fmt.Errorf("reading agent statefulset: %w", err)
	}
	if err == nil && existing.Spec.Replicas != nil && *existing.Spec.Replicas >= 1 {
		return allowedVerdict, nil // already running — only a real 0→1 spends budget
	}

	lock := r.ownerLock(owner)
	lock.Lock()
	defer lock.Unlock()

	reservedCPU, reservedMem, err := r.reservedByOwner(ctx, owner, agent.Name)
	if err != nil {
		return budgetVerdict{}, err
	}
	candCPU, candMem := r.limitsOf(&agent.Spec)
	ceilCPU, ceilMem, err := r.ceilingFor(ctx, owner)
	if err != nil {
		return budgetVerdict{}, err
	}

	totalCPU := reservedCPU.DeepCopy()
	totalCPU.Add(candCPU)
	totalMem := reservedMem.DeepCopy()
	totalMem.Add(candMem)
	if totalCPU.Cmp(ceilCPU) > 0 || totalMem.Cmp(ceilMem) > 0 {
		return budgetVerdict{
			message: fmt.Sprintf(
				"starting this agent would take your running agents to %s/%s CPU and %s/%s memory — stop a running sandbox to free room",
				totalCPU.String(), ceilCPU.String(), totalMem.String(), ceilMem.String()),
		}, nil
	}
	return allowedVerdict, nil
}

// resizeAllows gates a live resize (#1900): when an UP agent's rendered
// limits GREW past its owner's Ceiling, the pair parks — the same "doesn't
// fit ⇒ park" the 0→1 gate applies to starts. This makes the controller's
// enforcement complete: the api-server's synchronous resize rejection is a
// UX courtesy in front of this gate, not the enforcement, and an
// out-of-band spec write (kubectl, GitOps) cannot grow a running agent
// around the Ceiling.
//
// Returns grew=false when there is nothing to gate: the agent isn't up
// (the 0→1 gate owns admission), or the new render's limits did not grow.
// Grow detection diffs the new limits against the LIVE StatefulSet
// template, so resyncs and ceiling changes never re-check a running agent
// — the budget constrains *changes*, never running — and a shrink always
// renders: even for an over-ceiling owner, shrinking only helps.
func (r *AgentReconciler) resizeAllows(ctx context.Context, agent *apiv1.Agent, owner string) (budgetVerdict, bool, error) {
	if owner == "" {
		return allowedVerdict, false, nil
	}
	ns := r.config.Namespace
	existing, err := r.client.AppsV1().StatefulSets(ns).Get(ctx, agent.Name, metav1.GetOptions{})
	if err != nil {
		if errors.IsNotFound(err) {
			return allowedVerdict, false, nil
		}
		return budgetVerdict{}, false, fmt.Errorf("reading agent statefulset: %w", err)
	}
	if existing.Spec.Replicas == nil || *existing.Spec.Replicas < 1 {
		return allowedVerdict, false, nil
	}
	var oldCPU, oldMem resource.Quantity
	found := false
	for i := range existing.Spec.Template.Spec.Containers {
		c := &existing.Spec.Template.Spec.Containers[i]
		if c.Name == AgentContainerName {
			// Absent limits read as zero — a legacy template without limits
			// counts any concrete new size as growth, which errs toward
			// checking (conservative on a quota boundary).
			oldCPU = c.Resources.Limits[corev1.ResourceCPU]
			oldMem = c.Resources.Limits[corev1.ResourceMemory]
			found = true
		}
	}
	if !found {
		return allowedVerdict, false, nil
	}
	newCPU, newMem := r.limitsOf(&agent.Spec)
	if newCPU.Cmp(oldCPU) <= 0 && newMem.Cmp(oldMem) <= 0 {
		return allowedVerdict, false, nil
	}

	lock := r.ownerLock(owner)
	lock.Lock()
	defer lock.Unlock()

	reservedCPU, reservedMem, err := r.reservedByOwner(ctx, owner, agent.Name)
	if err != nil {
		return budgetVerdict{}, true, err
	}
	ceilCPU, ceilMem, err := r.ceilingFor(ctx, owner)
	if err != nil {
		return budgetVerdict{}, true, err
	}
	totalCPU := reservedCPU.DeepCopy()
	totalCPU.Add(newCPU)
	totalMem := reservedMem.DeepCopy()
	totalMem.Add(newMem)
	if totalCPU.Cmp(ceilCPU) > 0 || totalMem.Cmp(ceilMem) > 0 {
		return budgetVerdict{
			message: fmt.Sprintf(
				"this size takes your running agents to %s/%s CPU and %s/%s memory — shrink it, or stop another sandbox to free room",
				totalCPU.String(), ceilCPU.String(), totalMem.String(), ceilMem.String()),
		}, true, nil
	}
	return allowedVerdict, true, nil
}

// reservedByOwner sums spec.resources.limits over the owner's scaled-up
// agents, excluding `self`. Scaled-up = the agent StatefulSet (the one whose
// name equals its LabelAgent value; the paired gateway follows it) has desired
// replicas ≥ 1 — desired, not observed, so agents still starting already
// count and two near-simultaneous wakes cannot both slip under the ceiling.
func (r *AgentReconciler) reservedByOwner(ctx context.Context, owner, self string) (resource.Quantity, resource.Quantity, error) {
	ns := r.config.Namespace
	var cpu, mem resource.Quantity

	sss, err := r.client.AppsV1().StatefulSets(ns).List(ctx, metav1.ListOptions{LabelSelector: LabelAgent})
	if err != nil {
		return cpu, mem, fmt.Errorf("listing agent statefulsets: %w", err)
	}
	up := make(map[string]bool, len(sss.Items))
	for i := range sss.Items {
		ss := &sss.Items[i]
		if ss.Name != ss.Labels[LabelAgent] {
			continue // the paired gateway StatefulSet — counted with its agent's spec, not separately
		}
		if ss.Spec.Replicas != nil && *ss.Spec.Replicas >= 1 {
			up[ss.Name] = true
		}
	}

	agents, err := r.dynamic.Resource(AgentsGVR).Namespace(ns).List(ctx, metav1.ListOptions{
		LabelSelector: envoyOwnerLabel + "=" + owner,
	})
	if err != nil {
		return cpu, mem, fmt.Errorf("listing owner agents: %w", err)
	}
	for i := range agents.Items {
		item := &agents.Items[i]
		if item.GetName() == self || !up[item.GetName()] {
			continue
		}
		a, err := FromCacheObject[apiv1.Agent](item)
		if err != nil {
			return cpu, mem, fmt.Errorf("decoding agent %s: %w", item.GetName(), err)
		}
		c, m := r.limitsOf(&a.Spec)
		cpu.Add(c)
		mem.Add(m)
	}
	return cpu, mem, nil
}

// ensureConcreteSize materializes an absent Size dimension into the Agent
// spec (#1900): fill-if-absent with the chart's legacyAgentSize — the
// limits pre-Sizes agents actually ran with — never touching a set value.
// This gives `spec.resources.limits` "required" semantics without
// schema-level enforcement: every Agent the controller observes converges
// to concrete limits within one reconcile, however it was created
// (api-server, kubectl, GitOps, restore). The api-server stays the sole
// writer of user *intent*; this writes only a system default into unset
// fields — the same license the K8s scheduler takes with spec.nodeName.
//
// The in-memory spec is updated alongside the patch, so the same pass
// renders and budgets with the filled values: a legacy agent never runs at
// the wrong default, even transiently.
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

// limitsOf reads an agent's CPU/memory limits — its "size" — off its spec,
// falling back per dimension to the chart's legacyAgentSize: the value
// ensureConcreteSize will materialize on that agent's own next reconcile,
// so the budget counts what a not-yet-filled peer is about to become.
// Fallback, never zero: an unreadable OR non-positive limit must not let
// an agent slip under the ceiling.
func (r *AgentReconciler) limitsOf(spec *apiv1.AgentSpec) (resource.Quantity, resource.Quantity) {
	cpu := parseQuantityOr(spec.Resources.Limits["cpu"], r.config.LegacyAgentCPULimit)
	mem := parseQuantityOr(spec.Resources.Limits["memory"], r.config.LegacyAgentMemoryLimit)
	return cpu, mem
}

// parseQuantityOr falls back on malformed AND non-positive quantities, with
// the identical tolerance toResourceList applies at render — the two must
// agree, or the budget would count a value the pod doesn't run with.
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

// ceilingFor resolves the owner's Ceiling: their UserBudget CR when one
// exists, else the chart-wide default. A direct Get by the CEL-pinned name
// (`budget-<owner>`) is complete — a differently-named CR for this owner
// cannot exist. Read live rather than via an informer — 0→1 transitions are
// rare and a live read keeps enforcement unlagged. (An owner string that is
// label-legal but name-illegal can never have an override; Keycloak subs are
// UUIDs, so this doesn't arise.)
func (r *AgentReconciler) ceilingFor(ctx context.Context, owner string) (resource.Quantity, resource.Quantity, error) {
	obj, err := r.dynamic.Resource(UserBudgetsGVR).Namespace(r.config.Namespace).Get(ctx, "budget-"+owner, metav1.GetOptions{})
	if errors.IsNotFound(err) {
		return r.config.DefaultUserCPUBudget, r.config.DefaultUserMemoryBudget, nil
	}
	if err != nil {
		return resource.Quantity{}, resource.Quantity{}, fmt.Errorf("reading userbudget: %w", err)
	}
	b, err := FromCacheObject[apiv1.UserBudget](obj)
	if err != nil {
		return resource.Quantity{}, resource.Quantity{}, fmt.Errorf("decoding userbudget %s: %w", obj.GetName(), err)
	}
	return b.Spec.CPU, b.Spec.Memory, nil
}

// Denied-wake memo (#1900): a parked agent must NOT start by itself when
// room frees — only a NEW deliberate wake (a fresh last-activity bump) or an
// always-on agent (effective timeout 0, which declares "always run") retries
// the gate. Keyed by the last-activity value at denial time, so any later
// bump invalidates the memo naturally. In-memory: a controller restart
// forgets denials and re-evaluates once — the rare restart-time auto-start
// is accepted (leader-only single instance, same standing as the worker
// invariant).
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

func (r *AgentReconciler) clearDeniedWake(name string) {
	r.budgetMu.Lock()
	defer r.budgetMu.Unlock()
	delete(r.deniedWakes, name)
}

// ownerLock returns the per-owner mutex, lazily created.
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

// publishOverBudget parks the agent: Ready=False/OverBudget with the figures
// in the message (the api-server classifies this into a typed wake failure),
// Reconciled=True — the render succeeded, the start was refused. The idle
// checker's sweep restamps Hibernated once the activity window lapses.
func (r *AgentReconciler) publishOverBudget(ctx context.Context, agent *apiv1.Agent, msg string) error {
	gen := agent.Generation
	return updateAgentStatus(ctx, r.dynamic, r.config.Namespace, agent.Name, func(s *apiv1.AgentStatus) {
		setStatusCondition(s, apiv1.ConditionReady, false, "AllPodsReady", apiv1.ReasonOverBudget, msg, gen)
		setStatusCondition(s, apiv1.ConditionReconciled, true, "Reconciled", "", "", gen)
		s.ObservedGeneration = gen
	})
}
