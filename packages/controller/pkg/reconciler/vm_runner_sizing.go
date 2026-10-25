package reconciler

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"slices"
	"strings"
	"time"

	corev1 "k8s.io/api/core/v1"
	k8serrors "k8s.io/apimachinery/pkg/api/errors"
	apimeta "k8s.io/apimachinery/pkg/api/meta"
	"k8s.io/apimachinery/pkg/api/resource"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/labels"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/types"

	apiv1 "github.com/dam-agents/dam/packages/controller/api/v1"
	"github.com/dam-agents/dam/packages/controller/pkg/vmrunner"
)

const (
	resizeSupportUnknown int32 = iota
	resizeSupported
	resizeUnsupported
)

// UNIT_BOUNDARY_DESCRIPTION: what an owner's vm agents ask of their runner's memory and CPU, as the controller intends it rather than as the runner last saw it. It counts only the machines that should be running, because that is what the runner admits against its limits. `heldMiB` is the part of that count that machines already hold or are about to, and `nextStartMiB` is the smallest count of a start waiting for the node, or zero when none waits: the two together are what one more start costs, which is what a request the node has deferred may be cut down to.
type runnerDemand struct {
	memoryMiB    int
	vCPUs        int
	heldMiB      int
	nextStartMiB int
}

// UNIT_BOUNDARY_DESCRIPTION: a vm agent has no size of its own: every machine may grow to half of what its owner's runner hands out — their pool, from their UserBudget's `memory`, else the install's runner limit — so one agent can use most of the pool while a runaway guest meets its own OOM killer before the machine's growth has the kernel kill a machine of the pool. The host runner admits against a share of the Mac's memory that the controller never learns, not against the chart's pod limit, so there the agent's spec still sets its machine's memory.
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

// UNIT_BOUNDARY_DESCRIPTION: whether the runner has an answer about the agent's machine, so it holds what it was answered or holds memory while it boots, as the runner's own counting does. A start nothing has answered for yet holds nothing.
func (r *AgentReconciler) holdsOrIsAboutTo(a *apiv1.Agent) bool {
	if holdsMemory(r.liveMachine(a.Name).State) {
		return true
	}
	_, recorded := r.startAnswer(a)
	return recorded
}

// UNIT_BOUNDARY_DESCRIPTION: the demand that sizes a start: the machine being started counts whatever a refusal from an attempt before says, since the room it needs is what its count is for.
func (r *AgentReconciler) ownerRunnerDemand(ctx context.Context, owner string, self *apiv1.Agent, selfRunning bool) (runnerDemand, error) {
	return r.runnerDemand(ctx, owner, self, selfRunning, true)
}

// UNIT_BOUNDARY_DESCRIPTION: the demand the memory pass judges pressure from, and the total a reclaim frees room against: what the owner's runner holds or is about to hold, without the machines it refused for room or storage and without the starts waiting for the node, the start the pass counts from included, since a machine that holds nothing must not hibernate the ones the runner did admit.
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
		if a.Name != self.Name {
			agents = append(agents, a)
		}
	}
	var d runnerDemand
	for _, a := range agents {
		if _, err := resolveVMDiskGiB(&a.Spec, r.config.HarnessTemplateDefaults); err != nil {
			continue
		}
		running := selfRunning
		if a.Name != self.Name {
			if running, err = r.peerShouldRun(ctx, a.Name); err != nil {
				return runnerDemand{}, err
			}
		}
		// UNIT_BOUNDARY_DESCRIPTION: the held variant leaves out the starts waiting for the node as well as the refused ones, since neither holds memory; the request counts them, because their room is what it has to grow by.
		refused, waiting := r.refusedWithoutMachine(a), r.waitingForRoom(a)
		holds := !refused && (ownStart || !waiting)
		if !running {
			continue
		}
		counted := r.accountedMemoryMiB(ctx, owner, a.Name, &a.Spec)
		// UNIT_BOUNDARY_DESCRIPTION: a start waiting for the node holds nothing, so it is what one more machine costs and never part of what the machines hold. The smallest one is the figure, since a request cut down to admit one start should ask for the cheapest one that can go.
		if waiting && (d.nextStartMiB == 0 || counted < d.nextStartMiB) {
			d.nextStartMiB = counted
		}
		// UNIT_BOUNDARY_DESCRIPTION: only a start this pass is making holds nothing of its own: it has no answer yet, and its room is what the request has to grow by. A machine the runner has already answered for is a holder, the one this reconcile is about included, since a reconcile runs for a running machine as well as for a cold start — leaving that one out would size the same owner's pod differently for each of its agents.
		if !refused && !waiting && (!(ownStart && a.Name == self.Name) || r.holdsOrIsAboutTo(a)) {
			d.heldMiB += counted
		}
		if ownStart && a.Name == self.Name || holds {
			d.memoryMiB += counted
			d.vCPUs += max(r.config.VM.Runner.MachineCPUs, r.liveMachine(a.Name).CPUs, 1)
		}
	}
	return d, nil
}

// UNIT_BOUNDARY_DESCRIPTION: demand is read on every reconcile of every vm agent, and a starting machine is reconciled every half second, so the owner's agents come from the informer cache the controller already keeps rather than from a live List. A reconciler built without that cache — the tests — lists them live. A cache that has not synced is not an empty owner: it is no answer at all, and it says so, so a caller that would render or tear down on an empty list waits instead.
func (r *AgentReconciler) ownerAgents(ctx context.Context, owner string) ([]runtime.Object, error) {
	selector := labels.SelectorFromSet(labels.Set{envoyOwnerLabel: owner})
	if r.agentCache != nil {
		if !r.agentCacheReady() {
			return nil, errAgentCacheUnsynced
		}
		items, err := r.agentCache.ByNamespace(r.config.Namespace).List(selector)
		if err != nil {
			return nil, fmt.Errorf("listing the owner's agents: %w", err)
		}
		return items, nil
	}
	list, err := r.backend.List(ctx, selector)
	if err != nil {
		return nil, fmt.Errorf("listing the owner's agents: %w", err)
	}
	items := make([]runtime.Object, len(list))
	for i := range list {
		items[i] = &list[i]
	}
	return items, nil
}

// UNIT_BOUNDARY_DESCRIPTION: whether an agent's machine should run is the decision its own last reconcile made, which this controller keeps in memory. Only an agent not reconciled since the controller started is read from the cluster, by its gateway, which is scaled up exactly when its machine should run.
func (r *AgentReconciler) peerShouldRun(ctx context.Context, name string) (bool, error) {
	if running, ok := r.vmRunning.Load(name); ok {
		return running.(bool), nil
	}
	return r.agentDesiredUp(ctx, name)
}

// UNIT_BOUNDARY_DESCRIPTION: the last word on the agent's machine, as the reason it carried. The runner's own answer governs: it is recorded where the runner gave it, under the owner's lock, so a refusal counts before the Agent's status carries it, and a machine the runner admitted counts while it boots, before it is a live machine. The status is read only when no answer is recorded, for a refusal this controller did not see. A machine that runs anyway counts as any other, whatever a refusal from an attempt before says.
func (r *AgentReconciler) startAnswer(a *apiv1.Agent) (string, bool) {
	if r.liveMachine(a.Name).State == vmrunner.StateRunning {
		return "", false
	}
	if answer, recorded := r.vmAnswers.Load(a.Name); recorded {
		reason, _ := answer.(string)
		return reason, true
	}
	ready := apimeta.FindStatusCondition(a.Status.Conditions, apiv1.ConditionReady)
	if ready != nil && (ready.Reason == apiv1.ReasonOverBudget || ready.Reason == apiv1.ReasonAwaitingAllocation || ready.Reason == apiv1.ReasonAwaitingWarmUp || ready.Reason == apiv1.ReasonAwaitingMemory || ready.Reason == apiv1.ReasonAllocationUnreadable) {
		return ready.Reason, true
	}
	// UNIT_BOUNDARY_DESCRIPTION: the status carries the runner's reason, except that a full home is published as HomeVolumeFull, since the page and the UI name a volume rather than the runner's word for it.
	if podReady := apimeta.FindStatusCondition(a.Status.Conditions, apiv1.ConditionAgentPodReady); podReady != nil {
		return podReady.Reason, true
	}
	return "", false
}

// UNIT_BOUNDARY_DESCRIPTION: a machine the runner refused for room is parked — the Agent reads OverBudget, or the reason that a start waits for the wave its owner's runner is bringing back, or the one that says a reclaim is freeing the room it lacks — and one it refused for storage or for a full home leaves the Agent awake with no machine. Each holds nothing until a retry gets it running, so the demand leaves it out.
func (r *AgentReconciler) refusedWithoutMachine(a *apiv1.Agent) bool {
	reason, recorded := r.startAnswer(a)
	return recorded && (refusedReason(reason) || reason == apiv1.ReasonOverBudget || reason == apiv1.ReasonAwaitingWarmUp || reason == apiv1.ReasonAwaitingMemory || reason == apiv1.ReasonHomeVolumeFull)
}

// UNIT_BOUNDARY_DESCRIPTION: a start waiting for the node holds nothing either, but it is not refused: its room is what the resize request has to grow by, so the demand counts it. Only a reclaim leaves it out, because the room it waits for is not in use by it, and hibernating it frees nothing while ending the start that was waiting.
func (r *AgentReconciler) waitingForRoom(a *apiv1.Agent) bool {
	reason, recorded := r.startAnswer(a)
	return recorded && (reason == vmrunner.ReasonAwaitingAllocation || reason == apiv1.ReasonAwaitingAllocation || reason == apiv1.ReasonAllocationUnreadable)
}

// UNIT_BOUNDARY_DESCRIPTION: the reason an answer leaves for the predicates below. The runner keeps a refusal's reason after it admits the retry — it clears it only when that action completes — so a reason counts only while nothing runs or is in flight; a machine that boots, restarts or stops holds its memory whatever the reason says. A start waiting for the node is the exception: the runner answers it while the machine is not started at all, so that reason stands as it answers it. The controller's own spelling of a hold that outlasted the bound stands the same way: it is published while the machine is not started either, and the start keeps holding.
func answerReason(st vmrunner.MachineStatus) string {
	if st.Reason == vmrunner.ReasonAwaitingAllocation {
		return st.Reason
	}
	switch st.State {
	case "", vmrunner.StateAbsent, vmrunner.StateStopped:
		return st.Reason
	}
	return ""
}

// UNIT_BOUNDARY_DESCRIPTION: the runner answers a start it will not run with a reason, and leaves the reason of a start that failed on the machine afterwards — a full home, an image it cannot fetch, a missing seed, a boot that failed — until an action succeeds. Both leave the machine holding nothing, so both count toward nothing.
func refusedReason(reason string) bool {
	switch reason {
	case vmrunner.ReasonOutOfCapacity, vmrunner.ReasonStorageFull, vmrunner.ReasonHomeFull,
		vmrunner.ReasonImageUnavailable, vmrunner.ReasonImageCacheUnreachable,
		vmrunner.ReasonSeedMissing, vmrunner.ReasonBootFailed:
		return true
	}
	// UNIT_BOUNDARY_DESCRIPTION: a start waiting for the node is not refused, and must not be added here: what it holds counts toward the request that has to grow for it, so counting it as holding nothing would leave the request raised by the machines that are not waiting and the retry refused for ever.
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

// UNIT_BOUNDARY_DESCRIPTION: the runner admits machines against its memory limit, and the scheduler places pods by requests — so with a request below the limit, the node lends out memory the runner's guests are already using, and a busy node OOM-kills machines of that owner. The request follows the memory of the machines that should be running plus the runner's own reserve. It rises at once, but falls only once that has dropped a quarter step below the step under the current request, so a guest whose use sits on a step boundary does not resize the pod at every pass. It never drops below what the install asked for, which is the request Kubernetes gives the pod when the install asked for none, and never rises above the limit, which the API refuses. With no machine to run the reserve is not counted either: the reserve is what admission keeps free beside running machines, and a runner with none holds a few MiB, so the install's request is the whole of what an idle owner reserves rather than a step of the reserve; the fall rule is skipped too, since from the lowest step a need of nothing would read as within a quarter step of it and hold the request there.
func runnerMemoryRequest(demandMiB, reserveMiB int, current, floor, limit resource.Quantity) resource.Quantity {
	needMiB := 0
	if demandMiB > 0 {
		needMiB = demandMiB + reserveMiB
	}
	wantMiB := roundedMiB(needMiB)
	if currentMiB := int(current.Value() >> 20); needMiB > 0 && wantMiB < currentMiB && needMiB > currentMiB-memoryRequestStepMiB-memoryRequestStepMiB/4 {
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

// UNIT_BOUNDARY_DESCRIPTION: the node grants a resize whole or not at all, so a request covering every start waiting for it is one the node defers while it has room for only some of them: every start then waits although one of them fits. So while the request the demand calls for is above what the node granted, the ask is the runner's own admission arithmetic for one more machine — what the machines hold, plus the cheapest waiting start's count, plus the reserve — which is the least a request can be and still admit a start. It is rounded up to the request step like every other ask, and bounded by the install's request and by the demand's own ask, which it can never exceed.
func deferredRunnerRequest(demand runnerDemand, reserveMiB int, want, floor, limit resource.Quantity) resource.Quantity {
	forOne := roundedMiB(demand.heldMiB + demand.nextStartMiB + reserveMiB)
	stepped := *resource.NewQuantity(int64(forOne)<<20, resource.BinarySI)
	if stepped.Cmp(want) > 0 {
		return want
	}
	if stepped.Cmp(floor) < 0 {
		return floor
	}
	if stepped.Cmp(limit) > 0 {
		return limit
	}
	return stepped
}

// UNIT_BOUNDARY_DESCRIPTION: whether the owner's runner pod should be asked for less than the demand calls for: the node holds the pod below what its machines need, and a start is waiting for the difference. A grant that already covers what one more machine costs is a grant the runner admits against, so nothing is held back there and the whole demand is asked for at once. The reading is the node's grant rather than the pod's resize condition, which clears the moment a wave is granted and would put the whole demand back on the very next pass: the ask stays stepped until the grant itself reaches it.
func (d runnerDemand) grantHoldsBackStart(grantMiB, reserveMiB int) bool {
	return d.nextStartMiB > 0 && grantMiB < d.heldMiB+d.nextStartMiB+reserveMiB
}

// UNIT_BOUNDARY_DESCRIPTION: a grant too small for one more machine is answered by asking the node for less, not by freeing anything: an idle agent hibernated at once is taken away while the reduced ask is still on its way, and it would have fitted. So the reclaim waits one grace period after the controller first stepped the ask down to this size, on this pod. The grace is held against the pod's identity and the ask's own figure rather than the owner alone: a granted wave, a pod replaced by a roll and a further step down are each a new question to the node, and none of them may inherit a grace another ask has already spent. A kubelet answers a resize it cannot grant within a pass or two, so a grace that outlasts a few machine-watch retries is long enough to tell a stepped ask still being evaluated from one the node has refused — the pod carries no figure that says which, since the spec holds the controller's own ask rather than the node's answer. After the grace the grant is exhausted and the idle agents are the only room left. A demand that no longer steps down, and a pod that reports no grant to step down from, end the wait at once.
const steppedGrantGrace = time.Minute

// UNIT_BOUNDARY_DESCRIPTION: one stepped ask as the reclaim's grace remembers it: the pod that carries it and the request it was cut down to. Two passes with the same pair are the same ask still being evaluated; anything else is a different question.
type steppedAsk struct {
	uid     types.UID
	request string
}

// UNIT_BOUNDARY_DESCRIPTION: whether the owner's ask for the runner pod is stepped down below what the demand calls for, and to what, which is the state the reclaim's grace is kept for. The demand is the very one the caller is sizing the pod from, not a second reading of it: a reconcile runs for a stopped agent as well as a starting one, and a demand read with a different answer about that agent would key the grace to a request the node was never sent. A pod that reports no grant is not this state either: with no figure to measure the demand against, the whole demand stands, so there is nothing a reclaim would wait out.
func (r *AgentReconciler) runnerAskIsStepped(ctx context.Context, owner string, demand runnerDemand) (steppedAsk, bool) {
	if demand.nextStartMiB == 0 {
		return steppedAsk{}, false
	}
	pods, err := r.runnerPods(ctx, owner, true)
	if err != nil {
		return steppedAsk{}, false
	}
	reserveMiB := r.config.VM.Runner.ReserveMiB
	for i := range pods {
		pod := &pods[i]
		if pod.DeletionTimestamp != nil || pod.Status.Phase != corev1.PodRunning {
			continue
		}
		grantMiB, reported := runnerPodGrantMiB(pod)
		if !reported || !demand.grantHoldsBackStart(grantMiB, reserveMiB) {
			return steppedAsk{}, false
		}
		want, ok := r.runnerPodWants(ctx, owner, pod, demand)
		if !ok {
			return steppedAsk{}, false
		}
		return steppedAsk{uid: pod.UID, request: want.memoryRequest.String()}, true
	}
	return steppedAsk{}, false
}

// UNIT_BOUNDARY_DESCRIPTION: the grace is recorded where every reconcile can see it, not only where a reclaim would read it: a pass that finds the ask stepped records when this ask began, and a pass that finds nothing stepped clears the record. Reading it only inside the reclaim would leave a spent grace behind a wave the node granted, and a later start of the same size on the same pod would then inherit it and free an idle machine at once. A different ask — a further step down, a replacement pod — starts its own grace, and one already recorded keeps its time unchanged, so an ask still being evaluated is not prolonged pass after pass.
func (r *AgentReconciler) noteSteppedAsk(ctx context.Context, owner string, demand runnerDemand) {
	ask, stepped := r.runnerAskIsStepped(ctx, owner, demand)
	if !stepped {
		r.steppedSince.Delete(owner)
		return
	}
	if since, ok := r.steppedSince.Load(owner); ok && since.(steppedAskTimestamp).ask == ask {
		return
	}
	r.steppedSince.Store(owner, steppedAskTimestamp{ask: ask, at: time.Now()})
}

// UNIT_BOUNDARY_DESCRIPTION: whether the reclaim should wait before freeing room for a start the node has not granted: the ask is stepped down, and this very ask became so less than a grace ago. An ask no pass has recorded yet is waited for too, since the pass that would have recorded it is the one this reclaim runs after.
func (r *AgentReconciler) reclaimWaitsForTheReducedAsk(owner string) bool {
	since, ok := r.steppedSince.Load(owner)
	return !ok || time.Since(since.(steppedAskTimestamp).at) < steppedGrantGrace
}

// UNIT_BOUNDARY_DESCRIPTION: the grace a stepped ask was first seen under.
type steppedAskTimestamp struct {
	ask steppedAsk
	at  time.Time
}

// UNIT_BOUNDARY_DESCRIPTION: every machine of an owner is a VMM process inside the runner pod, so with no CPU limit one runaway VMM can take every core of the node and slow every pod there. The limit is the vCPUs of the machines that should be running, each counted at the larger of its live and its next size, plus one machine's worth for the runner itself and the VMMs' own I/O threads. Unless the install caps it lower, the limit it decides covers the vCPUs of every machine that should be running. With no machine running the runner keeps that one machine's worth, so the first start is not throttled before the next resize lands. It is never below the CPU request, which the API refuses, and never above a CPU limit the install set.
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

// UNIT_BOUNDARY_DESCRIPTION: an owner's pool can be lowered below what their running machines are counted at, and lowering the runner's memory limit under them would have the kernel kill a machine of them. So a limit that falls stops at the machines' count plus the reserve, rounded up to the request step, and comes down further only as they stop; the runner admits no new machine meanwhile, because its limit is already taken. A limit that rises goes to the pool at once.
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
	memoryRequest := runnerMemoryRequest(demand.memoryMiB, r.config.VM.Runner.ReserveMiB, currentRequest, floor, limit)
	if grantMiB, reported := runnerPodGrantMiB(pod); reported && demand.grantHoldsBackStart(grantMiB, r.config.VM.Runner.ReserveMiB) {
		memoryRequest = deferredRunnerRequest(demand, r.config.VM.Runner.ReserveMiB, memoryRequest, floor, limit)
	}
	return runnerPodWant{
		res:            res,
		memoryLimit:    limit,
		memoryRequest:  memoryRequest,
		cpu:            runnerCPULimit(demand.vCPUs, r.config.VM.Runner.MachineCPUs, cpuRequest, ceiling),
		hasCPURequest:  hasCPURequest,
		currentLimit:   current,
		currentRequest: currentRequest,
		currentCPU:     currentCPU,
		hasCPULimit:    hasCPULimit,
	}, true
}

// UNIT_BOUNDARY_DESCRIPTION: the memory limit, the memory request and the CPU limit are changed on the running pod through its resize subresource and never on the Deployment, whose Recreate strategy would stop every machine to apply them. The limit is the owner's pool, so a UserBudget that raises or lowers it reaches the runner without restarting a machine. CPU and memory resize without a container restart by default. The kubelet applies a resize whole, so a memory request the node defers holds the new CPU limit back with it until there is room, and a limit the kubelet will not lower yet holds the request with it. A replacement pod therefore starts at the limit and the CPU bound the Deployment rendered — the owner's pool, or the one derived from the memory pool where they have none — and the install's request, and the next reconcile sets all three again. A pod with no CPU request gets an explicit zero one, because the API defaults a missing request to the limit, which would reserve every vCPU and could change the pod's QoS class, which a resize may not do. A cluster without in-place resize, or one that refuses the controller the subresource, keeps the old behaviour — machines admitted against the limit the pod started with, which the scheduler does not see, under the CPU bound it was created with — and says so once.
// UNIT_BOUNDARY_DESCRIPTION: the pods come from the runner pod cache, as a live List after every machine PUT cost 57 ms at p90 on dev. The resize carries the resourceVersion it was read at, so the API server refuses it against any later pod, and a refused resize is decided again from a live List.
func (r *AgentReconciler) resizeRunnerPod(ctx context.Context, owner string, demand runnerDemand) {
	if !r.podResizeAvailable(ctx) {
		return
	}
	if r.resizeRunnerPodFrom(ctx, owner, demand, true, false) && r.runnerPodCache != nil {
		r.resizeRunnerPodFrom(ctx, owner, demand, false, false)
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

// UNIT_BOUNDARY_DESCRIPTION: the pod one node answered it cannot resize, kept with the pod's identity so the answer lapses with that pod: a replacement pod is a new question to its own node, and a mark that outlived its pod would exempt the owner from the admission ceiling for good.
type nodeResizeMark struct {
	uid types.UID
}

// UNIT_BOUNDARY_DESCRIPTION: a runner pod that is running and reports neither what the node allocated its container nor the requests its status holds has no figure to admit against, and zero is not that figure: zero admits against the whole pool, which is the reading this ceiling exists to prevent. The resize the start needs is still asked for in the same reconcile, so the next retry reads what the node enacted.
var errGrantUnknown = errors.New("the node has not reported what it holds for the owner's runner pod")

// UNIT_BOUNDARY_DESCRIPTION: an agent cache that has not listed yet is not an owner with no agents. A caller that would render or tear down on that answer waits instead.
var errAgentCacheUnsynced = errors.New("the agent cache has not synced, so the owner's agents are unknown")

// UNIT_BOUNDARY_DESCRIPTION: the memory the node has actually granted the owner's runner pod, which is what its machines may be admitted against. The figure is the one the node reports: what it allocated the container, else the container status' own requests on a kubelet that reports the resize result, and a deferred or refused resize leaves both at what the pod holds. The request in the pod's spec is never it: that is the controller's ask from the moment it makes one, which the node may not have enacted. Zero is a pod not yet placed and a cluster that cannot resize the pod — each admits against the limit as every start did before this ceiling — where a running pod whose node reports nothing is unknown, and a start held on it rather than let the runner admit against the whole pool this exists to bound. A failed read is none of those, so it stops the decision.
func (r *AgentReconciler) runnerAdmitMiB(ctx context.Context, owner string) (int, error) {
	available, known := r.podResizeSupport(ctx)
	if !known {
		return 0, fmt.Errorf("this cluster's resize support cannot be read, so what the node granted the owner's runner pod is unknown")
	}
	if !available {
		return 0, nil
	}
	pods, err := r.runnerPods(ctx, owner, true)
	if err != nil {
		return 0, fmt.Errorf("listing the owner's runner pods to read what the node granted them: %w", err)
	}
	for i := range pods {
		pod := &pods[i]
		if pod.DeletionTimestamp != nil || pod.Status.Phase != corev1.PodRunning {
			continue
		}
		if grant, ok := runnerPodGrantMiB(pod); ok {
			// UNIT_BOUNDARY_DESCRIPTION: a node that reports again is not the node that refused the resize, so the mark lapses rather than outliving the fault.
			r.noNodeResize.Delete(owner)
			return grant, nil
		}
		// UNIT_BOUNDARY_DESCRIPTION: one node's answer says nothing about another's, and says nothing about a pod that replaced the one it described: a runner whose node cannot carry a resize is admitted against its limit, as every start is on a cluster without the subresource, where every other owner — and every replacement pod of this one — is read again and keeps the ceiling a node that does report grants gives it.
		if marked, ok := r.noNodeResize.Load(owner); ok && marked.(nodeResizeMark).uid == pod.UID {
			return 0, nil
		}
		return 0, fmt.Errorf("%w: %s", errGrantUnknown, pod.Name)
	}
	return 0, nil
}

// UNIT_BOUNDARY_DESCRIPTION: what a running runner pod's container status reports the node holding, or false where it reports neither field: what the node allocated the container, else the requests that status names. Both are the node's own reading, where the pod's spec is the controller's ask.
func runnerPodGrantMiB(pod *corev1.Pod) (int, bool) {
	for _, st := range pod.Status.ContainerStatuses {
		if st.Name != vmRunnerComponent {
			continue
		}
		if q, ok := st.AllocatedResources[corev1.ResourceMemory]; ok {
			return int(q.Value() >> 20), true
		}
		if st.Resources != nil {
			if q, ok := st.Resources.Requests[corev1.ResourceMemory]; ok {
				return int(q.Value() >> 20), true
			}
		}
	}
	return 0, false
}

// UNIT_BOUNDARY_DESCRIPTION: a resize the node cannot carry is how a hold on an unreadable grant learns that the node will never report one: the API server validates a resize against what the running node supports, and a node without in-place resize answers invalid. Asking with the pod unchanged is therefore the probe, and the answer cannot change between two asks a few seconds apart, so it is throttled per owner.
func (r *AgentReconciler) probeRunnerResize(ctx context.Context, owner string, demand runnerDemand) {
	if !r.podResizeAvailable(ctx) {
		return
	}
	if last, ok := r.grantProbes.Load(owner); ok && time.Since(last.(time.Time)) < grantProbeInterval {
		return
	}
	r.grantProbes.Store(owner, time.Now())
	r.resizeRunnerPodFrom(ctx, owner, demand, true, true)
}

// UNIT_BOUNDARY_DESCRIPTION: whether the owner's runner pod carries a resize the node has deferred or refused, which is what tells a start waiting for the node from one whose room the owner's own idle agents can free: while the node holds the pod at its old size, no idle agent of another kind would help and no wait ends on its own.
func (r *AgentReconciler) runnerResizePending(ctx context.Context, owner string) bool {
	pods, err := r.runnerPods(ctx, owner, true)
	if err != nil {
		return false
	}
	for i := range pods {
		if pods[i].DeletionTimestamp != nil || pods[i].Status.Phase != corev1.PodRunning {
			continue
		}
		if _, pending := resizePending(&pods[i]); pending {
			return true
		}
	}
	return false
}

func (r *AgentReconciler) resizeRunnerPodFrom(ctx context.Context, owner string, demand runnerDemand, fromCache, probe bool) (stale bool) {
	pods, err := r.runnerPods(ctx, owner, fromCache)
	if err != nil {
		slog.Warn("vm runner: listing the runner pod to resize it", "owner", owner, "error", err)
		return false
	}
	for i := range pods {
		pod := &pods[i]
		// UNIT_BOUNDARY_DESCRIPTION: a node that answered it cannot carry a resize is asked no more about that pod, and asked about the next one, which may sit on another node: the answer is about one pod, so it never becomes this owner's permanent exemption from the ceiling.
		if marked, ok := r.noNodeResize.Load(owner); ok && marked.(nodeResizeMark).uid == pod.UID {
			continue
		}
		want, ok := r.runnerPodWants(ctx, owner, pod, demand)
		if !ok {
			continue
		}
		if !want.moves() && !probe {
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
			// UNIT_BOUNDARY_DESCRIPTION: a node that cannot carry a resize answers the resize with an invalid carrying a forbidden cause about its own support for resizing, which is how the API server reports that the running container never reported the resources the resize would change. Only that answer counts, and only for the pod it was given about: the answer is about one pod's node, where an absent subresource is about the cluster.
			if _, reports := runnerPodGrantMiB(pod); !reports && resizeNodeUnsupported(err) {
				r.noNodeResize.Store(owner, nodeResizeMark{uid: pod.UID})
				slog.Warn("vm runner: this runner's node cannot resize the pod in place, its memory request and limit stay where the pod started and its CPU limit stays at the bound it was created with", "owner", owner, "pod", pod.Name, "node", pod.Spec.NodeName, "error", err)
				return false
			}
			if k8serrors.IsForbidden(err) || k8serrors.IsMethodNotSupported(err) {
				r.podResize.Store(resizeUnsupported)
				slog.Warn("vm runner: the runner pod cannot be resized in place, its memory request and limit stay where the pod started and its CPU limit stays at the bound it was created with", "error", err)
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
// UNIT_BOUNDARY_DESCRIPTION: whether this cluster resizes pods in place, and whether that is known at all: a discovery call that fails says nothing either way, and the answer is asked again next time rather than taken as a no.
func (r *AgentReconciler) podResizeSupport(ctx context.Context) (available, known bool) {
	switch r.podResize.Load() {
	case resizeSupported:
		return true, true
	case resizeUnsupported:
		return false, true
	case resizeSupportUnknown:
	}
	list, err := r.client.Discovery().ServerResourcesForGroupVersionWithContext(ctx, "v1")
	if err != nil {
		slog.Warn("vm runner: cannot tell whether this cluster resizes pods in place", "error", err)
		return false, false
	}
	if slices.ContainsFunc(list.APIResources, func(res metav1.APIResource) bool { return res.Name == "pods/resize" }) {
		r.podResize.Store(resizeSupported)
		return true, true
	}
	r.podResize.Store(resizeUnsupported)
	slog.Warn("vm runner: this cluster cannot resize pods in place, so a runner's memory request stays where the install set it and the scheduler does not see the machines it holds")
	return false, true
}

// UNIT_BOUNDARY_DESCRIPTION: whether a resize was refused because the node cannot carry one, which Kubernetes answers with a forbidden cause on the spec that says the pod runs on a node without support for resizing. The field alone is no evidence — the API files its own immutable-field refusals against the same spec, and a webhook's quota is a forbidden cause on the resize field — so the cause counts only when both name that answer: the spec for its field, and the node's support for resizing for its message. Everything else is a refusal of the ask, and an ask the platform can correct is not a node that never reports, so it keeps the hold.
func resizeNodeUnsupported(err error) bool {
	if !k8serrors.IsInvalid(err) {
		return false
	}
	status, ok := err.(k8serrors.APIStatus)
	if !ok || status.Status().Details == nil {
		return false
	}
	return slices.ContainsFunc(status.Status().Details.Causes, func(c metav1.StatusCause) bool {
		if c.Type != metav1.CauseTypeForbidden || c.Field != "spec" {
			return false
		}
		message := strings.ToLower(c.Message)
		return strings.Contains(message, "without support for resize") || strings.Contains(message, "not supported by the node")
	})
}

func (r *AgentReconciler) podResizeAvailable(ctx context.Context) bool {
	available, _ := r.podResizeSupport(ctx)
	return available
}
