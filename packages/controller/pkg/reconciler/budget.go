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
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/types"

	apiv1 "github.com/kagenti/platform/packages/controller/api/v1"
)

type budgetVerdict struct {
	allowed bool
	message string
}

var allowedVerdict = budgetVerdict{allowed: true}

func (r *AgentReconciler) budgetAllows(ctx context.Context, agent *apiv1.Agent, owner string) (budgetVerdict, error) {
	if owner == "" {
		return allowedVerdict, nil
	}
	up, err := r.agentDesiredUp(ctx, agent.Name, agent.Spec.IsVM())
	if err != nil {
		return budgetVerdict{}, err
	}
	if up {
		return allowedVerdict, nil
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

func (r *AgentReconciler) resizeAllows(ctx context.Context, agent *apiv1.Agent, owner string) (budgetVerdict, bool, error) {
	if owner == "" {
		return allowedVerdict, false, nil
	}
	newCPU, newMem := r.limitsOf(&agent.Spec)
	if agent.Spec.IsVM() {
		grew, err := r.vmResizeGrew(ctx, agent.Name, newCPU, newMem)
		if err != nil {
			return budgetVerdict{}, false, err
		}
		if !grew {
			return allowedVerdict, false, nil
		}
	} else {
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
				oldCPU = c.Resources.Limits[corev1.ResourceCPU]
				oldMem = c.Resources.Limits[corev1.ResourceMemory]
				found = true
			}
		}
		if !found {
			return allowedVerdict, false, nil
		}
		if newCPU.Cmp(oldCPU) <= 0 && newMem.Cmp(oldMem) <= 0 {
			return allowedVerdict, false, nil
		}
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
			continue
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
		if item.GetName() == self {
			continue
		}
		a, err := FromCacheObject[apiv1.Agent](item)
		if err != nil {
			return cpu, mem, fmt.Errorf("decoding agent %s: %w", item.GetName(), err)
		}
		isUp := up[item.GetName()]
		if a.Spec.IsVM() {
			isUp, err = r.vmDesiredUp(ctx, item.GetName())
			if err != nil {
				return cpu, mem, err
			}
		}
		if !isUp {
			continue
		}
		c, m := r.limitsOf(&a.Spec)
		cpu.Add(c)
		mem.Add(m)
	}
	return cpu, mem, nil
}

func (r *AgentReconciler) agentDesiredUp(ctx context.Context, name string, vmBackend bool) (bool, error) {
	if vmBackend {
		return r.vmDesiredUp(ctx, name)
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

func (r *AgentReconciler) vmDesiredUp(ctx context.Context, name string) (bool, error) {
	vm, err := r.dynamic.Resource(VirtualMachinesGVR).Namespace(r.config.Namespace).Get(ctx, name, metav1.GetOptions{})
	if errors.IsNotFound(err) || errors.IsForbidden(err) {
		return false, nil
	}
	if err != nil {
		return false, fmt.Errorf("reading virtualmachine: %w", err)
	}
	strategy, _, _ := unstructured.NestedString(vm.Object, "spec", "runStrategy")
	return strategy == vmRunStrategyAlways, nil
}

func (r *AgentReconciler) vmResizeGrew(ctx context.Context, name string, newCPU, newMem resource.Quantity) (bool, error) {
	vm, err := r.dynamic.Resource(VirtualMachinesGVR).Namespace(r.config.Namespace).Get(ctx, name, metav1.GetOptions{})
	if errors.IsNotFound(err) || errors.IsForbidden(err) {
		return false, nil
	}
	if err != nil {
		return false, fmt.Errorf("reading virtualmachine: %w", err)
	}
	strategy, _, _ := unstructured.NestedString(vm.Object, "spec", "runStrategy")
	if strategy != vmRunStrategyAlways {
		return false, nil
	}
	oldCores, _, _ := unstructured.NestedInt64(vm.Object, "spec", "template", "spec", "domain", "cpu", "cores")
	oldMemStr, _, _ := unstructured.NestedString(vm.Object, "spec", "template", "spec", "domain", "memory", "guest")
	oldMem := parseQuantityOr(oldMemStr, resource.Quantity{})
	return vmGuestCores(newCPU) > oldCores || newMem.Cmp(oldMem) > 0, nil
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
		setStatusCondition(s, apiv1.ConditionReconciled, true, "Reconciled", "", "", gen)
		s.ObservedGeneration = gen
	})
}
