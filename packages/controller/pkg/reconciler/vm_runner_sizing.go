package reconciler

import (
	"context"
	"fmt"
	"log/slog"
	"slices"

	corev1 "k8s.io/api/core/v1"
	k8serrors "k8s.io/apimachinery/pkg/api/errors"
	apimeta "k8s.io/apimachinery/pkg/api/meta"
	"k8s.io/apimachinery/pkg/api/resource"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/labels"
	"k8s.io/apimachinery/pkg/runtime"

	apiv1 "github.com/dam-agents/dam/packages/controller/api/v1"
	"github.com/dam-agents/dam/packages/controller/pkg/vmrunner"
)

const (
	resizeSupportUnknown int32 = iota
	resizeSupported
	resizeUnsupported
)

// UNIT_BOUNDARY_DESCRIPTION: what an owner's vm agents ask of their runner's memory and CPU, as the controller intends it rather than as the runner last saw it. It counts only the machines that should be running, because that is what the runner admits against its limits.
type runnerDemand struct {
	memoryMiB int
	vCPUs     int
}

// UNIT_BOUNDARY_DESCRIPTION: a vm agent has no size of its own: every machine may grow to half of what its owner's runner hands out — their pool, from their UserBudget's `memory`, else the install's runner limit — so one agent can use most of the pool while a runaway guest meets its own OOM killer before it takes the runner, and every sibling, over the limit. The host runner admits against a share of the Mac's memory that the controller never learns, not against the chart's pod limit, so there the agent's spec still sets its machine's memory.
func (r *AgentReconciler) machineMemoryMiB(ctx context.Context, owner string, spec *apiv1.AgentSpec) (int, error) {
	var err error
	limit := 0
	if r.config.VM.Runner.HostAddress == "" {
		limit, err = r.runnerLimitMiB(ctx, owner)
	}
	if err == nil && limit > 0 {
		return max((limit-r.config.VM.Runner.ReserveMiB)/2, 1), nil
	}
	_, mem := r.limitsOf(spec)
	return max(int(mem.Value()>>20), 1), err
}

// UNIT_BOUNDARY_DESCRIPTION: the demand that sizes a start: the machine being started counts whatever a refusal from an attempt before says, since the room it needs is what its count is for.
func (r *AgentReconciler) ownerRunnerDemand(ctx context.Context, owner string, self *apiv1.Agent, selfRunning bool) (runnerDemand, error) {
	return r.runnerDemand(ctx, owner, self, selfRunning, true)
}

// UNIT_BOUNDARY_DESCRIPTION: the demand the memory pass judges pressure from: what the owner's runner holds or is about to hold, without the machines it refused for room or storage, the start the pass counts from included, since a machine that holds nothing must not hibernate the ones the runner did admit.
func (r *AgentReconciler) heldRunnerDemand(ctx context.Context, owner string, self *apiv1.Agent, selfRunning bool) (runnerDemand, error) {
	return r.runnerDemand(ctx, owner, self, selfRunning, false)
}

// UNIT_BOUNDARY_DESCRIPTION: the controller knows an agent should run before its machine does, so demand is read from the Agents rather than from the runner — a request raised from the runner's own count would always arrive one machine late, after the runner had admitted it. The agent being reconciled is counted by the decision just made for it; its peers by their gateway, which is scaled up exactly when their machine should run. Only the reconcile that made that decision records it for the peers' later reads: a caller that merely sizes, like the memory pass, passes its own read and leaves the record alone, so it cannot put back a decision a reconcile has since changed. An agent whose disk size cannot be read is left out, because its own reconcile already refuses it. A machine the runner refused for room or for storage holds nothing until a retry gets it running, so it is left out with `ownStart` unset, and counted under it only as the start its count is for.
func (r *AgentReconciler) runnerDemand(ctx context.Context, owner string, self *apiv1.Agent, selfRunning, ownStart bool) (runnerDemand, error) {
	items, err := r.ownerAgents(ctx, owner)
	if err != nil {
		return runnerDemand{}, err
	}
	agents := []*apiv1.Agent{self}
	for _, obj := range items {
		a, err := FromCacheObject[apiv1.Agent](obj)
		if err != nil {
			return runnerDemand{}, fmt.Errorf("decoding an agent of owner %s: %w", owner, err)
		}
		if vm := vmSideOf(a); a.Name != self.Name && vm != nil {
			agents = append(agents, vm)
		}
	}
	var d runnerDemand
	for _, a := range agents {
		if _, err := resolveVMDiskGiB(&a.Spec, r.config.AgentTemplateDefaults); err != nil {
			continue
		}
		running := selfRunning
		if a.Name != self.Name {
			if running, err = r.peerShouldRun(ctx, a.Name); err != nil {
				return runnerDemand{}, err
			}
		}
		if running && (ownStart && a.Name == self.Name || !r.refusedWithoutMachine(a)) {
			d.memoryMiB += r.accountedMemoryMiB(ctx, owner, a.Name, &a.Spec)
			d.vCPUs += max(r.config.VM.Runner.MachineCPUs, r.liveMachine(a.Name).CPUs, 1)
		}
	}
	return d, nil
}

// UNIT_BOUNDARY_DESCRIPTION: demand is read on every reconcile of every vm agent, and a starting machine is reconciled every half second, so the owner's agents come from the informer cache the controller already keeps rather than from a live List. A reconciler built without that cache — the tests — lists them live.
func (r *AgentReconciler) ownerAgents(ctx context.Context, owner string) ([]runtime.Object, error) {
	selector := labels.SelectorFromSet(labels.Set{envoyOwnerLabel: owner})
	if r.agentCache != nil {
		items, err := r.agentCache.ByNamespace(r.config.Namespace).List(selector)
		if err != nil {
			return nil, fmt.Errorf("listing the owner's agents: %w", err)
		}
		return items, nil
	}
	list, err := r.dynamic.Resource(AgentsGVR).Namespace(r.config.Namespace).List(ctx, metav1.ListOptions{LabelSelector: selector.String()})
	if err != nil {
		return nil, fmt.Errorf("listing the owner's agents: %w", err)
	}
	items := make([]runtime.Object, len(list.Items))
	for i := range list.Items {
		items[i] = &list.Items[i]
	}
	return items, nil
}

// UNIT_BOUNDARY_DESCRIPTION: whether an agent's machine should run is the decision its own last reconcile made, which this controller keeps in memory. Only an agent not reconciled since the controller started is read from the cluster, by its gateway, which is scaled up exactly when its machine should run.
func (r *AgentReconciler) peerShouldRun(ctx context.Context, name string) (bool, error) {
	if running, ok := r.vmRunning.Load(name); ok {
		return running.(bool), nil
	}
	return r.agentDesiredUp(ctx, name, true)
}

// UNIT_BOUNDARY_DESCRIPTION: a machine the runner refused for room is parked — the Agent reads OverBudget — and one it refused for storage leaves the Agent awake with no machine. Either holds nothing until a retry gets it running, so it counts toward nothing. The runner's own answer governs: it is recorded where the runner gave it, under the owner's lock, so a refusal counts before the Agent's status carries it, and a machine the runner admitted counts while it boots, before it is a live machine. The status is read only when no answer is recorded, for a refusal this controller did not see. A machine that runs anyway counts as any other, whatever a refusal from an attempt before says.
func (r *AgentReconciler) refusedWithoutMachine(a *apiv1.Agent) bool {
	if r.liveMachine(a.Name).State == vmrunner.StateRunning {
		return false
	}
	if answer, recorded := r.vmAnswers.Load(a.Name); recorded {
		refused, _ := answer.(bool)
		return refused
	}
	ready := apimeta.FindStatusCondition(a.Status.Conditions, apiv1.ConditionReady)
	if ready != nil && ready.Reason == apiv1.ReasonOverBudget {
		return true
	}
	// UNIT_BOUNDARY_DESCRIPTION: the status carries the runner's reason, except that a full home is published as HomeVolumeFull, since the page and the UI name a volume rather than the runner's word for it.
	podReady := apimeta.FindStatusCondition(a.Status.Conditions, apiv1.ConditionAgentPodReady)
	return podReady != nil && (refusedReason(podReady.Reason) || podReady.Reason == apiv1.ReasonHomeVolumeFull)
}

// UNIT_BOUNDARY_DESCRIPTION: the runner answers a start it will not run with a reason, and leaves the reason of a start that failed on the machine afterwards — a full home, an image it cannot fetch, a missing seed, a boot that failed — until an action succeeds. Both leave the machine holding nothing, so both count toward nothing.
func refusedReason(reason string) bool {
	switch reason {
	case vmrunner.ReasonOutOfCapacity, vmrunner.ReasonStorageFull, vmrunner.ReasonHomeFull,
		vmrunner.ReasonImageUnavailable, vmrunner.ReasonImageCacheUnreachable,
		vmrunner.ReasonSeedMissing, vmrunner.ReasonBootFailed:
		return true
	}
	return false
}

// UNIT_BOUNDARY_DESCRIPTION: the runner keeps a refusal's reason after it admits the retry — it clears it only when that action completes — so the reason alone does not say the machine holds nothing. A refusal with nothing running or in flight does: the machine holds its memory while it boots, restarts or stops, and while it runs, whatever a refusal from an attempt before says.
func refusedAnswer(st vmrunner.MachineStatus) bool {
	switch st.State {
	case "", vmrunner.StateAbsent, vmrunner.StateStopped:
		return refusedReason(st.Reason)
	}
	return false
}

// UNIT_BOUNDARY_DESCRIPTION: the runner admits machines against its memory limit, and the scheduler places pods by requests — so with a request below the limit, the node lends out memory the runner's guests are already using, and a busy node OOM-kills the runner with every machine of that owner. The request follows the memory of the machines that should be running plus the runner's own reserve. It rises at once, but falls only once that has dropped a quarter step below the step under the current request, so a guest whose use sits on a step boundary does not resize the pod at every pass. It never drops below what the install asked for, which is the request Kubernetes gives the pod when the install asked for none, and never rises above the limit, which the API refuses.
func runnerMemoryRequest(demandMiB, reserveMiB int, current, floor, limit resource.Quantity) resource.Quantity {
	needMiB := demandMiB + reserveMiB
	wantMiB := roundedMiB(needMiB)
	if currentMiB := int(current.Value() >> 20); wantMiB < currentMiB && needMiB > currentMiB-memoryRequestStepMiB-memoryRequestStepMiB/4 {
		wantMiB = currentMiB
	}
	want := *resource.NewQuantity(int64(wantMiB)<<20, resource.BinarySI)
	if want.Cmp(floor) < 0 {
		want = floor
	}
	if want.Cmp(limit) > 0 {
		want = limit
	}
	return want
}

// UNIT_BOUNDARY_DESCRIPTION: every machine of an owner is a VMM process inside the runner pod, so with no CPU limit one runaway VMM can take every core of the node and slow every pod there. The limit is the vCPUs of the machines that should be running, each counted at the larger of its live and its next size, plus one machine's worth for the runner itself and the VMMs' own I/O threads. Unless the install caps it lower, a guest is never throttled below the vCPUs it was given. With no machine running the runner keeps that one machine's worth, so the first start is not throttled before the next resize lands. It is never below the CPU request, which the API refuses, and never above a CPU limit the install set.
func runnerCPULimit(vCPUs, machineCPUs int, request resource.Quantity, ceiling *resource.Quantity) resource.Quantity {
	want := *resource.NewQuantity(int64(vCPUs+max(machineCPUs, 1)), resource.DecimalSI)
	if ceiling != nil && want.Cmp(*ceiling) > 0 {
		want = *ceiling
	}
	if want.Cmp(request) < 0 {
		want = request
	}
	return want
}

// UNIT_BOUNDARY_DESCRIPTION: an owner's pool can be lowered below what their running machines are counted at, and lowering the runner's memory limit under them would have the kernel kill the runner with every machine. So a limit that falls stops at the machines' count plus the reserve, rounded up to the request step, and comes down further only as they stop; the runner admits no new machine meanwhile, because its limit is already taken. A limit that rises goes to the pool at once.
func runnerMemoryLimit(poolMiB, demandMiB, reserveMiB int, current resource.Quantity) resource.Quantity {
	pool := *resource.NewQuantity(int64(poolMiB)<<20, resource.BinarySI)
	if pool.Cmp(current) >= 0 {
		return pool
	}
	floorMiB := max(poolMiB, roundedMiB(demandMiB+reserveMiB))
	return *resource.NewQuantity(min(int64(floorMiB)<<20, current.Value()), resource.BinarySI)
}

// UNIT_BOUNDARY_DESCRIPTION: what the runner container of a scheduled, live runner pod has and what the owner's pool and demand want of it: the memory limit, the memory request and the CPU limit. A pod being deleted or not yet placed, or a container without a memory limit, is not resized.
type runnerPodWant struct {
	res                                      *corev1.ResourceRequirements
	memoryLimit, memoryRequest, cpu          resource.Quantity
	hasCPURequest                            bool
	currentLimit, currentRequest, currentCPU resource.Quantity
	hasCPULimit                              bool
}

func (p runnerPodWant) moves() bool {
	return p.currentLimit.Cmp(p.memoryLimit) != 0 || p.currentRequest.Cmp(p.memoryRequest) != 0 || !p.hasCPULimit || p.currentCPU.Cmp(p.cpu) != 0
}

// UNIT_BOUNDARY_DESCRIPTION: only the runner's live pod is sized: Running and not terminating. The owner label also selects the pods a roll, an eviction or a stop left behind, Failed or Succeeded, which the Deployment keeps until they are collected, and each one would be resized again on every reconcile. The Recreate strategy stops every pod of an old ReplicaSet before the new one starts, so a Running pod that is not terminating is the current ReplicaSet's.
func (r *AgentReconciler) runnerPodWants(ctx context.Context, owner string, pod *corev1.Pod, demand runnerDemand) (runnerPodWant, bool) {
	if pod.DeletionTimestamp != nil || pod.Spec.NodeName == "" || pod.Status.Phase != corev1.PodRunning {
		return runnerPodWant{}, false
	}
	c := slices.IndexFunc(pod.Spec.Containers, func(c corev1.Container) bool { return c.Name == vmRunnerComponent })
	if c < 0 {
		return runnerPodWant{}, false
	}
	res := &pod.Spec.Containers[c].Resources
	current, ok := res.Limits[corev1.ResourceMemory]
	if !ok || current.IsZero() {
		return runnerPodWant{}, false
	}
	poolMiB, err := r.runnerLimitMiB(ctx, owner)
	if err != nil {
		return runnerPodWant{}, false
	}
	ceiling, err := r.runnerCPUCeiling(ctx, owner)
	if err != nil {
		return runnerPodWant{}, false
	}
	limit := runnerMemoryLimit(poolMiB, demand.memoryMiB, r.config.VM.Runner.ReserveMiB, current)
	floor := limit
	if cfg := r.config.VM.Runner.Resources; cfg != nil {
		if q, ok := cfg.Requests[corev1.ResourceMemory]; ok && q.Cmp(limit) < 0 {
			floor = q
		}
	}
	cpuRequest, hasCPURequest := res.Requests[corev1.ResourceCPU]
	currentCPU, hasCPULimit := res.Limits[corev1.ResourceCPU]
	currentRequest := res.Requests[corev1.ResourceMemory]
	return runnerPodWant{
		res:            res,
		memoryLimit:    limit,
		memoryRequest:  runnerMemoryRequest(demand.memoryMiB, r.config.VM.Runner.ReserveMiB, currentRequest, floor, limit),
		cpu:            runnerCPULimit(demand.vCPUs, r.config.VM.Runner.MachineCPUs, cpuRequest, ceiling),
		hasCPURequest:  hasCPURequest,
		currentLimit:   current,
		currentRequest: currentRequest,
		currentCPU:     currentCPU,
		hasCPULimit:    hasCPULimit,
	}, true
}

// UNIT_BOUNDARY_DESCRIPTION: the memory limit, the memory request and the CPU limit are changed on the running pod through its resize subresource and never on the Deployment, whose Recreate strategy would stop every machine to apply them. The limit is the owner's pool, so a UserBudget that raises or lowers it reaches the runner without restarting a machine. CPU and memory resize without a container restart by default. The kubelet applies a resize whole, so a memory request the node defers holds the new CPU limit back with it until there is room, and a limit the kubelet will not lower yet holds the request with it. A replacement pod therefore starts at the limit the Deployment last rendered and the install's request with no CPU limit, and the next reconcile sets all three again. A pod with no CPU request gets an explicit zero one, because the API defaults a missing request to the limit, which would reserve every vCPU and could change the pod's QoS class, which a resize may not do. A cluster without in-place resize, or one that refuses the controller the subresource, keeps the old behaviour — machines admitted against the limit the pod started with, which the scheduler does not see, with no CPU limit — and says so once.
// UNIT_BOUNDARY_DESCRIPTION: the pods come from the runner pod cache, as a live List after every machine PUT cost 57 ms at p90 on dev. The resize carries the resourceVersion it was read at, so the API server refuses it against any later pod, and a refused resize is decided again from a live List.
func (r *AgentReconciler) resizeRunnerPod(ctx context.Context, owner string, demand runnerDemand) {
	if !r.podResizeAvailable(ctx) {
		return
	}
	if r.resizeRunnerPodFrom(ctx, owner, demand, true) && r.runnerPodCache != nil {
		r.resizeRunnerPodFrom(ctx, owner, demand, false)
	}
}

func (r *AgentReconciler) runnerPods(ctx context.Context, owner string, fromCache bool) ([]corev1.Pod, error) {
	selector := labels.SelectorFromSet(vmRunnerSelector(owner))
	if fromCache && r.runnerPodCache != nil {
		cached, err := r.runnerPodCache.Pods(r.config.Namespace).List(selector)
		pods := make([]corev1.Pod, len(cached))
		for i, pod := range cached {
			pods[i] = *pod.DeepCopy()
		}
		return pods, err
	}
	list, err := r.client.CoreV1().Pods(r.config.Namespace).List(ctx, metav1.ListOptions{LabelSelector: selector.String()})
	if err != nil {
		return nil, err
	}
	return list.Items, nil
}

func (r *AgentReconciler) resizeRunnerPodFrom(ctx context.Context, owner string, demand runnerDemand, fromCache bool) (stale bool) {
	pods, err := r.runnerPods(ctx, owner, fromCache)
	if err != nil {
		slog.Warn("vm runner: listing the runner pod to resize it", "owner", owner, "error", err)
		return false
	}
	for i := range pods {
		pod := &pods[i]
		want, ok := r.runnerPodWants(ctx, owner, pod, demand)
		if !ok {
			continue
		}
		if !want.moves() {
			r.reportResizePending(owner, pod, want.memoryRequest)
			continue
		}
		res := want.res
		if res.Requests == nil {
			res.Requests = corev1.ResourceList{}
		}
		res.Requests[corev1.ResourceMemory] = want.memoryRequest
		if !want.hasCPURequest {
			res.Requests[corev1.ResourceCPU] = resource.Quantity{Format: resource.DecimalSI}
		}
		res.Limits[corev1.ResourceMemory] = want.memoryLimit
		res.Limits[corev1.ResourceCPU] = want.cpu
		if _, err := r.client.CoreV1().Pods(pod.Namespace).UpdateResize(ctx, pod.Name, pod, metav1.UpdateOptions{}); err != nil {
			if k8serrors.IsForbidden(err) || k8serrors.IsMethodNotSupported(err) {
				r.podResize.Store(resizeUnsupported)
				slog.Warn("vm runner: the runner pod cannot be resized in place, its memory request and limit stay where the pod started and it has no CPU limit", "error", err)
				return false
			}
			if k8serrors.IsConflict(err) {
				return true
			}
			slog.Warn("vm runner: resizing the runner pod", "owner", owner, "pod", pod.Name, "from", want.currentRequest.String(), "to", want.memoryRequest.String(), "limitTo", want.memoryLimit.String(), "cpuLimit", want.cpu.String(), "error", err)
			return false
		}
		slog.Info("vm runner: asked the node for a new memory limit, memory request and CPU limit on the runner pod", "owner", owner, "pod", pod.Name, "limitFrom", want.currentLimit.String(), "limitTo", want.memoryLimit.String(), "from", want.currentRequest.String(), "to", want.memoryRequest.String(), "cpuLimitFrom", want.currentCPU.String(), "cpuLimitTo", want.cpu.String())
	}
	return false
}

// UNIT_BOUNDARY_DESCRIPTION: whether a reconcile would resize the owner's runner pod: its memory limit, memory request or CPU limit differ from what the owner's pool and demand call for, so a UserBudget that changes only `cpu` reaches the pod within one memory pass. The request holds within a step, so a count that crosses a step boundary and back does not change it; a cluster without in-place resize never changes it.
func (r *AgentReconciler) runnerPodMoves(ctx context.Context, owner string, demand runnerDemand) bool {
	if !r.podResizeAvailable(ctx) {
		return false
	}
	pods, err := r.runnerPods(ctx, owner, true)
	if err != nil {
		slog.Warn("vm runner: listing the runner pod to check its resources", "owner", owner, "error", err)
		return false
	}
	return slices.ContainsFunc(pods, func(pod corev1.Pod) bool {
		want, ok := r.runnerPodWants(ctx, owner, &pod, demand)
		return ok && want.moves()
	})
}

// UNIT_BOUNDARY_DESCRIPTION: an accepted resize is a request to the node, not an allocation. The kubelet reports what it did with it on the pod: deferred while the node has no room right now, infeasible when it never will. Either way the scheduler has not accounted for that memory, so it is reported once per pod and size rather than read as done — the runner's own admission against its limit is what still stands between the owner's machines and the node.
func (r *AgentReconciler) reportResizePending(owner string, pod *corev1.Pod, want resource.Quantity) {
	for _, c := range pod.Status.Conditions {
		if c.Type != corev1.PodResizePending || c.Status != corev1.ConditionTrue {
			continue
		}
		key := fmt.Sprintf("%s/%s/%s/%s", owner, pod.Name, c.Reason, want.String())
		if _, seen := r.resizeNotices.LoadOrStore(key, struct{}{}); seen {
			return
		}
		switch c.Reason {
		case corev1.PodReasonInfeasible:
			slog.Warn("vm runner: the node cannot give the runner pod the memory its machines commit, so the scheduler does not see it", "owner", owner, "pod", pod.Name, "request", want.String(), "message", c.Message)
		default:
			slog.Info("vm runner: the node has deferred the runner pod's new memory request", "owner", owner, "pod", pod.Name, "request", want.String(), "reason", c.Reason, "message", c.Message)
		}
	}
}

// UNIT_BOUNDARY_DESCRIPTION: in-place resize arrived as the pods/resize subresource, so the API server's own discovery is the one answer to whether this cluster has it. The answer is kept for the process, because the API server does not gain or lose a subresource while the controller runs; a discovery call that fails is asked again next time rather than taken as a no.
func (r *AgentReconciler) podResizeAvailable(ctx context.Context) bool {
	switch r.podResize.Load() {
	case resizeSupported:
		return true
	case resizeUnsupported:
		return false
	case resizeSupportUnknown:
	}
	list, err := r.client.Discovery().ServerResourcesForGroupVersionWithContext(ctx, "v1")
	if err != nil {
		slog.Warn("vm runner: cannot tell whether this cluster resizes pods in place", "error", err)
		return false
	}
	if slices.ContainsFunc(list.APIResources, func(res metav1.APIResource) bool { return res.Name == "pods/resize" }) {
		r.podResize.Store(resizeSupported)
		return true
	}
	r.podResize.Store(resizeUnsupported)
	slog.Warn("vm runner: this cluster cannot resize pods in place, so a runner's memory request stays where the install set it and the scheduler does not see the machines it holds")
	return false
}
