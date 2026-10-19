// TEST_OVERVIEW: an owner's runner memory is counted by what the machines measurably use: a measured machine counts at its use plus headroom, never above its size, and room the runner lacks is freed by hibernating the owner's idle vm agents only when they cover all of it — or, on the runner's own pressure signal, as far as they go.
package reconciler

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	corev1 "k8s.io/api/core/v1"
	"k8s.io/apimachinery/pkg/api/resource"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"

	apiv1 "github.com/dam-agents/dam/packages/controller/api/v1"
	"github.com/dam-agents/dam/packages/controller/pkg/vmrunner"
)

func measured(mib int) vmrunner.MachineStatus {
	return vmrunner.MachineStatus{State: vmrunner.StateRunning, UsedMiB: mib}
}

// TEST_SCENARIO: guests hand freed memory back, so a running peer the runner has measured counts toward the request at its use plus headroom rather than its size, and one measured near its size is held to its size. Until it is measured it counts at its size, as before.
func TestAMeasuredMachineCountsAtItsUsePlusHeadroom(t *testing.T) {
	agent := vmAgentCR()
	r, _, _ := setupVMReconciler(t, agent)
	peerVMAgent(t, r, "peer-up", "2Gi", "20Gi", true)
	ctx := context.Background()

	d, err := r.ownerRunnerDemand(ctx, testOwner, agent, true)
	require.NoError(t, err)
	assert.Equal(t, 3072+2048, d.memoryMiB, "unmeasured machines count at their size")

	r.noteMachineUse("peer-up", measured(600))
	d, err = r.ownerRunnerDemand(ctx, testOwner, agent, true)
	require.NoError(t, err)
	assert.Equal(t, 3072+600+256, d.memoryMiB)

	r.noteMachineUse("peer-up", vmrunner.MachineStatus{State: vmrunner.StateUnknown})
	d, err = r.ownerRunnerDemand(ctx, testOwner, agent, true)
	require.NoError(t, err)
	assert.Equal(t, 3072+600+256, d.memoryMiB, "an unread state forgot the last measurement")

	r.noteMachineUse("peer-up", measured(2000))
	d, err = r.ownerRunnerDemand(ctx, testOwner, agent, true)
	require.NoError(t, err)
	assert.Equal(t, 3072+2048, d.memoryMiB, "a machine is never counted above its size")

	r.noteMachineUse("peer-up", vmrunner.MachineStatus{State: vmrunner.StateStopped})
	d, err = r.ownerRunnerDemand(ctx, testOwner, agent, true)
	require.NoError(t, err)
	assert.Equal(t, 3072+2048, d.memoryMiB, "a stopped machine's last measurement is forgotten")
}

// TEST_SCENARIO: room on a runner is freed by hibernating the owner's idle vm agents under the blocked-start rules, and only when the agents chosen free all of it: a peer is never hibernated for room that would still not be enough. A peer frees what it is counted at, so an idle guest holding little frees little.
func TestRunnerMemoryIsReclaimedOnlyWhenIdlePeersCoverTheNeed(t *testing.T) {
	ctx := context.Background()
	for _, tc := range []struct {
		need       int
		partial    bool
		hibernated bool
	}{
		{need: 2000, hibernated: false},
		{need: 800, hibernated: true},
		{need: 2000, partial: true, hibernated: true},
	} {
		agent := vmAgentCR()
		r, _, _ := setupVMReconciler(t, agent)
		r.podStatus = func(context.Context, string) (bool, bool) { return true, true }
		peerVMAgent(t, r, "idle-peer", "4Gi", "20Gi", true)
		_, err := r.dynamic.Resource(AgentsGVR).Namespace("test-agents").Patch(ctx, "idle-peer", "application/merge-patch+json",
			[]byte(`{"metadata":{"annotations":{"`+annLastActivity+`":"`+time.Now().UTC().Add(-10*time.Minute).Format(time.RFC3339)+`"}}}`),
			metav1.PatchOptions{})
		require.NoError(t, err)
		r.noteMachineUse("idle-peer", measured(700))

		freed, err := r.reclaimRunnerMemory(ctx, testOwner, agent.Name, func() (int, error) { return tc.need, nil }, tc.partial)
		require.NoError(t, err)
		assert.Equal(t, tc.hibernated, freed, "need %d MiB (partial %v) against a peer counted at 956 MiB", tc.need, tc.partial)
		peer, err := r.dynamic.Resource(AgentsGVR).Namespace("test-agents").Get(ctx, "idle-peer", metav1.GetOptions{})
		require.NoError(t, err)
		assert.Equal(t, tc.hibernated, peer.GetAnnotations()[annReclaimedAt] != "", "need %d MiB", tc.need)
	}
}

// TEST_SCENARIO: the request moves in 512 MiB steps, so guests drifting by a few MiB at every probe do not resize the runner pod each time.
func TestTheRequestMovesInWholeSteps(t *testing.T) {
	assert.Equal(t, 512, roundedMiB(1))
	assert.Equal(t, 512, roundedMiB(512))
	assert.Equal(t, 1024, roundedMiB(513))
}

// TEST_SCENARIO: the memory pass sizes an owner's runner from its own read of which agents run, taken before it asks the runner about each machine. If an agent's own reconcile stops it in between, the pass must not write its stale "running" back into the record peers are counted by, or the request stays high and pressure hibernates other agents for room that is already free.
func TestSizingLeavesTheRunningRecordToTheReconcileThatDecidedIt(t *testing.T) {
	agent := vmAgentCR()
	r, _, _ := setupVMReconciler(t, agent)
	r.vmRunning.Store(agent.Name, false)

	_, err := r.ownerRunnerDemand(context.Background(), testOwner, agent, true)
	require.NoError(t, err)

	running, _ := r.vmRunning.Load(agent.Name)
	assert.Equal(t, false, running)
}

// TEST_SCENARIO: a vm agent has no size of its own: on a runner with a memory limit every machine may grow to half of what the runner hands out, whatever its spec names, so one agent can use most of the pool and a runaway guest still hits its own OOM killer first. Until the runner measures it, a machine counts at the boot estimate rather than that half, or a runner roll would boot only two machines at a time.
func TestAMachineIsSizedToHalfThePoolAndCountedAtTheBootEstimateUntilMeasured(t *testing.T) {
	agent := vmAgentCR()
	r, node, _ := setupVMReconciler(t, agent)
	r.config.VM.Runner.Resources = &corev1.ResourceRequirements{Limits: corev1.ResourceList{corev1.ResourceMemory: resource.MustParse("16Gi")}}
	r.config.VM.Runner.BootMiB = 2048
	peerVMAgent(t, r, "peer-up", "512Mi", "20Gi", true)
	ctx := context.Background()

	require.NoError(t, r.Reconcile(ctx, agent))
	assert.Equal(t, (16384-512)/2, node.spec("my-agent").MemoryMiB, "the machine was sized from the agent's spec")

	d, err := r.ownerRunnerDemand(ctx, testOwner, agent, true)
	require.NoError(t, err)
	assert.Equal(t, 2*2048, d.memoryMiB, "unmeasured machines count at the boot estimate")

	r.noteMachineUse("peer-up", measured(6000))
	d, err = r.ownerRunnerDemand(ctx, testOwner, agent, true)
	require.NoError(t, err)
	assert.Equal(t, 2048+6000+256, d.memoryMiB, "a measured machine counts at its use, past the boot estimate")
}

// TEST_SCENARIO: a harness starts only once its guest answers and grows to 2 to 3 GiB within the next minute, so a machine measured small right after its boot must not free room its harness is about to take. While the runner reports it warming up it counts at the warm-up floor, as the runner admits it, and at its use plus headroom once it has warmed up.
func TestAWarmingMachineMeasuredSmallCountsAtTheWarmUpFloor(t *testing.T) {
	agent := vmAgentCR()
	r, _, _ := setupVMReconciler(t, agent)
	r.config.VM.Runner.Resources = &corev1.ResourceRequirements{Limits: corev1.ResourceList{corev1.ResourceMemory: resource.MustParse("16Gi")}}
	r.config.VM.Runner.BootMiB = 3072
	peerVMAgent(t, r, "peer-up", "512Mi", "20Gi", true)
	ctx := context.Background()

	r.noteMachineUse("peer-up", vmrunner.MachineStatus{State: vmrunner.StateRunning, UsedMiB: 300, Warming: true})
	d, err := r.ownerRunnerDemand(ctx, testOwner, agent, true)
	require.NoError(t, err)
	assert.Equal(t, 2*3072, d.memoryMiB, "a warming machine measured at 300 MiB counts at the floor")

	r.noteMachineUse("peer-up", measured(300))
	d, err = r.ownerRunnerDemand(ctx, testOwner, agent, true)
	require.NoError(t, err)
	assert.Equal(t, 3072+300+256, d.memoryMiB, "a warmed-up machine counts at its use plus headroom")
}

// TEST_SCENARIO: the host runner admits against a share of the Mac's memory, not the chart's pod limit the install still has to set, so half of that limit would be a machine it refuses. There the agent's spec still sets the machine's memory.
func TestAHostRunnerMachineTakesItsMemoryFromTheSpec(t *testing.T) {
	agent := vmAgentCR()
	r, _, _ := setupVMReconciler(t, agent)
	r.config.VM.Runner.Resources = &corev1.ResourceRequirements{Limits: corev1.ResourceList{corev1.ResourceMemory: resource.MustParse("12Gi")}}
	r.config.VM.Runner.HostAddress = "192.168.5.2"

	size, err := r.machineMemoryMiB(context.Background(), testOwner, &agent.Spec)
	require.NoError(t, err)
	assert.Equal(t, 3072, size, "the host runner's machine was sized from the chart's pod limit")
}

// TEST_SCENARIO: a new size reaches a running machine only at its next start, so until then the machine may hold more than its new size says. Memory and vCPUs count it at the larger of the size it runs at and the one it will start with, so a shrink never lowers the request or the CPU limit under a guest still running large.
func TestAMachineStillRunningAtItsOldSizeCountsAtTheLarger(t *testing.T) {
	agent := vmAgentCR()
	r, _, _ := setupVMReconciler(t, agent)
	peerVMAgent(t, r, "peer-up", "2Gi", "20Gi", true)
	ctx := context.Background()
	cpus := max(r.config.VM.Runner.MachineCPUs, 1)

	before, err := r.ownerRunnerDemand(ctx, testOwner, agent, true)
	require.NoError(t, err)
	assert.Equal(t, 3072+2048, before.memoryMiB)
	assert.Equal(t, 2*cpus, before.vCPUs)

	r.noteMachineUse("peer-up", vmrunner.MachineStatus{State: vmrunner.StateRunning, CPUs: cpus + 4, MemoryMiB: 6144})
	larger, err := r.ownerRunnerDemand(ctx, testOwner, agent, true)
	require.NoError(t, err)
	assert.Equal(t, 3072+6144, larger.memoryMiB, "the machine runs at its old, larger size")
	assert.Equal(t, 2*cpus+4, larger.vCPUs)

	r.noteMachineUse("peer-up", vmrunner.MachineStatus{State: vmrunner.StateRunning, CPUs: 1, MemoryMiB: 1024})
	smaller, err := r.ownerRunnerDemand(ctx, testOwner, agent, true)
	require.NoError(t, err)
	assert.Equal(t, before, smaller, "the size its next start takes is the larger")
}

// TEST_SCENARIO: the memory pass reconciles an owner's agent only when that would change the runner pod's request. A count that crosses a step boundary but stays within the hold of the request the pod already has wakes no reconcile, or a guest sitting on the boundary would be reconciled at every pass for nothing; a count clearly below the step does.
func TestTheMemoryPassReconcilesOnlyWhenThePodRequestWouldMove(t *testing.T) {
	agent := vmAgentCR()
	r, node, _ := setupVMReconciler(t, agent)
	r.config.VM.Runner.Resources = &corev1.ResourceRequirements{
		Requests: corev1.ResourceList{corev1.ResourceMemory: resource.MustParse("1Gi")},
		Limits:   corev1.ResourceList{corev1.ResourceMemory: resource.MustParse("8Gi")},
	}
	clusterResizesPods(r, true)
	runnerPod(t, r, "2560Mi", "8Gi")
	pod, err := r.client.CoreV1().Pods("test-agents").Get(context.Background(), r.runnerName(testOwner)+"-abc", metav1.GetOptions{})
	require.NoError(t, err)
	pod.Spec.Containers[0].Resources.Limits[corev1.ResourceCPU] = resource.MustParse("8")
	_, err = r.client.CoreV1().Pods("test-agents").Update(context.Background(), pod, metav1.UpdateOptions{})
	require.NoError(t, err)
	r.vmRunning.Store(agent.Name, true)
	ctx := context.Background()
	pass := func(usedMiB int) bool {
		node.mu.Lock()
		node.statuses[agent.Name] = measured(usedMiB)
		node.mu.Unlock()
		_, moved := r.ownerMemoryPass(ctx, testOwner, []*apiv1.Agent{agent}, nil)
		return moved
	}

	assert.False(t, pass(2300-768), "a need of 2300 MiB already has its 2560Mi request")
	assert.False(t, pass(2040-768), "a need of 2040 MiB is held at 2560Mi")
	assert.True(t, pass(1860-768), "a need of 1860 MiB lowers the request to 2Gi")
	assert.Equal(t, 0, resizeCalls(r), "the pass leaves the resize to the reconcile")
}

// TEST_SCENARIO: a pass over an owner costs their runner one read, however many agents the owner runs: the usage read lists every machine with the memory figures a status carries for a running machine, where asking about each machine in turn was a round trip per running agent every half minute.
func TestAMemoryPassReadsTheOwnersRunnerOnce(t *testing.T) {
	agent := vmAgentCR()
	r, node, _ := setupVMReconciler(t, agent)
	ctx := context.Background()
	peers := []*apiv1.Agent{agent}
	r.vmRunning.Store(agent.Name, true)
	node.set(agent.Name, measured(700))
	for _, name := range []string{"peer-a", "peer-b", "peer-c"} {
		peerVMAgent(t, r, name, "4Gi", "20Gi", true)
		node.set(name, measured(700))
		r.vmRunning.Store(name, true)
		peer := vmAgentCR()
		peer.Name = name
		peers = append(peers, peer)
	}

	node.forgetReads()
	r.ownerMemoryPass(ctx, testOwner, peers, nil)

	node.mu.Lock()
	defer node.mu.Unlock()
	assert.Equal(t, 1, node.usageReads, "one read answers for every machine of the owner")
	assert.Equal(t, 0, node.statusReads, "a pass asks the runner about no machine in turn")
	assert.Equal(t, measured(700), r.liveMachine("peer-a"), "the figures come from the same read")
}

// TEST_SCENARIO: a runner release older than the usage read's per-machine memory figures answers without them. Its machines are then read one status at a time, as before, so a warming machine counts at its warm-up floor rather than at the memory it happens to hold, and a machine still running at its old, larger size keeps that size when the pool has shrunk under it. A zero read as those figures would drop both, and the runner pod's memory limit could then fall below what its machines hold. The figures a read does list are the ones a status reports, so only the older shape is read machine by machine.
func TestAMemoryPassOnAnOlderRunnerReadsEachMachineAsBefore(t *testing.T) {
	agent := vmAgentCR()
	r, node, _ := setupVMReconciler(t, agent)
	r.config.VM.Runner.BootMiB = 1024
	ctx := context.Background()

	r.vmRunning.Store(agent.Name, true)
	node.set(agent.Name, vmrunner.MachineStatus{State: vmrunner.StateRunning, UsedMiB: 300, Warming: true})
	peerVMAgent(t, r, "shrunk-peer", "4Gi", "20Gi", true)
	peer := vmAgentCR()
	peer.Name = "shrunk-peer"
	peer.Spec.Resources.Limits["memory"] = "4Gi"
	r.vmRunning.Store("shrunk-peer", true)
	node.set("shrunk-peer", vmrunner.MachineStatus{State: vmrunner.StateRunning, CPUs: 4, MemoryMiB: 6144, UsedMiB: 6000})

	node.mu.Lock()
	node.legacyUsage = true
	node.mu.Unlock()
	node.forgetReads()
	r.ownerMemoryPass(ctx, testOwner, []*apiv1.Agent{agent, peer}, nil)

	node.mu.Lock()
	assert.Equal(t, 1, node.usageReads, "the read still answers for the owner's machines")
	assert.Equal(t, 2, node.statusReads, "an older runner is asked about each machine in turn")
	node.mu.Unlock()
	assert.Equal(t, 1024, r.accountedMemoryMiB(ctx, testOwner, agent.Name, &agent.Spec),
		"a warming machine counts at its warm-up floor, not at the 556 MiB it holds")
	assert.Equal(t, 6144, r.accountedMemoryMiB(ctx, testOwner, "shrunk-peer", &peer.Spec),
		"a machine still running at its old size counts at that size, though the pool has shrunk under it")
}

// TEST_SCENARIO: the runner's pressure signal is the kernel's view, which is what kills the runner, so a pass on it hibernates an idle peer even while the counted demand is well under the threshold, and even when that peer alone does not cover the measured overshoot. The signal repeats while pressure lasts, so for a while after it freed room it hibernates nothing more, and it never runs beside the owner's other pass.
func TestAPressureSignalReclaimsBelowTheCountedThresholdOnceAWhile(t *testing.T) {
	agent := vmAgentCR()
	r, node, _ := setupVMReconciler(t, agent)
	r.podStatus = func(context.Context, string) (bool, bool) { return true, true }
	r.config.VM.Runner.Resources = &corev1.ResourceRequirements{Limits: corev1.ResourceList{corev1.ResourceMemory: resource.MustParse("8Gi")}}
	ctx := context.Background()
	idle := func(name string) {
		peerVMAgent(t, r, name, "4Gi", "20Gi", true)
		_, err := r.dynamic.Resource(AgentsGVR).Namespace("test-agents").Patch(ctx, name, "application/merge-patch+json",
			[]byte(`{"metadata":{"annotations":{"`+annLastActivity+`":"`+time.Now().UTC().Add(-10*time.Minute).Format(time.RFC3339)+`"}}}`),
			metav1.PatchOptions{})
		require.NoError(t, err)
		node.mu.Lock()
		node.statuses[name] = measured(700)
		node.mu.Unlock()
		r.noteMachineUse(name, measured(700))
	}
	r.vmRunning.Store(agent.Name, true)
	idle("idle-a")
	idle("idle-b")
	reclaimed := func(name string) bool {
		peer, err := r.dynamic.Resource(AgentsGVR).Namespace("test-agents").Get(ctx, name, metav1.GetOptions{})
		require.NoError(t, err)
		return peer.GetAnnotations()[annReclaimedAt] != ""
	}
	pressure := &vmrunner.RunnerPressure{Version: 2, Pressured: true, LimitMiB: 8192, WorkingSetMiB: 8000}

	r.ownerMemoryPass(ctx, testOwner, []*apiv1.Agent{agent}, nil)
	assert.False(t, reclaimed("idle-a") || reclaimed("idle-b"), "the half-minute pass reclaimed under the counted threshold")

	require.True(t, r.beginMemoryPass(testOwner))
	r.ownerMemoryPass(ctx, testOwner, []*apiv1.Agent{agent}, pressure)
	r.endMemoryPass(testOwner)
	assert.False(t, reclaimed("idle-a") || reclaimed("idle-b"), "a pass ran beside another for the same owner")

	r.ownerMemoryPass(ctx, testOwner, []*apiv1.Agent{agent}, pressure)
	assert.True(t, reclaimed("idle-a") && reclaimed("idle-b"), "the signal did not reclaim what it could")
}

// TEST_SCENARIO: an agent whose status does not answer may be deep in a long turn with its guest saturated, so a reclaim hibernates it only on the runner's pressure signal, when no agent said it is idle, because the OOM kill it heads off would stop it anyway; an agent that answered busy is never hibernated.
func TestASilentPeerIsReclaimedForMemoryOnlyAsAPressureLastResort(t *testing.T) {
	ctx := context.Background()
	for _, tc := range []struct {
		partial, answered, hibernated bool
	}{
		{partial: false, answered: false, hibernated: false},
		{partial: true, answered: false, hibernated: true},
		{partial: true, answered: true, hibernated: false},
	} {
		agent := vmAgentCR()
		r, _, _ := setupVMReconciler(t, agent)
		r.podStatus = func(context.Context, string) (bool, bool) { return false, tc.answered }
		peerVMAgent(t, r, "silent-peer", "4Gi", "20Gi", true)
		_, err := r.dynamic.Resource(AgentsGVR).Namespace("test-agents").Patch(ctx, "silent-peer", "application/merge-patch+json",
			[]byte(`{"metadata":{"annotations":{"`+annLastActivity+`":"`+time.Now().UTC().Add(-10*time.Minute).Format(time.RFC3339)+`"}}}`),
			metav1.PatchOptions{})
		require.NoError(t, err)
		r.noteMachineUse("silent-peer", measured(700))

		freed, err := r.reclaimRunnerMemory(ctx, testOwner, agent.Name, func() (int, error) { return 800, nil }, tc.partial)
		require.NoError(t, err)
		assert.Equal(t, tc.hibernated, freed, "partial=%v answered=%v", tc.partial, tc.answered)
	}
}

// TEST_SCENARIO: the machines a reclaim hibernated take seconds to stop, and the runner's working set counts them until they have, so the signal that repeats meanwhile must not hibernate more agents for room already freed.
func TestAPressureSignalRightAfterAReclaimHibernatesNothingMore(t *testing.T) {
	agent := vmAgentCR()
	r, node, _ := setupVMReconciler(t, agent)
	r.podStatus = func(context.Context, string) (bool, bool) { return true, true }
	r.config.VM.Runner.Resources = &corev1.ResourceRequirements{Limits: corev1.ResourceList{corev1.ResourceMemory: resource.MustParse("8Gi")}}
	ctx := context.Background()
	peerVMAgent(t, r, "idle-peer", "4Gi", "20Gi", true)
	_, err := r.dynamic.Resource(AgentsGVR).Namespace("test-agents").Patch(ctx, "idle-peer", "application/merge-patch+json",
		[]byte(`{"metadata":{"annotations":{"`+annLastActivity+`":"`+time.Now().UTC().Add(-10*time.Minute).Format(time.RFC3339)+`"}}}`),
		metav1.PatchOptions{})
	require.NoError(t, err)
	node.mu.Lock()
	node.statuses["idle-peer"] = measured(700)
	node.mu.Unlock()
	r.noteMachineUse("idle-peer", measured(700))
	r.vmRunning.Store(agent.Name, true)
	r.noteFreedUnderPressure(testOwner)

	r.ownerMemoryPass(ctx, testOwner, []*apiv1.Agent{agent}, &vmrunner.RunnerPressure{Version: 2, Pressured: true, LimitMiB: 8192, WorkingSetMiB: 8000})
	peer, err := r.dynamic.Resource(AgentsGVR).Namespace("test-agents").Get(ctx, "idle-peer", metav1.GetOptions{})
	require.NoError(t, err)
	assert.Empty(t, peer.GetAnnotations()[annReclaimedAt], "a signal inside the cooldown hibernated another agent")
}

// TEST_SCENARIO: a peer woken long ago whose cold boot is still in progress has an old last activity, but hibernating it for another start loses the start it is waiting for, so a start's reclaim passes it over. Once its boot is done it is reclaimable as before, and the runner's pressure signal may still take it, as the OOM kill would stop it too.
func TestAPeerStillBootingIsNotReclaimedForAnotherStart(t *testing.T) {
	ctx := context.Background()
	booting := `[{"type":"` + apiv1.ConditionAgentPodReady + `","status":"False","reason":"` + vmrunner.ReasonNotReady + `"},{"type":"` + apiv1.ConditionReady + `","status":"False","reason":"PodsNotReady"}]`
	ready := `[{"type":"` + apiv1.ConditionAgentPodReady + `","status":"True","reason":"PodReady"},{"type":"` + apiv1.ConditionReady + `","status":"True","reason":"AllPodsReady","lastTransitionTime":"` + time.Now().UTC().Add(-time.Minute).Format(time.RFC3339) + `"}]`
	for _, tc := range []struct {
		name       string
		conditions string
		partial    bool
		hibernated bool
	}{
		{"booting", booting, false, false},
		{"booting under pressure", booting, true, true},
		{"booted", ready, false, true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			agent := vmAgentCR()
			r, _, _ := setupVMReconciler(t, agent)
			r.podStatus = func(context.Context, string) (bool, bool) { return true, true }
			peerVMAgent(t, r, "peer", "4Gi", "20Gi", true)
			_, err := r.dynamic.Resource(AgentsGVR).Namespace("test-agents").Patch(ctx, "peer", "application/merge-patch+json",
				[]byte(`{"metadata":{"annotations":{"`+annLastActivity+`":"`+time.Now().UTC().Add(-10*time.Minute).Format(time.RFC3339)+`"}},"status":{"conditions":`+tc.conditions+`}}`),
				metav1.PatchOptions{})
			require.NoError(t, err)
			r.noteMachineUse("peer", measured(700))

			freed, err := r.reclaimRunnerMemory(ctx, testOwner, agent.Name, func() (int, error) { return 800, nil }, tc.partial)
			require.NoError(t, err)
			assert.Equal(t, tc.hibernated, freed)
		})
	}
}

// TEST_SCENARIO: a refused start and the memory pass reclaim for one owner from different goroutines. Once the start's reclaim has hibernated the idle agents its need called for, those agents no longer count, so the pass that follows sees the owner under its threshold and hibernates nothing more, rather than choosing more agents for room already freed. The runner's measured working set still holds their machines until they stop, so a pressure signal right after hibernates nothing more either.
func TestAReclaimAfterAnotherDoesNotCountItsVictimsAgain(t *testing.T) {
	agent := vmAgentCR()
	r, node, _ := setupVMReconciler(t, agent)
	r.podStatus = func(context.Context, string) (bool, bool) { return true, true }
	r.config.VM.Runner.Resources = &corev1.ResourceRequirements{Limits: corev1.ResourceList{corev1.ResourceMemory: resource.MustParse("8Gi")}}
	r.config.VM.Runner.BootMiB = 1024
	ctx := context.Background()
	r.vmRunning.Store(agent.Name, false)
	var peers []*apiv1.Agent
	for _, name := range []string{"idle-a", "idle-b", "idle-c", "idle-d", "idle-e", "idle-f", "idle-g", "idle-h"} {
		peerVMAgent(t, r, name, "4Gi", "20Gi", true)
		_, err := r.dynamic.Resource(AgentsGVR).Namespace("test-agents").Patch(ctx, name, "application/merge-patch+json",
			[]byte(`{"metadata":{"annotations":{"`+annLastActivity+`":"`+time.Now().UTC().Add(-10*time.Minute).Format(time.RFC3339)+`"}}}`),
			metav1.PatchOptions{})
		require.NoError(t, err)
		_, err = r.client.AppsV1().StatefulSets("test-agents").Patch(ctx, GatewayName(name), "application/merge-patch+json",
			[]byte(`{"metadata":{"labels":{"`+LabelAgent+`":"`+name+`"}}}`), metav1.PatchOptions{})
		require.NoError(t, err)
		node.mu.Lock()
		node.statuses[name] = measured(700)
		node.mu.Unlock()
		r.noteMachineUse(name, measured(700))
		r.vmRunning.Store(name, true)
		peer := vmAgentCR()
		peer.Name = name
		peers = append(peers, peer)
	}
	reclaimed := func() int {
		n := 0
		for _, p := range peers {
			got, err := r.dynamic.Resource(AgentsGVR).Namespace("test-agents").Get(ctx, p.Name, metav1.GetOptions{})
			require.NoError(t, err)
			if got.GetAnnotations()[annReclaimedAt] != "" {
				n++
			}
		}
		return n
	}

	require.NoError(t, r.reclaimForRefusedStart(ctx, agent, testOwner))
	require.Equal(t, 2, reclaimed(), "the start needs 992 MiB, two agents counted at 956 MiB each")

	r.ownerMemoryPass(ctx, testOwner, peers, nil)
	assert.Equal(t, 2, reclaimed(), "the pass counted the agents the start's reclaim hibernated and hibernated more")

	r.ownerMemoryPass(ctx, testOwner, peers, &vmrunner.RunnerPressure{Version: 2, Pressured: true, LimitMiB: 8192, WorkingSetMiB: 8000})
	assert.Equal(t, 2, reclaimed(), "the runner's working set still holds the machines the start's reclaim is stopping, and the signal hibernated more for them")
}
