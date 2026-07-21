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
	"k8s.io/client-go/dynamic"
	"k8s.io/client-go/kubernetes"

	apiv1 "github.com/kagenti/platform/packages/controller/api/v1"
	"github.com/kagenti/platform/packages/controller/pkg/config"
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

	lock := ownerBudgetLock(owner)
	lock.Lock()
	defer lock.Unlock()

	reservedCPU, reservedMem, err := reservedByOwner(ctx, r.client, r.dynamic, r.config, owner, agent.Name)
	if err != nil {
		return budgetVerdict{}, err
	}
	candCPU, candMem := r.limitsOf(&agent.Spec)
	ceilCPU, ceilMem, err := ceilingFor(ctx, r.dynamic, r.config, owner)
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

// forkBudgetAllows decides whether starting a fork's pods fits the REPLIER's
// Ceiling (#2843) — a fork reserves against the user driving it, at the
// parent agent's Size (the fork pod runs the parent's limits). Callers hold
// the replier's ownerBudgetLock across this check AND the Job create, so the
// reservation write is inside the lock — fork-vs-fork admits for one replier
// cannot interleave. (A fork admit racing an *agent* admit for the same
// owner retains the narrow read-decide window the agent path accepts; a
// slip is bounded by one Size and re-gated at every next 0→1.)
func forkBudgetAllows(
	ctx context.Context,
	client kubernetes.Interface,
	dyn dynamic.Interface,
	cfg *config.Config,
	foreignSub string,
	parentSpec *apiv1.AgentSpec,
) (budgetVerdict, error) {
	if foreignSub == "" {
		return allowedVerdict, nil
	}
	reservedCPU, reservedMem, err := reservedByOwner(ctx, client, dyn, cfg, foreignSub, "")
	if err != nil {
		return budgetVerdict{}, err
	}
	candCPU := parseQuantityOr(parentSpec.Resources.Limits["cpu"], cfg.LegacyAgentCPULimit)
	candMem := parseQuantityOr(parentSpec.Resources.Limits["memory"], cfg.LegacyAgentMemoryLimit)
	ceilCPU, ceilMem, err := ceilingFor(ctx, dyn, cfg, foreignSub)
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
				"running this turn would take your reserved compute to %s/%s CPU and %s/%s memory — stop a running sandbox (or let one of your forks hibernate) to free room",
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

	lock := ownerBudgetLock(owner)
	lock.Lock()
	defer lock.Unlock()

	reservedCPU, reservedMem, err := reservedByOwner(ctx, r.client, r.dynamic, r.config, owner, agent.Name)
	if err != nil {
		return budgetVerdict{}, true, err
	}
	ceilCPU, ceilMem, err := ceilingFor(ctx, r.dynamic, r.config, owner)
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
// agents, excluding `self`, plus the live fork pods acting as that owner
// (#2843) — each at its parent agent's Size, which is what the fork pod
// actually runs with. Scaled-up = the agent StatefulSet (the one whose
// name equals its LabelAgent value; the paired gateway follows it) has desired
// replicas ≥ 1 — desired, not observed, so agents still starting already
// count and two near-simultaneous wakes cannot both slip under the ceiling.
// A fork counts while its Job exists — a hibernated fork's Job is deleted,
// so hibernation credits the budget back like an agent's scale-down.
func reservedByOwner(ctx context.Context, client kubernetes.Interface, dyn dynamic.Interface, cfg *config.Config, owner, self string) (resource.Quantity, resource.Quantity, error) {
	ns := cfg.Namespace
	var cpu, mem resource.Quantity

	sss, err := client.AppsV1().StatefulSets(ns).List(ctx, metav1.ListOptions{LabelSelector: LabelAgent})
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

	agents, err := dyn.Resource(AgentsGVR).Namespace(ns).List(ctx, metav1.ListOptions{
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
		c, m := limitsOfSpec(cfg, &a.Spec)
		cpu.Add(c)
		mem.Add(m)
	}

	fCPU, fMem, err := forkReservedByOwner(ctx, client, dyn, cfg, owner)
	if err != nil {
		return cpu, mem, err
	}
	cpu.Add(fCPU)
	mem.Add(fMem)
	return cpu, mem, nil
}

// forkReservedByOwner sums the Sizes of the owner's live forks — Fork CRs
// whose spec.foreignSub matches (no label shortcut: subs like `kc|…` are not
// label-legal values) and whose agent Job currently exists. Each counts at
// its parent agent's Size; a fork whose parent is gone is moments from GC
// and counts nothing.
func forkReservedByOwner(ctx context.Context, client kubernetes.Interface, dyn dynamic.Interface, cfg *config.Config, owner string) (resource.Quantity, resource.Quantity, error) {
	ns := cfg.Namespace
	var cpu, mem resource.Quantity

	forks, err := dyn.Resource(ForksGVR).Namespace(ns).List(ctx, metav1.ListOptions{})
	if err != nil {
		return cpu, mem, fmt.Errorf("listing forks: %w", err)
	}
	if len(forks.Items) == 0 {
		return cpu, mem, nil
	}

	jobs, err := client.BatchV1().Jobs(ns).List(ctx, metav1.ListOptions{
		LabelSelector: ForkLabelType + "=" + ForkJobLabelType,
	})
	if err != nil {
		return cpu, mem, fmt.Errorf("listing fork jobs: %w", err)
	}
	live := make(map[string]bool, len(jobs.Items))
	for i := range jobs.Items {
		if jobs.Items[i].DeletionTimestamp == nil {
			live[jobs.Items[i].Name] = true
		}
	}

	parentSizes := map[string][2]resource.Quantity{}
	for i := range forks.Items {
		f, err := FromCacheObject[apiv1.Fork](&forks.Items[i])
		if err != nil {
			return cpu, mem, fmt.Errorf("decoding fork %s: %w", forks.Items[i].GetName(), err)
		}
		if f.Spec.ForeignSub != owner || !live[f.Name] {
			continue
		}
		size, ok := parentSizes[f.Spec.AgentName]
		if !ok {
			parent, err := dyn.Resource(AgentsGVR).Namespace(ns).Get(ctx, f.Spec.AgentName, metav1.GetOptions{})
			if errors.IsNotFound(err) {
				continue
			}
			if err != nil {
				return cpu, mem, fmt.Errorf("reading fork parent %s: %w", f.Spec.AgentName, err)
			}
			a, err := FromCacheObject[apiv1.Agent](parent)
			if err != nil {
				return cpu, mem, fmt.Errorf("decoding fork parent %s: %w", f.Spec.AgentName, err)
			}
			c, m := limitsOfSpec(cfg, &a.Spec)
			size = [2]resource.Quantity{c, m}
			parentSizes[f.Spec.AgentName] = size
		}
		cpu.Add(size[0])
		mem.Add(size[1])
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
	return limitsOfSpec(r.config, spec)
}

func limitsOfSpec(cfg *config.Config, spec *apiv1.AgentSpec) (resource.Quantity, resource.Quantity) {
	cpu := parseQuantityOr(spec.Resources.Limits["cpu"], cfg.LegacyAgentCPULimit)
	mem := parseQuantityOr(spec.Resources.Limits["memory"], cfg.LegacyAgentMemoryLimit)
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
func ceilingFor(ctx context.Context, dyn dynamic.Interface, cfg *config.Config, owner string) (resource.Quantity, resource.Quantity, error) {
	obj, err := dyn.Resource(UserBudgetsGVR).Namespace(cfg.Namespace).Get(ctx, "budget-"+owner, metav1.GetOptions{})
	if errors.IsNotFound(err) {
		return cfg.DefaultUserCPUBudget, cfg.DefaultUserMemoryBudget, nil
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

// Package-level per-owner budget locks: agent admits run on the single agent
// worker, but fork admits run on the fork worker (#2843), so the lock — not
// worker exclusivity — is what serializes budget read-decide-act sequences
// for one owner across the two. Fork admits hold it through their Job
// create; agent admits keep their original scope.
var (
	budgetLocksMu sync.Mutex
	budgetLocks   = map[string]*sync.Mutex{}
)

// ownerBudgetLock returns the per-owner mutex, lazily created.
func ownerBudgetLock(owner string) *sync.Mutex {
	budgetLocksMu.Lock()
	defer budgetLocksMu.Unlock()
	l, ok := budgetLocks[owner]
	if !ok {
		l = &sync.Mutex{}
		budgetLocks[owner] = l
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
