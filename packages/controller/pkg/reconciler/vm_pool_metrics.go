package reconciler

import (
	"context"
	"fmt"
	"log/slog"
	"slices"
	"strings"
	"time"

	appsv1 "k8s.io/api/apps/v1"
	corev1 "k8s.io/api/core/v1"
	apimeta "k8s.io/apimachinery/pkg/api/meta"
	"k8s.io/apimachinery/pkg/api/resource"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/labels"

	apiv1 "github.com/dam-agents/dam/packages/controller/api/v1"
	"github.com/dam-agents/dam/packages/controller/pkg/telemetry"
)

// UNIT_BOUNDARY_DESCRIPTION: the levels a user's pool is reported at, the same the bars, the create refusal and the alerts use.
const (
	poolWarningPercent  = 75
	poolCriticalPercent = 90
)

// UNIT_BOUNDARY_DESCRIPTION: how long a runner must have had no available pod before its owner is named by an Event. It sits below the alert's fifteen minutes, so a stuck runner is announced by the time the alert fires, and above a normal Recreate roll — the old pod's termination grace plus the new pod's boot — so a roll announces nobody. The instant comes from the Deployment's Available condition, so a new leader counts the same outage the old one did.
const runnerUnavailableGrace = 10 * time.Minute

func poolLevel(used, limit int64) string {
	switch {
	case limit <= 0:
		return "ok"
	case used*100 >= limit*poolCriticalPercent:
		return "critical"
	case used*100 >= limit*poolWarningPercent:
		return "warning"
	}
	return "ok"
}

// UNIT_BOUNDARY_DESCRIPTION: what the node did with an owner's runner pod resize it has not applied, as the kubelet reports it on the pod.
type runnerCapacityState struct {
	reason, message string
}

// UNIT_BOUNDARY_DESCRIPTION: the leader's half-minute look at every user's VM pool for operators. It sums what the runners' limits and claims promise, what their requests reserve and what the nodes that can run a runner hold; counts each user's runner at the level of its pool as the runner's own usage read says; records each runner pod whose resize the node deferred or refused, each one sitting on a node the cluster has lost, and each runner Deployment that wants a pod and has none available. No user is named in a metric: a user whose pool goes critical, or whose runner the node cannot fit, has lost, or cannot start is named by a Warning Event on their vm Agents, and the second also by a condition on them. It returns the agents whose condition changed, for the caller to reconcile.
func (r *AgentReconciler) PoolPass(ctx context.Context) []string {
	if !r.config.VM.Enabled || r.config.VM.Runner.HostAddress != "" {
		return nil
	}
	pool, pending, agents, lost, unavailable, ok := r.vmPool(ctx)
	if !ok {
		return nil
	}
	telemetry.SetVMPool(pool)
	if lost != nil {
		r.noteNodeLost(ctx, lost, agents)
	}
	r.noteRunnerUnavailable(ctx, unavailable, agents)
	return r.noteRunnerCapacity(ctx, pending, agents)
}

func (r *AgentReconciler) vmPool(ctx context.Context) (telemetry.VMPool, map[string]runnerCapacityState, map[string][]*apiv1.Agent, map[string]string, map[string]time.Time, bool) {
	ns := r.config.Namespace
	component := labels.SelectorFromSet(map[string]string{"app.kubernetes.io/component": vmRunnerComponent})
	pods, err := r.client.CoreV1().Pods(ns).List(ctx, metav1.ListOptions{LabelSelector: component.String()})
	if err != nil {
		slog.WarnContext(ctx, "vm pool: listing runner pods", "error", err)
		return telemetry.VMPool{}, nil, nil, nil, nil, false
	}
	pool := telemetry.VMPool{
		Committed: map[string]int64{}, Reserved: map[string]int64{}, Capacity: map[string]int64{},
		Runners: map[[2]string]int64{}, Pending: map[string]int64{},
	}
	pending := map[string]runnerCapacityState{}
	lost := map[string]string{}
	var lostPods int64
	nodesKnown := true
	owners := map[string]bool{}
	for i := range pods.Items {
		pod := &pods.Items[i]
		owner := pod.Labels[envoyOwnerLabel]
		if owner == "" || pod.Status.Phase == corev1.PodSucceeded || pod.Status.Phase == corev1.PodFailed {
			continue
		}
		owners[owner] = true
		if onLostNode, known := r.nodeLostFor(ctx, pod); !known {
			nodesKnown = false
		} else if onLostNode {
			lostPods++
			lost[owner] = pod.Spec.NodeName
		}
		for _, c := range pod.Spec.Containers {
			if c.Name != vmRunnerComponent {
				continue
			}
			pool.Committed["memory"] += c.Resources.Limits.Memory().Value()
			pool.Committed["cpu"] += c.Resources.Limits.Cpu().MilliValue()
			pool.Reserved["memory"] += c.Resources.Requests.Memory().Value()
			pool.Reserved["cpu"] += c.Resources.Requests.Cpu().MilliValue()
		}
		if st, ok := resizePending(pod); ok {
			pending[owner] = st
			reason := "deferred"
			if st.reason == apiv1.ReasonRunnerResizeInfeasible {
				reason = "infeasible"
			}
			pool.Pending[reason]++
		}
	}
	classes := r.poolClaims(ctx, component, &pool)
	r.poolCapacity(ctx, classes, &pool)
	// UNIT_BOUNDARY_DESCRIPTION: a runner Deployment is counted, not its pods: a pod admission refuses is never created, which is exactly the failure this signal exists for. A Deployment scaled to zero or going away is not a runner that should be up. A failed list says nothing about any runner, so this keeps the last count rather than reporting zero and clearing the alert, and leaves the notices alone: nil tells the caller it learned nothing.
	var unavailable map[string]time.Time
	deps, err := r.client.AppsV1().Deployments(ns).List(ctx, metav1.ListOptions{LabelSelector: component.String()})
	if err != nil {
		slog.WarnContext(ctx, "vm pool: listing runner deployments", "error", err)
		pool.Unavailable = r.unavailableLast.Load()
	} else {
		unavailable = map[string]time.Time{}
		for i := range deps.Items {
			dep := &deps.Items[i]
			if dep.DeletionTimestamp != nil || (dep.Spec.Replicas != nil && *dep.Spec.Replicas == 0) || dep.Status.AvailableReplicas > 0 {
				continue
			}
			pool.Unavailable++
			if since, ok := runnerUnavailableSince(dep); ok {
				if owner := dep.Labels[envoyOwnerLabel]; owner != "" {
					unavailable[owner] = since
				}
			}
		}
		r.unavailableLast.Store(pool.Unavailable)
	}
	agents := r.vmAgentsByOwner(ctx)
	r.poolLevels.Range(func(key, _ any) bool {
		if owner, _, _ := strings.Cut(key.(string), "/"); !owners[owner] {
			r.poolLevels.Delete(key)
		}
		return true
	})
	for owner := range owners {
		r.poolLevelsOf(ctx, owner, agents[owner], &pool)
	}
	if nodesKnown {
		r.nodeLostLast.Store(lostPods)
		pool.NodeLost = lostPods
		return pool, pending, agents, lost, unavailable, true
	}
	// UNIT_BOUNDARY_DESCRIPTION: a node that cannot be read — a watch not yet synced, or a read that failed — says nothing about any runner, so this pass keeps the last count rather than clearing the alert, and leaves the notices alone rather than announcing the same loss again once the nodes are readable: nil tells the caller it learned nothing about any node.
	pool.NodeLost = r.nodeLostLast.Load()
	return pool, pending, agents, nil, unavailable, true
}

// UNIT_BOUNDARY_DESCRIPTION: when the Deployment last became unavailable, from its Available condition so the grace is judged across passes and a leader change. A Deployment whose status carries no such condition has no instant to measure, so its owner is counted but not yet named.
func runnerUnavailableSince(dep *appsv1.Deployment) (time.Time, bool) {
	for _, c := range dep.Status.Conditions {
		if c.Type == appsv1.DeploymentAvailable && c.Status == corev1.ConditionFalse {
			return c.LastTransitionTime.Time, true
		}
	}
	return time.Time{}, false
}

func resizePending(pod *corev1.Pod) (runnerCapacityState, bool) {
	for _, c := range pod.Status.Conditions {
		if c.Type != corev1.PodResizePending || c.Status != corev1.ConditionTrue {
			continue
		}
		if c.Reason == corev1.PodReasonInfeasible {
			return runnerCapacityState{apiv1.ReasonRunnerResizeInfeasible, "the node can never give this user's VM runner what their pool asks: " + c.Message}, true
		}
		return runnerCapacityState{apiv1.ReasonRunnerResizeDeferred, "the node has deferred giving this user's VM runner what their pool asks: " + c.Message}, true
	}
	return runnerCapacityState{}, false
}

// UNIT_BOUNDARY_DESCRIPTION: Σ the runner claims' requests, and the storage classes they are on, which is where storage capacity is looked up.
func (r *AgentReconciler) poolClaims(ctx context.Context, component labels.Selector, pool *telemetry.VMPool) []string {
	claims, err := r.client.CoreV1().PersistentVolumeClaims(r.config.Namespace).List(ctx, metav1.ListOptions{LabelSelector: component.String()})
	if err != nil {
		slog.WarnContext(ctx, "vm pool: listing runner claims", "error", err)
		return nil
	}
	var classes []string
	for _, c := range claims.Items {
		pool.Committed["storage"] += c.Spec.Resources.Requests.Storage().Value()
		if c.Spec.StorageClassName != nil && !slices.Contains(classes, *c.Spec.StorageClassName) {
			classes = append(classes, *c.Spec.StorageClassName)
		}
	}
	return classes
}

// UNIT_BOUNDARY_DESCRIPTION: what the nodes that could run a runner hold — schedulable, matching the runner's node selector, advertising its devices — and the storage the runner claims' classes have left where their driver publishes it. A driver that publishes nothing leaves storage capacity out rather than reported as zero.
func (r *AgentReconciler) poolCapacity(ctx context.Context, classes []string, pool *telemetry.VMPool) {
	want := corev1.ResourceList{}
	for name, v := range r.config.VM.Runner.Devices {
		if q, err := resource.ParseQuantity(v); err == nil {
			want[corev1.ResourceName(name)] = q
		}
	}
	nodes, err := r.client.CoreV1().Nodes().List(ctx, metav1.ListOptions{
		LabelSelector: labels.SelectorFromSet(r.config.VM.Runner.NodeSelector).String(),
	})
	if err != nil {
		slog.WarnContext(ctx, "vm pool: listing nodes", "error", err)
	} else {
		for _, n := range nodes.Items {
			if n.Spec.Unschedulable || !hasResources(n.Status.Allocatable, want) {
				continue
			}
			pool.Capacity["memory"] += n.Status.Allocatable.Memory().Value()
			pool.Capacity["cpu"] += n.Status.Allocatable.Cpu().MilliValue()
		}
	}
	if len(classes) == 0 {
		return
	}
	capacities, err := r.client.StorageV1().CSIStorageCapacities(metav1.NamespaceAll).List(ctx, metav1.ListOptions{})
	if err != nil {
		slog.DebugContext(ctx, "vm pool: listing storage capacities", "error", err)
		return
	}
	for _, c := range capacities.Items {
		if c.Capacity != nil && slices.Contains(classes, c.StorageClassName) {
			pool.Capacity["storage"] += c.Capacity.Value()
		}
	}
}

// UNIT_BOUNDARY_DESCRIPTION: one user's pool levels, from their runner's own usage read: memory as admission counts it against the limit, storage as the claim's guard measures it. A runner that does not answer is left out of the counts this pass rather than counted as ok. A level that becomes critical writes one Warning Event on each of the user's vm Agents, which is how an operator learns whose pool it is.
func (r *AgentReconciler) poolLevelsOf(ctx context.Context, owner string, agents []*apiv1.Agent, pool *telemetry.VMPool) {
	runner, err := r.runnerFor(ctx, owner)
	if err != nil {
		return
	}
	usage, err := runner.Usage(ctx)
	if err != nil {
		slog.DebugContext(ctx, "vm pool: reading a runner's usage", "owner", owner, "error", err)
		return
	}
	for _, m := range []struct {
		resource    string
		used, limit int64
	}{
		{"memory", usage.Memory.CommittedMiB, usage.Memory.LimitMiB},
		{"storage", usage.Storage.UsedBytes, usage.Storage.UsableBytes},
	} {
		level := poolLevel(m.used, m.limit)
		pool.Runners[[2]string{m.resource, level}]++
		previous, seen := r.poolLevels.Swap(owner+"/"+m.resource, level)
		if level != "critical" || previous == "critical" || (!seen && r.poolCriticalAnnounced(ctx, agents, m.resource)) {
			continue
		}
		msg := fmt.Sprintf("this user's VM %s pool is %d%% full", m.resource, m.used*100/m.limit)
		for _, a := range agents {
			r.agentEvent(ctx, a, corev1.EventTypeWarning, "VMPoolCritical", msg)
		}
	}
}

// UNIT_BOUNDARY_DESCRIPTION: whether a pool the controller sees for the first time since it started was already announced, by a VMPoolCritical Event for that resource on any of the user's agents. The level is kept in memory alone, so without this a restart repeats the Event of a pool that never left critical; the cluster drops Events after its TTL (an hour by default), so a restart later than that announces it once more.
func (r *AgentReconciler) poolCriticalAnnounced(ctx context.Context, agents []*apiv1.Agent, resource string) bool {
	if len(agents) == 0 {
		return false
	}
	events, err := r.client.CoreV1().Events(r.config.Namespace).List(ctx, metav1.ListOptions{FieldSelector: "reason=VMPoolCritical"})
	if err != nil {
		slog.DebugContext(ctx, "vm pool: listing the user's pool events", "error", err)
		return false
	}
	names := make(map[string]bool, len(agents))
	for _, a := range agents {
		names[a.Name] = true
	}
	for _, e := range events.Items {
		if e.Reason == "VMPoolCritical" && names[e.InvolvedObject.Name] && strings.Contains(e.Message, "VM "+resource+" pool") {
			return true
		}
	}
	return false
}
func (r *AgentReconciler) vmAgentsByOwner(ctx context.Context) map[string][]*apiv1.Agent {
	byOwner := map[string][]*apiv1.Agent{}
	if r.agentCache == nil {
		return byOwner
	}
	items, err := r.agentCache.ByNamespace(r.config.Namespace).List(labels.Everything())
	if err != nil {
		slog.WarnContext(ctx, "vm pool: listing agents", "error", err)
		return byOwner
	}
	for _, obj := range items {
		a, err := FromCacheObject[apiv1.Agent](obj)
		if err != nil || !a.Spec.IsVM() || a.Labels[envoyOwnerLabel] == "" {
			continue
		}
		byOwner[a.Labels[envoyOwnerLabel]] = append(byOwner[a.Labels[envoyOwnerLabel]], a)
	}
	return byOwner
}

// UNIT_BOUNDARY_DESCRIPTION: keeps each user's resize state for their agents' next reconcile, writes one Warning Event on each of their vm Agents when the state appears or changes reason, and returns those agents so their condition follows at once.
func (r *AgentReconciler) noteRunnerCapacity(ctx context.Context, pending map[string]runnerCapacityState, agents map[string][]*apiv1.Agent) []string {
	var changed []string
	r.runnerCapacity.Range(func(key, _ any) bool {
		if _, still := pending[key.(string)]; !still {
			r.runnerCapacity.Delete(key)
			for _, a := range agents[key.(string)] {
				changed = append(changed, a.Name)
			}
		}
		return true
	})
	for owner, st := range pending {
		previous, had := r.runnerCapacity.Swap(owner, st)
		if had && previous.(runnerCapacityState).reason == st.reason {
			continue
		}
		for _, a := range agents[owner] {
			r.agentEvent(ctx, a, corev1.EventTypeWarning, st.reason, st.message)
			changed = append(changed, a.Name)
		}
	}
	return changed
}

// UNIT_BOUNDARY_DESCRIPTION: names the owner of each runner Deployment that has wanted a pod and had none available for the grace, by one Warning Event on each of their vm Agents when the state appears, which is how the shipped alert's events line finds them without an exported series naming a person. A runner that just lost its pod is not named, so a normal roll and a first boot announce nobody. A runner that heals is forgotten, so it is announced again if it fails again.
func (r *AgentReconciler) noteRunnerUnavailable(ctx context.Context, unavailable map[string]time.Time, agents map[string][]*apiv1.Agent) {
	if unavailable == nil {
		return
	}
	r.runnerUnavailable.Range(func(key, _ any) bool {
		if _, still := unavailable[key.(string)]; !still {
			r.runnerUnavailable.Delete(key)
		}
		return true
	})
	now := time.Now()
	for owner, since := range unavailable {
		if now.Sub(since) < runnerUnavailableGrace {
			continue
		}
		if _, had := r.runnerUnavailable.LoadOrStore(owner, true); had {
			continue
		}
		msg := "this user's VM runner has had no available pod for ten minutes: their agents cannot start or reach their machines until it has one"
		for _, a := range agents[owner] {
			r.agentEvent(ctx, a, corev1.EventTypeWarning, "RunnerUnavailable", msg)
		}
	}
}

// UNIT_BOUNDARY_DESCRIPTION: keeps each user's lost node for the next pass, and writes one Warning Event on each of their vm Agents when it appears or changes. Nothing deletes the runner pod: two VMMs on one claim cannot be recovered, so an operator brings the node back or fences it out of service. A node that stays lost is announced once, not on every pass.
func (r *AgentReconciler) noteNodeLost(ctx context.Context, lost map[string]string, agents map[string][]*apiv1.Agent) {
	r.nodeLostNotices.Range(func(key, value any) bool {
		if node, still := lost[key.(string)]; !still || node != value.(string) {
			r.nodeLostNotices.Delete(key)
		}
		return true
	})
	for owner, node := range lost {
		if _, had := r.nodeLostNotices.Load(owner); had {
			continue
		}
		r.nodeLostNotices.Store(owner, node)
		msg := "this user's VM runner is on node " + node + ", which the cluster has not reported ready for five minutes; every machine of theirs is down until that node comes back or is fenced"
		for _, a := range agents[owner] {
			r.agentEvent(ctx, a, corev1.EventTypeWarning, apiv1.ReasonMachineRunnerNodeLost, msg)
		}
	}
}

// UNIT_BOUNDARY_DESCRIPTION: the condition an agent carries while its owner's runner pod waits on a resize the node has not applied; absent otherwise. Readiness is not touched: the machine runs at what the pod has.
func (r *AgentReconciler) runnerCapacityCondition(s *apiv1.AgentStatus, agent *apiv1.Agent) {
	v, ok := r.runnerCapacity.Load(agent.Labels[envoyOwnerLabel])
	if !ok {
		apimeta.RemoveStatusCondition(&s.Conditions, apiv1.ConditionRunnerCapacity)
		return
	}
	st := v.(runnerCapacityState)
	setStatusCondition(s, apiv1.ConditionRunnerCapacity, false, "", st.reason, st.message, agent.Generation)
}
