package reconciler

import (
	"context"
	"log/slog"
	"time"

	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"

	apiv1 "github.com/dam-agents/dam/packages/controller/api/v1"
	"github.com/dam-agents/dam/packages/controller/pkg/telemetry"
)

// UNIT_BOUNDARY_DESCRIPTION: what an agent's last reconcile saw of its machine: whether it should run and whether its guest answered. Kept per agent, and read only as counts across the install.
type machineSeen struct {
	owner   string
	desired bool
	up      bool
}

// UNIT_BOUNDARY_DESCRIPTION: how often the runner pass looks at every runner. It is what notices a runner's node staying unschedulable, so it bounds how far past the drain grace a budget is removed, and it is how fresh the runner health gauges are.
const RunnerHealthInterval = time.Minute

func (r *AgentReconciler) RunnerHealth() telemetry.RunnerHealth {
	if h := r.runnerHealth.Load(); h != nil {
		return *h
	}
	return telemetry.RunnerHealth{}
}

// UNIT_BOUNDARY_DESCRIPTION: one pass over every runner: each budget is brought in step with its owner's machines and its node, and what the pass saw is kept for the gauges. Rolls stalled and runners waiting for one are read from what the roll itself recorded, resizes a node has not applied from the runner pods, and machines from what each agent's own reconcile last saw, so the pass asks no runner anything.
func (r *AgentReconciler) ReconcileRunnerHealth(ctx context.Context) {
	if !r.config.VM.Enabled {
		return
	}
	selector := metav1.ListOptions{LabelSelector: "app.kubernetes.io/component=" + vmRunnerComponent}
	deps, err := r.client.AppsV1().Deployments(r.config.Namespace).List(ctx, selector)
	if err != nil {
		slog.Warn("vm runner health: listing runners failed", "error", err)
		return
	}
	h := telemetry.RunnerHealth{ResizePending: map[string]int64{}}
	refs := r.runnerOwnerRef(ctx)
	nodes := map[string]bool{}
	runners := map[string]bool{}
	for i := range deps.Items {
		dep := &deps.Items[i]
		owner := dep.Labels[envoyOwnerLabel]
		if owner == "" || dep.DeletionTimestamp != nil {
			continue
		}
		runners[dep.Name] = true
		if dep.Annotations[annRunnerStalled] != "" {
			h.RollsStalled++
		}
		lock := r.ownerLock(owner)
		lock.Lock()
		held, err := r.guardRunnerDisruptionPass(ctx, owner, refs, nodes)
		lock.Unlock()
		if err != nil {
			slog.Warn("vm runner health: keeping the runner's disruption budget in step", "owner", owner, "error", err)
		}
		if held {
			h.DrainsHeld++
		}
	}

	if pods, err := r.client.CoreV1().Pods(r.config.Namespace).List(ctx, selector); err == nil {
		for i := range pods.Items {
			for _, c := range pods.Items[i].Status.Conditions {
				if c.Type == corev1.PodResizePending && c.Status == corev1.ConditionTrue {
					h.ResizePending[resizeReasonLabel(c.Reason)]++
				}
			}
		}
	} else {
		slog.Warn("vm runner health: listing runner pods failed", "error", err)
	}

	now := time.Now()
	r.rollWaiting.Range(func(k, v any) bool {
		if !runners[k.(string)] {
			r.rollWaiting.Delete(k)
			return true
		}
		h.RollsWaiting++
		h.RollWaitOldest = max(h.RollWaitOldest, now.Sub(v.(time.Time)).Seconds())
		return true
	})

	h.MachinesDesired, h.MachinesUp, h.RunnersShort = r.countMachines()
	r.runnerHealth.Store(&h)
}

func (r *AgentReconciler) guardRunnerDisruptionPass(ctx context.Context, owner string, refs []metav1.OwnerReference, nodes map[string]bool) (bool, error) {
	running, err := r.ownerRunsMachines(ctx, owner)
	if err != nil {
		return false, err
	}
	held, err := r.syncRunnerDisruption(ctx, owner, running, refs, nodes)
	if err != nil {
		return false, err
	}
	r.disruptionSeen.Store(owner, running)
	return held, nil
}

// UNIT_BOUNDARY_DESCRIPTION: the node's reasons for not applying a resize are a closed set today, and a label must stay one, so a reason this controller does not know is counted apart rather than copied onto a series.
func resizeReasonLabel(reason string) string {
	switch reason {
	case corev1.PodReasonDeferred, corev1.PodReasonInfeasible:
		return reason
	default:
		return "Other"
	}
}

// UNIT_BOUNDARY_DESCRIPTION: an agent deleted or moved back to a container since its last reconcile no longer counts, so what each agent last saw is kept only while the informer still holds it as a vm agent. A reconciler built without that cache, in the tests, counts everything it saw.
func (r *AgentReconciler) countMachines() (desired, up, short int64) {
	perOwner := map[string][2]int64{}
	r.machineSeen.Range(func(k, v any) bool {
		name, seen := k.(string), v.(machineSeen)
		if !r.stillVMAgent(name) {
			r.machineSeen.Delete(name)
			return true
		}
		n := perOwner[seen.owner]
		if seen.desired {
			desired++
			n[0]++
		}
		if seen.up {
			up++
			n[1]++
		}
		perOwner[seen.owner] = n
		return true
	})
	for _, n := range perOwner {
		if n[1] < n[0] {
			short++
		}
	}
	return desired, up, short
}

func (r *AgentReconciler) stillVMAgent(name string) bool {
	if r.agentCache == nil {
		return true
	}
	obj, err := r.agentCache.ByNamespace(r.config.Namespace).Get(name)
	if err != nil {
		return false
	}
	a, err := FromCacheObject[apiv1.Agent](obj)
	if err != nil {
		return false
	}
	return vmSideOf(a) != nil
}
