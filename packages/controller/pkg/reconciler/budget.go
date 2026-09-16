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
	"github.com/kagenti/platform/packages/controller/pkg/vmrunner"
)

// UNIT_BOUNDARY_DESCRIPTION: the refusal a person reads, or empty when the start is admitted — the message is the verdict, so there is no second flag to disagree with it.
func (r *AgentReconciler) budgetAllows(ctx context.Context, agent *apiv1.Agent, owner string) (string, error) {
	if owner == "" {
		return "", nil
	}
	up, err := r.agentDesiredUp(ctx, agent.Name, agent.Spec.IsVM())
	if err != nil {
		return "", err
	}
	if up {
		return "", nil
	}

	lock := r.ownerLock(owner)
	lock.Lock()
	defer lock.Unlock()

	reservedCPU, reservedMem, err := r.reservedByOwner(ctx, owner, agent.Name)
	if err != nil {
		return "", err
	}
	candCPU, candMem := r.limitsOf(&agent.Spec)
	ceilCPU, ceilMem, err := r.ceilingFor(ctx, owner)
	if err != nil {
		return "", err
	}

	totalCPU := reservedCPU.DeepCopy()
	totalCPU.Add(candCPU)
	totalMem := reservedMem.DeepCopy()
	totalMem.Add(candMem)
	if totalCPU.Cmp(ceilCPU) > 0 || totalMem.Cmp(ceilMem) > 0 {
		return fmt.Sprintf(
			"starting this agent would take your running agents to %s/%s CPU and %s/%s memory — stop a running agent to free room",
			totalCPU.String(), ceilCPU.String(), totalMem.String(), ceilMem.String()), nil
	}
	return "", nil
}

// UNIT_BOUNDARY_DESCRIPTION: this gate exists to stop a running machine growing past its owner's ceiling, so an unreachable runner means there is no such machine to protect — and refusing here would wedge the reconcile that creates the runner in the first place.
func (r *AgentReconciler) runnerMachine(ctx context.Context, owner, name string) (vmrunner.MachineStatus, error) {
	client, err := r.runnerFor(ctx, owner)
	if err != nil {
		return vmrunner.MachineStatus{}, err
	}
	return client.Status(ctx, name)
}

func (r *AgentReconciler) resizeAllows(ctx context.Context, agent *apiv1.Agent, owner string) (string, error) {
	if owner == "" {
		return "", nil
	}
	newCPU, newMem := r.limitsOf(&agent.Spec)
	if agent.Spec.IsVM() {
		if !r.config.VM.Enabled {
			return "", nil
		}
		st, err := r.runnerMachine(ctx, owner, agent.Name)
		if err != nil {
			slog.Warn("resize budget check: reading vm machine", "agent", agent.Name, "error", err)
			return "", nil
		}
		if st.State != vmrunner.StateRunning || (newCPU.MilliValue() <= int64(st.CPUs)*1000 && newMem.Value() <= int64(st.MemoryMiB)<<20) {
			return "", nil
		}
	} else {
		ns := r.config.Namespace
		existing, err := r.client.AppsV1().StatefulSets(ns).Get(ctx, agent.Name, metav1.GetOptions{})
		if err != nil {
			if errors.IsNotFound(err) {
				return "", nil
			}
			return "", fmt.Errorf("reading agent statefulset: %w", err)
		}
		if existing.Spec.Replicas == nil || *existing.Spec.Replicas < 1 {
			return "", nil
		}
		var oldCPU, oldMem resource.Quantity
		found := false
		for i := range existing.Spec.Template.Spec.Containers {
			c := &existing.Spec.Template.Spec.Containers[i]
			if c.Name == AgentContainerName {
				oldCPU = c.Resources.Limits[corev1.ResourceCPU]
				oldMem = c.Resources.Limits[corev1.ResourceMemory]
				found = true
			}
		}
		if !found {
			return "", nil
		}
		if newCPU.Cmp(oldCPU) <= 0 && newMem.Cmp(oldMem) <= 0 {
			return "", nil
		}
	}

	lock := r.ownerLock(owner)
	lock.Lock()
	defer lock.Unlock()

	reservedCPU, reservedMem, err := r.reservedByOwner(ctx, owner, agent.Name)
	if err != nil {
		return "", err
	}
	ceilCPU, ceilMem, err := r.ceilingFor(ctx, owner)
	if err != nil {
		return "", err
	}
	totalCPU := reservedCPU.DeepCopy()
	totalCPU.Add(newCPU)
	totalMem := reservedMem.DeepCopy()
	totalMem.Add(newMem)
	if totalCPU.Cmp(ceilCPU) > 0 || totalMem.Cmp(ceilMem) > 0 {
		return fmt.Sprintf(
			"this size takes your running agents to %s/%s CPU and %s/%s memory — shrink it, or stop another agent to free room",
			totalCPU.String(), ceilCPU.String(), totalMem.String(), ceilMem.String()), nil
	}
	return "", nil
}

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
		if item.GetName() == self {
			continue
		}
		a, err := FromCacheObject[apiv1.Agent](item)
		if err != nil {
			return cpu, mem, fmt.Errorf("decoding agent %s: %w", item.GetName(), err)
		}
		workload := item.GetName()
		if a.Spec.IsVM() {
			workload = GatewayName(workload)
		}
		if !up[workload] {
			continue
		}
		c, m := r.limitsOf(&a.Spec)
		cpu.Add(c)
		mem.Add(m)
	}
	return cpu, mem, nil
}

func (r *AgentReconciler) agentDesiredUp(ctx context.Context, name string, vm bool) (bool, error) {
	if vm {
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

func (r *AgentReconciler) publishOverBudget(ctx context.Context, agent *apiv1.Agent, msg string) error {
	gen := agent.Generation
	return updateAgentStatus(ctx, r.dynamic, r.config.Namespace, agent.Name, func(s *apiv1.AgentStatus) {
		setStatusCondition(s, apiv1.ConditionReady, false, "AllPodsReady", apiv1.ReasonOverBudget, msg, gen)
		setStatusCondition(s, apiv1.ConditionAgentPodReady, false, "PodReady", apiv1.ReasonOverBudget, msg, gen)
		setStatusCondition(s, apiv1.ConditionReconciled, true, "Reconciled", "", "", gen)
		s.ObservedGeneration = gen
	})
}
