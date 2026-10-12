package reconciler

import (
	"context"
	"fmt"
	"log/slog"
	"slices"

	corev1 "k8s.io/api/core/v1"
	k8serrors "k8s.io/apimachinery/pkg/api/errors"
	"k8s.io/apimachinery/pkg/api/resource"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/labels"
	"k8s.io/apimachinery/pkg/runtime"

	apiv1 "github.com/dam-agents/dam/packages/controller/api/v1"
)

// UNIT_BOUNDARY_DESCRIPTION: what each machine may write on the claim beyond its disk: the root overlay it runs on, which is thrown away at every stop but grows while the guest runs, and the bookkeeping under machines/.
const runnerClaimHeadroomGiB = 1

const (
	resizeSupportUnknown int32 = iota
	resizeSupported
	resizeUnsupported
)

// UNIT_BOUNDARY_DESCRIPTION: what an owner's vm agents ask of their runner, as the controller intends it rather than as the runner last saw it. Memory counts only the machines that should be running, because that is what the runner admits against its memory limit; disk counts every machine, because a stopped machine keeps its disk on the claim, and every runtime migration's seed until its guest has booted from it.
type runnerDemand struct {
	memoryMiB int
	diskGiB   int
	machines  int
	vCPUs     int
	seedBytes int64
}

// UNIT_BOUNDARY_DESCRIPTION: a vm agent has no size of its own: every machine may grow to half of what its owner's runner hands out, so one agent can use most of the pool while a runaway guest meets its own OOM killer before it takes the runner, and every sibling, over the limit. The host runner admits against a share of the Mac's memory that the controller never learns, not against the chart's pod limit, so there the agent's spec still sets its machine's memory.
func (r *AgentReconciler) machineMemoryMiB(spec *apiv1.AgentSpec) int {
	if limit := r.runnerLimitMiB(); limit > 0 && r.config.VM.Runner.HostAddress == "" {
		return max((limit-r.config.VM.Runner.ReserveMiB)/2, 1)
	}
	_, mem := r.limitsOf(spec)
	return max(int(mem.Value()>>20), 1)
}

// UNIT_BOUNDARY_DESCRIPTION: the controller knows an agent should run before its machine does, so demand is read from the Agents rather than from the runner — a request raised from the runner's own count would always arrive one machine late, after the runner had admitted it. The agent being reconciled is counted by the decision just made for it; its peers by their gateway, which is scaled up exactly when their machine should run. Only the reconcile that made that decision records it for the peers' later reads: a caller that merely sizes, like the memory pass, passes its own read and leaves the record alone, so it cannot put back a decision a reconcile has since changed. An agent whose disk size cannot be read is left out, because its own reconcile already refuses it.
func (r *AgentReconciler) ownerRunnerDemand(ctx context.Context, owner string, self *apiv1.Agent, selfRunning bool) (runnerDemand, error) {
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
		disk, err := resolveVMDiskGiB(&a.Spec, r.config.AgentTemplateDefaults)
		if err != nil {
			continue
		}
		d.diskGiB += disk
		d.machines++
		d.seedBytes += r.runtimeMigrationSeedBytes(ctx, a)
		running := selfRunning
		if a.Name != self.Name {
			if running, err = r.peerShouldRun(ctx, a.Name); err != nil {
				return runnerDemand{}, err
			}
		}
		if running {
			d.memoryMiB += r.accountedMemoryMiB(a.Name, &a.Spec)
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

// UNIT_BOUNDARY_DESCRIPTION: the claim holds every machine disk of the owner, the headroom each machine writes beside its disk, the seed of each migration still in flight, and the image cache when the install left the cache on the claim. `runner.storage` is the ceiling, not the size: a claim sized for a fleet the owner does not have reserves storage nobody uses, and a single 10Gi agent would otherwise cost a 100Gi volume.
func (r *AgentReconciler) runnerClaimSize(owner string, demand runnerDemand) (resource.Quantity, resource.Quantity, error) {
	ceiling, err := resource.ParseQuantity(r.config.VM.Runner.Storage)
	if err != nil {
		return resource.Quantity{}, resource.Quantity{}, fmt.Errorf("vm runner storage %q is not a quantity: %w", r.config.VM.Runner.Storage, err)
	}
	need := int64(demand.diskGiB+demand.machines*runnerClaimHeadroomGiB)<<30 + demand.seedBytes
	if spec := r.config.VM.Runner; runnerOwnsImageCache(spec) {
		budget, err := imageBudgetBytes(spec)
		if err != nil {
			return resource.Quantity{}, resource.Quantity{}, err
		}
		need += budget
	}
	gib := max((need+(1<<30)-1)>>30, 1)
	size := *resource.NewQuantity(gib<<30, resource.BinarySI)
	if size.Cmp(ceiling) > 0 {
		r.noteClaimCapped(owner, size, ceiling)
		return ceiling, ceiling, nil
	}
	return size, ceiling, nil
}

// UNIT_BOUNDARY_DESCRIPTION: an owner whose disks and cache outgrow `runner.storage` gets a claim at the ceiling, and the machines on it can fill it. That is the install's choice, not an error, so it is said once per owner and ceiling rather than on every reconcile of every one of their agents.
func (r *AgentReconciler) noteClaimCapped(owner string, need, ceiling resource.Quantity) {
	if _, seen := r.claimCapNotices.LoadOrStore(owner+"/"+ceiling.String(), struct{}{}); seen {
		return
	}
	slog.Warn("vm runner: the owner's machines need more than runner.storage, so the claim is capped there and can fill up", "owner", owner, "need", need.String(), "ceiling", ceiling.String())
}

// UNIT_BOUNDARY_DESCRIPTION: a claim sized to today's demand is only safe where it can grow with tomorrow's, so a claim on a class that does not allow expansion is created at the ceiling, as every claim was before. A class the controller cannot read counts as one that does not expand — the cost of guessing wrong that way is unused storage, the cost the other way is an owner whose next agent does not fit.
func (r *AgentReconciler) runnerClassExpands(ctx context.Context) bool {
	classes := r.client.StorageV1().StorageClasses()
	if name := r.config.VM.Runner.StorageClass; name != "" {
		sc, err := classes.Get(ctx, name, metav1.GetOptions{})
		if err != nil {
			slog.Warn("vm runner: cannot read the claim's storage class, the claim is created at runner.storage", "class", name, "error", err)
			return false
		}
		return sc.AllowVolumeExpansion != nil && *sc.AllowVolumeExpansion
	}
	list, err := classes.List(ctx, metav1.ListOptions{})
	if err != nil {
		slog.Warn("vm runner: cannot read the default storage class, the claim is created at runner.storage", "error", err)
		return false
	}
	for _, sc := range list.Items {
		if sc.Annotations["storageclass.kubernetes.io/is-default-class"] == "true" || sc.Annotations["storageclass.beta.kubernetes.io/is-default-class"] == "true" {
			return sc.AllowVolumeExpansion != nil && *sc.AllowVolumeExpansion
		}
	}
	return false
}

// UNIT_BOUNDARY_DESCRIPTION: the runner admits machines against its memory limit, and the scheduler places pods by requests — so with a request below the limit, the node lends out memory the runner's guests are already using, and a busy node OOM-kills the runner with every machine of that owner. The request follows the memory of the machines that should be running plus the runner's own reserve. It never drops below what the install asked for, which is the request Kubernetes gives the pod when the install asked for none, and never rises above the limit, which the API refuses.
func runnerMemoryRequest(demandMiB, reserveMiB int, floor, limit resource.Quantity) resource.Quantity {
	want := *resource.NewQuantity(int64(roundedMiB(demandMiB+reserveMiB))<<20, resource.BinarySI)
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

// UNIT_BOUNDARY_DESCRIPTION: the memory request and the CPU limit are changed on the running pod through its resize subresource and never on the Deployment, whose Recreate strategy would stop every machine to apply them. CPU and memory resize without a container restart by default. The kubelet applies a resize whole, so a memory request the node defers holds the new CPU limit back with it until there is room. A replacement pod therefore starts at the install's request with no CPU limit, and the next reconcile sets both again. A pod with no CPU request gets an explicit zero one, because the API defaults a missing request to the limit, which would reserve every vCPU and could change the pod's QoS class, which a resize may not do. A cluster without in-place resize, or one that refuses the controller the subresource, keeps the old behaviour — machines admitted against a limit the scheduler does not see, with no CPU limit — and says so once.
func (r *AgentReconciler) resizeRunnerPod(ctx context.Context, owner string, demand runnerDemand) {
	if !r.podResizeAvailable(ctx) {
		return
	}
	pods, err := r.client.CoreV1().Pods(r.config.Namespace).List(ctx, metav1.ListOptions{
		LabelSelector: labels.Set(vmRunnerSelector(owner)).String(),
	})
	if err != nil {
		slog.Warn("vm runner: listing the runner pod to resize it", "owner", owner, "error", err)
		return
	}
	for i := range pods.Items {
		pod := &pods.Items[i]
		if pod.DeletionTimestamp != nil || pod.Spec.NodeName == "" {
			continue
		}
		c := slices.IndexFunc(pod.Spec.Containers, func(c corev1.Container) bool { return c.Name == vmRunnerComponent })
		if c < 0 {
			continue
		}
		res := &pod.Spec.Containers[c].Resources
		limit, ok := res.Limits[corev1.ResourceMemory]
		if !ok || limit.IsZero() {
			continue
		}
		floor := limit
		var cpuCeiling *resource.Quantity
		if cfg := r.config.VM.Runner.Resources; cfg != nil {
			if q, ok := cfg.Requests[corev1.ResourceMemory]; ok {
				floor = q
			}
			if q, ok := cfg.Limits[corev1.ResourceCPU]; ok {
				cpuCeiling = &q
			}
		}
		want := runnerMemoryRequest(demand.memoryMiB, r.config.VM.Runner.ReserveMiB, floor, limit)
		current := res.Requests[corev1.ResourceMemory]
		cpuRequest, hasCPURequest := res.Requests[corev1.ResourceCPU]
		wantCPU := runnerCPULimit(demand.vCPUs, r.config.VM.Runner.MachineCPUs, cpuRequest, cpuCeiling)
		currentCPU, hasCPULimit := res.Limits[corev1.ResourceCPU]
		if current.Cmp(want) == 0 && hasCPULimit && currentCPU.Cmp(wantCPU) == 0 {
			r.reportResizePending(owner, pod, want)
			continue
		}
		if res.Requests == nil {
			res.Requests = corev1.ResourceList{}
		}
		res.Requests[corev1.ResourceMemory] = want
		if !hasCPURequest {
			res.Requests[corev1.ResourceCPU] = resource.Quantity{Format: resource.DecimalSI}
		}
		res.Limits[corev1.ResourceCPU] = wantCPU
		if _, err := r.client.CoreV1().Pods(pod.Namespace).UpdateResize(ctx, pod.Name, pod, metav1.UpdateOptions{}); err != nil {
			if k8serrors.IsForbidden(err) || k8serrors.IsMethodNotSupported(err) {
				r.podResize.Store(resizeUnsupported)
				slog.Warn("vm runner: the runner pod cannot be resized in place, its memory request stays where the install set it and it has no CPU limit", "error", err)
				return
			}
			slog.Warn("vm runner: resizing the runner pod", "owner", owner, "pod", pod.Name, "from", current.String(), "to", want.String(), "cpuLimit", wantCPU.String(), "error", err)
			return
		}
		slog.Info("vm runner: asked the node for a new memory request and CPU limit on the runner pod", "owner", owner, "pod", pod.Name, "from", current.String(), "to", want.String(), "cpuLimitFrom", currentCPU.String(), "cpuLimitTo", wantCPU.String())
	}
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
