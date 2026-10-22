// TEST_OVERVIEW: an owner's runner memory is counted by what the machines measurably use: a measured machine counts at its use plus headroom, never above its size, and room the runner lacks is freed by hibernating the owner's idle vm agents only when they cover all of it — or, on the runner's own pressure signal, as far as they go; a machine the runner refused for room counts toward nothing until a retry runs it.
package reconciler

import (
	"bytes"
	"context"
	"fmt"
	"strings"
	"sync"
	"testing"
	"testing/synctest"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	corev1 "k8s.io/api/core/v1"
	k8serrors "k8s.io/apimachinery/pkg/api/errors"
	apimeta "k8s.io/apimachinery/pkg/api/meta"
	"k8s.io/apimachinery/pkg/api/resource"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime"
	dynfake "k8s.io/client-go/dynamic/fake"
	k8stesting "k8s.io/client-go/testing"

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

		freed, err := r.reclaimRunnerMemory(ctx, testOwner, agent.Name, func() (int, error) { return tc.need, nil }, tc.partial, false)
		require.NoError(t, err)
		assert.Equal(t, tc.hibernated, freed > 0, "need %d MiB (partial %v) against a peer counted at 956 MiB", tc.need, tc.partial)
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

// TEST_SCENARIO: the runner's pressure signal is the kernel's view, which is what kills a machine, so a pass on it hibernates an idle peer even while the counted demand is well under the threshold, and even when that peer alone does not cover the measured overshoot. The signal repeats while pressure lasts, so for a while after it freed room it hibernates nothing more, and it never runs beside the owner's other pass.
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

// TEST_SCENARIO: under the runner's pressure signal the need comes from the kernel's working set, not from the usage read, so a read that fails must not end the pass: a fleet in trouble is still reclaimed, counting a machine never measured at its warm-up floor and a measured one at its last use, and the pass costs no status read per machine instead.
func TestAPressurePassReclaimsWhenTheUsageReadFails(t *testing.T) {
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
	node.usageFails = true
	node.mu.Unlock()
	r.vmRunning.Store(agent.Name, true)

	pressure := &vmrunner.RunnerPressure{Version: 2, Pressured: true, LimitMiB: 8192, WorkingSetMiB: 8000}
	r.ownerMemoryPass(ctx, testOwner, []*apiv1.Agent{agent}, pressure)

	peer, err := r.dynamic.Resource(AgentsGVR).Namespace("test-agents").Get(ctx, "idle-peer", metav1.GetOptions{})
	require.NoError(t, err)
	assert.NotEmpty(t, peer.GetAnnotations()[annReclaimedAt], "the pressure signal still frees an idle peer when the usage read fails")
	node.mu.Lock()
	assert.Equal(t, 0, node.statusReads, "a failed usage read does not fall back to a status read per machine")
	node.mu.Unlock()
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

		freed, err := r.reclaimRunnerMemory(ctx, testOwner, agent.Name, func() (int, error) { return 800, nil }, tc.partial, false)
		require.NoError(t, err)
		assert.Equal(t, tc.hibernated, freed > 0, "partial=%v answered=%v", tc.partial, tc.answered)
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

			freed, err := r.reclaimRunnerMemory(ctx, testOwner, agent.Name, func() (int, error) { return 800, nil }, tc.partial, false)
			require.NoError(t, err)
			assert.Equal(t, tc.hibernated, freed > 0)
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

	_, err := r.reclaimForRefusedStart(ctx, agent, testOwner, func() (int, error) { return r.runnerLimitMiB(ctx, testOwner) })
	require.NoError(t, err)
	require.Equal(t, 2, reclaimed(), "the start needs 992 MiB, two agents counted at 956 MiB each")

	r.ownerMemoryPass(ctx, testOwner, peers, nil)
	assert.Equal(t, 2, reclaimed(), "the pass counted the agents the start's reclaim hibernated and hibernated more")

	r.ownerMemoryPass(ctx, testOwner, peers, &vmrunner.RunnerPressure{Version: 2, Pressured: true, LimitMiB: 8192, WorkingSetMiB: 8000})
	assert.Equal(t, 2, reclaimed(), "the runner's working set still holds the machines the start's reclaim is stopping, and the signal hibernated more for them")
}

// TEST_SCENARIO: a runner roll, an OOM kill or a drain brings every machine of an owner back at once: the runner admits as many as the pool holds warm-up floors and refuses the rest until room frees on its 30-second retry. A refused machine holds nothing, and its pair is scaled to zero while it retries, so the half-minute pass must not count it at its floor — least of all as the agent it counts from, which the refused one is here, listed first — or the owner passes the threshold and the pass hibernates the machines the runner just admitted. That lost the first wave of every roll, against what budgets and vm-memory promise.
func TestARefusedMachineIsNotCountedBesideTheWarmUpsItWasRefusedFor(t *testing.T) {
	ctx := context.Background()
	refused := vmAgentCR()
	refused.Status.Conditions = []metav1.Condition{
		{Type: apiv1.ConditionReady, Status: metav1.ConditionFalse, Reason: apiv1.ReasonOverBudget, Message: "Your VM agents are using 2.5 of 3.0 GiB of memory"},
		{Type: apiv1.ConditionAgentPodReady, Status: metav1.ConditionFalse, Reason: apiv1.ReasonOverBudget},
	}
	r, node, _ := setupVMReconciler(t, refused)
	r.podStatus = func(context.Context, string) (bool, bool) { return true, true }
	r.config.VM.Runner.Resources = &corev1.ResourceRequirements{Limits: corev1.ResourceList{corev1.ResourceMemory: resource.MustParse("3Gi")}}
	r.config.VM.Runner.BootMiB = 1024
	for _, name := range []string{"warm-a", "warm-b"} {
		peerVMAgent(t, r, name, "2Gi", "20Gi", true)
		_, err := r.dynamic.Resource(AgentsGVR).Namespace("test-agents").Patch(ctx, name, "application/merge-patch+json",
			[]byte(`{"metadata":{"annotations":{"`+annLastActivity+`":"`+time.Now().UTC().Add(-10*time.Minute).Format(time.RFC3339)+`"}}}`),
			metav1.PatchOptions{})
		require.NoError(t, err)
		node.set(name, vmrunner.MachineStatus{State: vmrunner.StateRunning, UsedMiB: 200, Warming: true})
		r.vmRunning.Store(name, true)
	}
	r.vmRunning.Store(refused.Name, true)
	agents := []*apiv1.Agent{cachedAgent(t, r, refused.Name), cachedAgent(t, r, "warm-a"), cachedAgent(t, r, "warm-b")}
	clusterResizesPods(r, true)
	runnerPod(t, r, "1Gi", "3Gi")

	anchor, moved := r.ownerMemoryPass(ctx, testOwner, agents, nil)

	require.True(t, moved, "the pod's request is below what the owner's machines hold")
	assert.NotEqual(t, refused.Name, anchor, "the pass counted and reconciled from the machine the runner refused")
	assert.False(t, reclaimedAgent(t, r, "warm-a"), "the pass hibernated a machine the runner had just admitted")
	assert.False(t, reclaimedAgent(t, r, "warm-b"), "the pass hibernated a machine the runner had just admitted")
}

// TEST_SCENARIO: the refusal reaches the Agent's status only once the reconcile that saw it has published, so the pass can list an Agent that still reads as starting after the runner has already refused it. The controller records the refusal where the runner answers the start, under the owner's lock, so the pass counts from that state and not from its listing: the refusal stands on the stored Agent while the pass's own copy predates it.
func TestARefusalRecordedAtTheRunnerIsNotUndoneByAStaleAgent(t *testing.T) {
	ctx := context.Background()
	refused := vmAgentCR()
	r, node, _ := setupVMReconciler(t, refused)
	r.podStatus = func(context.Context, string) (bool, bool) { return true, true }
	r.config.VM.Runner.Resources = &corev1.ResourceRequirements{Limits: corev1.ResourceList{corev1.ResourceMemory: resource.MustParse("3Gi")}}
	r.config.VM.Runner.BootMiB = 1024
	for _, name := range []string{"warm-a", "warm-b"} {
		peerVMAgent(t, r, name, "2Gi", "20Gi", true)
		_, err := r.dynamic.Resource(AgentsGVR).Namespace("test-agents").Patch(ctx, name, "application/merge-patch+json",
			[]byte(`{"metadata":{"annotations":{"`+annLastActivity+`":"`+time.Now().UTC().Add(-10*time.Minute).Format(time.RFC3339)+`"}}}`),
			metav1.PatchOptions{})
		require.NoError(t, err)
		node.set(name, vmrunner.MachineStatus{State: vmrunner.StateRunning, UsedMiB: 200, Warming: true})
		r.vmRunning.Store(name, true)
	}
	r.vmRunning.Store(refused.Name, true)
	r.vmAnswers.Store(refused.Name, vmrunner.ReasonOutOfCapacity)
	stale := *cachedAgent(t, r, refused.Name)
	stale.Status.Conditions = nil
	agents := []*apiv1.Agent{&stale, cachedAgent(t, r, "warm-a"), cachedAgent(t, r, "warm-b")}

	r.ownerMemoryPass(ctx, testOwner, agents, nil)

	assert.False(t, reclaimedAgent(t, r, "warm-a"), "the pass hibernated a machine the runner had just admitted")
	assert.False(t, reclaimedAgent(t, r, "warm-b"), "the pass hibernated a machine the runner had just admitted")
}

// TEST_SCENARIO: a machine the runner refused holds nothing, whether it was refused for room (the Agent parked OverBudget) or for storage (the Agent awake with no machine), and whether the refusal was recorded where the runner answered the start or has only reached the Agent's status. So the owner's memory counts it at nothing until a retry gets it running, and then at its use like any other: the refusal of an attempt before stands, and only the live machine says the guest came back.
func TestARefusedMachineCountsNothingUntilItsRetryRuns(t *testing.T) {
	for _, tc := range []struct {
		name       string
		conditions string
		recorded   bool
	}{
		{name: "parked for room", conditions: `[{"type":"` + apiv1.ConditionReady + `","status":"False","reason":"` + apiv1.ReasonOverBudget + `"}]`},
		{name: "refused for storage", conditions: `[{"type":"` + apiv1.ConditionAgentPodReady + `","status":"False","reason":"` + vmrunner.ReasonStorageFull + `"}]`},
		{name: "a home that is full", conditions: `[{"type":"` + apiv1.ConditionAgentPodReady + `","status":"False","reason":"` + vmrunner.ReasonHomeFull + `"}]`},
		{name: "a boot that failed", conditions: `[{"type":"` + apiv1.ConditionAgentPodReady + `","status":"False","reason":"` + vmrunner.ReasonBootFailed + `"}]`},
		{name: "a cache the runner cannot reach", conditions: `[{"type":"` + apiv1.ConditionAgentPodReady + `","status":"False","reason":"` + vmrunner.ReasonImageCacheUnreachable + `"}]`},
		{name: "refusal recorded before its status", recorded: true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			ctx := context.Background()
			agent := vmAgentCR()
			r, _, _ := setupVMReconciler(t, agent)
			peerVMAgent(t, r, "peer", "2Gi", "20Gi", true)
			if tc.conditions != "" {
				_, err := r.dynamic.Resource(AgentsGVR).Namespace("test-agents").Patch(ctx, "peer", "application/merge-patch+json",
					[]byte(`{"status":{"conditions":`+tc.conditions+`}}`), metav1.PatchOptions{})
				require.NoError(t, err)
			}
			if tc.recorded {
				r.vmAnswers.Store("peer", vmrunner.ReasonImageUnavailable)
			}

			d, err := r.ownerRunnerDemand(ctx, testOwner, agent, true)
			require.NoError(t, err)
			assert.Equal(t, 3072, d.memoryMiB, "the refused machine holds nothing")

			r.noteMachineUse("peer", measured(700))
			d, err = r.ownerRunnerDemand(ctx, testOwner, agent, true)
			require.NoError(t, err)
			assert.Equal(t, 3072+700+256, d.memoryMiB, "a retry that got the machine running counts at its use as any other")
		})
	}
}

func cachedAgent(t *testing.T, r *AgentReconciler, name string) *apiv1.Agent {
	t.Helper()
	u, err := r.dynamic.Resource(AgentsGVR).Namespace("test-agents").Get(context.Background(), name, metav1.GetOptions{})
	require.NoError(t, err)
	a, err := FromCacheObject[apiv1.Agent](u)
	require.NoError(t, err)
	return a
}

func reclaimedAgent(t *testing.T, r *AgentReconciler, name string) bool {
	t.Helper()
	return cachedAgent(t, r, name).Annotations[annReclaimedAt] != ""
}

// TEST_SCENARIO: a refused start keeps its park until a retry fits, so from the second retry on the Agent already reads OverBudget when its own reclaim runs. That park says the machine holds nothing, not that the start needs nothing: the room it needs is still freed from the owner's idle agents, or a refused start would never get in however long it retried. A sibling the runner refused is no room to take — hibernating it frees nothing — so the reclaim passes it over for a machine that holds memory, even though it is the idlest and the closest to the shortfall.
func TestARetriedStartFreesRoomForItselfUnderItsOwnPark(t *testing.T) {
	ctx := context.Background()
	refused := vmAgentCR()
	r, _, _ := setupVMReconciler(t, refused)
	r.podStatus = func(context.Context, string) (bool, bool) { return true, true }
	r.config.VM.Runner.Resources = &corev1.ResourceRequirements{Limits: corev1.ResourceList{corev1.ResourceMemory: resource.MustParse("3Gi")}}
	r.config.VM.Runner.BootMiB = 1024
	idle := func(name string, idleFor time.Duration, conditions string, usedMiB int) {
		peerVMAgent(t, r, name, "2Gi", "20Gi", true)
		patch := `{"metadata":{"annotations":{"` + annLastActivity + `":"` + time.Now().UTC().Add(-idleFor).Format(time.RFC3339) + `"}}`
		if conditions != "" {
			patch += `,"status":{"conditions":` + conditions + `}`
		}
		_, err := r.dynamic.Resource(AgentsGVR).Namespace("test-agents").Patch(ctx, name, "application/merge-patch+json", []byte(patch+"}"), metav1.PatchOptions{})
		require.NoError(t, err)
		if usedMiB > 0 {
			r.noteMachineUse(name, measured(usedMiB))
		}
	}
	storageRefused := `[{"type":"` + apiv1.ConditionAgentPodReady + `","status":"False","reason":"` + vmrunner.ReasonStorageFull + `"}]`
	idle("refused-peer", 20*time.Minute, storageRefused, 0)
	idle("idle-a", 10*time.Minute, "", 700)
	idle("idle-b", 10*time.Minute, "", 700)
	_, err := r.dynamic.Resource(AgentsGVR).Namespace("test-agents").Patch(ctx, refused.Name, "application/merge-patch+json",
		[]byte(`{"status":{"conditions":[{"type":"`+apiv1.ConditionReady+`","status":"False","reason":"`+apiv1.ReasonOverBudget+`"}]}}`),
		metav1.PatchOptions{})
	require.NoError(t, err)

	_, err = r.reclaimForRefusedStart(ctx, cachedAgent(t, r, refused.Name), testOwner, func() (int, error) { return r.runnerLimitMiB(ctx, testOwner) })
	require.NoError(t, err)

	assert.False(t, reclaimedAgent(t, r, "refused-peer"), "a machine that holds nothing was hibernated for room it could not give")
	assert.True(t, reclaimedAgent(t, r, "idle-a"), "the start needs 376 MiB, and the idlest agent that holds memory gives 956 MiB")
}

// TEST_SCENARIO: a runner restart, a roll or a drain boots an owner's machines again, each counted at its warm-up floor until it has warmed, above what an idle guest settles at: the pool reads full while they come back and holds every one of them afterwards. A start the runner refuses for room inside that window waits instead of hibernating an idle agent the wave is bringing back, and reads as a start in progress rather than as OverBudget, so a wake waits for it instead of failing on a refusal.
func TestARefusedStartWaitsOutItsRunnersWarmUpWindow(t *testing.T) {
	r, _ := reconcilerWithAWarmUpWindow(t, time.Minute)

	require.NoError(t, r.Reconcile(context.Background(), cachedAgent(t, r, "my-agent")))

	cond := readyCondition(t, r, "my-agent")
	require.NotNil(t, cond)
	assert.Equal(t, apiv1.ReasonAwaitingWarmUp, cond.Reason, "the start was refused for room the wave holds at its warm-up floors")
	assert.Equal(t, vmAwaitingWarmUpMessage, cond.Message)
	assert.Equal(t, int32(0), agentSSReplicas(t, r, GatewayName("my-agent")), "a start waiting out the wave is parked as one in progress")
	assert.False(t, reclaimedAgent(t, r, "idle-peer"), "the start hibernated an agent the wave is bringing back")
	assert.False(t, reclaimedAgent(t, r, "idle-peer-2"), "the start hibernated an agent the wave is bringing back")
}

// TEST_SCENARIO: the window is a bound on how long the platform waits, not a promise of room: past it the pool is the owner's to free, so the start hibernates the idlest agent that covers the room it lacks, and reads as a start waiting for room it has just freed rather than as a refusal that asks the owner to disable an agent.
func TestAStartRefusedAfterItsRunnersWarmUpWindowFreesRoom(t *testing.T) {
	r, _ := reconcilerWithAWarmUpWindow(t, runnerWarmUpWindow+time.Minute)

	require.NoError(t, r.Reconcile(context.Background(), cachedAgent(t, r, "my-agent")))

	cond := readyCondition(t, r, "my-agent")
	require.NotNil(t, cond)
	assert.Equal(t, apiv1.ReasonAwaitingMemory, cond.Reason, "the wave was over, so the pool was the owner's to free")
	assert.Equal(t, vmAwaitingMemoryMessage, cond.Message)
	assert.True(t, reclaimedAgent(t, r, "idle-peer"), "the idlest agent frees the room the start lacks")
}

// TEST_SCENARIO: the window is read from the runner pod, not from anything this controller remembers, so a controller restarted mid-wave keeps the same answer it gave before it restarted, and one that watched the whole wave gains nothing by having watched it. Forgetting every machine and every answer is a restart in all but the process, and it changes neither side of the window.
func TestTheWarmUpWindowIsThePodsAndNotTheControllers(t *testing.T) {
	r, now := reconcilerWithAWarmUpWindow(t, time.Minute)
	forget := func() {
		for _, name := range []string{"my-agent", "idle-peer", "idle-peer-2"} {
			r.vmLive.Delete(name)
			r.vmAnswers.Delete(name)
			r.vmRunning.Delete(name)
		}
		r.vmRunning.Store("my-agent", true)
	}
	refuse := func() { require.NoError(t, r.Reconcile(context.Background(), cachedAgent(t, r, "my-agent"))) }

	forget()
	refuse()
	assert.Equal(t, apiv1.ReasonAwaitingWarmUp, readyCondition(t, r, "my-agent").Reason, "a controller that never saw the wave did not wait for it")

	*now = now.Add(runnerWarmUpWindow)
	forget()
	refuse()
	assert.NotEqual(t, apiv1.ReasonAwaitingWarmUp, readyCondition(t, r, "my-agent").Reason, "the pod's own window was over, whatever this controller remembered")
	assert.True(t, reclaimedAgent(t, r, "idle-peer"))
}

// TEST_SCENARIO: the half-minute pass counts a wave at the same warm-up floors the refused start meets, so the share it reclaims from reads passed while the machines a restart brought back are still settling, and every one of them settles below it. It therefore hibernates nobody inside the window either, and leaves the runner's pressure signal, which is the kernel's own view, to say when room is truly running out; past the window it reclaims as it always did.
func TestTheMemoryPassFreesNothingInsideItsRunnersWarmUpWindow(t *testing.T) {
	for _, tc := range []struct {
		runningFor time.Duration
		reclaims   bool
	}{
		{time.Minute, false},
		{runnerWarmUpWindow + time.Minute, true},
	} {
		r, _ := reconcilerWithAWarmUpWindow(t, tc.runningFor)
		agents := []*apiv1.Agent{cachedAgent(t, r, "my-agent"), cachedAgent(t, r, "idle-peer"), cachedAgent(t, r, "idle-peer-2")}

		r.ownerMemoryPass(context.Background(), testOwner, agents, nil)

		assert.Equal(t, tc.reclaims, reclaimedAgent(t, r, "idle-peer"),
			"the pass and the refused start disagree on the window a runner started "+tc.runningFor.String()+" ago")
	}
}

// UNIT_BOUNDARY_DESCRIPTION: an owner with two idle agents, the older first, and a start its runner refused for room, on a runner pod that started `runningFor` before now. The pool holds the machines' warm-up floors but not the start, so the room the start lacks is one an idle agent would give.
func reconcilerWithAWarmUpWindow(t *testing.T, runningFor time.Duration) (*AgentReconciler, *time.Time) {
	t.Helper()
	ctx := context.Background()
	r, node, _ := setupVMReconciler(t, vmAgentCR())
	r.podStatus = func(context.Context, string) (bool, bool) { return true, true }
	r.config.VM.Runner.BootMiB = 1024
	r.config.VM.Runner.Resources = &corev1.ResourceRequirements{Limits: corev1.ResourceList{corev1.ResourceMemory: resource.MustParse("2Gi")}}
	now := time.Now()
	r.clock = func() time.Time { return now }
	// UNIT_BOUNDARY_DESCRIPTION: the pod's start is what the window is read from, and it is the pod's own field: a status write is what the API server does to it.
	pods, err := r.runnerPods(ctx, testOwner, false)
	require.NoError(t, err)
	require.NotEmpty(t, pods)
	started := metav1.NewTime(now.Add(-runningFor))
	pods[0].Status.StartTime = &started
	_, err = r.client.CoreV1().Pods("test-agents").UpdateStatus(ctx, &pods[0], metav1.UpdateOptions{})
	require.NoError(t, err)
	for i, peer := range []string{"idle-peer", "idle-peer-2"} {
		peerVMAgent(t, r, peer, "4Gi", "20Gi", true)
		_, err := r.dynamic.Resource(AgentsGVR).Namespace("test-agents").Patch(ctx, peer, "application/merge-patch+json",
			[]byte(`{"metadata":{"annotations":{"`+annLastActivity+`":"`+now.Add(-time.Duration(12-i)*time.Minute).UTC().Format(time.RFC3339)+`"}}}`),
			metav1.PatchOptions{})
		require.NoError(t, err)
		r.vmRunning.Store(peer, true)
		node.set(peer, measured(700))
	}
	node.set("my-agent", vmrunner.MachineStatus{State: vmrunner.StateAbsent, Reason: vmrunner.ReasonOutOfCapacity, Message: "this machine's 768 MiB does not fit"})
	r.vmRunning.Store("my-agent", true)
	return r, &now
}

// TEST_SCENARIO: the pass reads the runner's usage, and the runner restarts before the pass keeps that reading: a reconcile records the refusal the restart brought and drops the sample the pass had counted from. Kept after that answer, the older reading counted a machine the runner holds nothing of, which is the defect this branch fixes, reached from the other side. So the pass reads usage and keeps it under the owner's lock, the one a reconcile records the runner's answer under, and the two cannot cross.
func TestAStatusSampleThePassReadBeforeARefusalIsNotKeptAfterIt(t *testing.T) {
	ctx := context.Background()
	agent := vmAgentCR()
	r, node, _ := setupVMReconciler(t, agent)
	node.set("my-agent", vmrunner.MachineStatus{State: vmrunner.StateRunning, UsedMiB: 2600})
	r.vmRunning.Store("my-agent", true)
	listed := cachedAgent(t, r, "my-agent")

	// UNIT_BOUNDARY_DESCRIPTION: the runner answers with the machines it listed, while the test holds that answer back, as a pass that reads it and pauses does.
	reading, release := make(chan struct{}), make(chan struct{})
	var letGoOnce, readOnce sync.Once
	letGo := func() { letGoOnce.Do(func() { close(release) }) }
	t.Cleanup(letGo)
	node.usageHook = func() {
		readOnce.Do(func() {
			close(reading)
			<-release
		})
	}
	passDone := make(chan struct{})
	go func() {
		defer close(passDone)
		r.ownerMemoryPass(ctx, testOwner, []*apiv1.Agent{listed}, nil)
	}()
	<-reading
	if lock := r.ownerLock(testOwner); lock.TryLock() {
		lock.Unlock()
		letGo()
		<-passDone
		t.Fatal("the pass reads usage outside the owner lock: the reading it keeps can land after a refusal and count a machine the runner holds nothing of")
	}
	// UNIT_BOUNDARY_DESCRIPTION: the runner restarted meanwhile, so the machine is gone and its start is refused.
	node.set("my-agent", vmrunner.MachineStatus{State: vmrunner.StateAbsent, Reason: vmrunner.ReasonOutOfCapacity})
	refused := make(chan struct{})
	go func() {
		defer close(refused)
		require.NoError(t, r.Reconcile(ctx, cachedAgent(t, r, "my-agent")))
	}()
	letGo()
	<-passDone
	<-refused

	assert.True(t, r.refusedWithoutMachine(cachedAgent(t, r, "my-agent")),
		"the reading the pass took before the refusal was kept after it, and counted a machine the runner no longer holds")
}

// TEST_SCENARIO: a refused start retries every 30 seconds, and its own reconcile is the one that hears the refusal. Sizing the pod from a demand that counts its own pending start would raise the request to that whole machine, and the next reconcile of any other agent would drop it again: a resize every pass, against the quarter-step hysteresis that exists to stop exactly that. So the runner's answer decides, and a refused start is sized out of what the owner's machines hold.
func TestARefusedStartDoesNotRaiseTheRunnerRequestForItself(t *testing.T) {
	ctx := context.Background()
	agent := vmAgentCR()
	r, node, _ := setupVMReconciler(t, agent)
	r.config.VM.Runner.Resources = &corev1.ResourceRequirements{
		Requests: corev1.ResourceList{corev1.ResourceMemory: resource.MustParse("1Gi")},
		Limits:   corev1.ResourceList{corev1.ResourceMemory: resource.MustParse("3Gi")},
	}
	clusterResizesPods(r, true)
	runnerPod(t, r, "1Gi", "3Gi")
	peerVMAgent(t, r, "peer-up", "2Gi", "20Gi", true)
	r.noteMachineUse("peer-up", measured(600))
	spendTheMemoryGrace(t, r, agent)
	node.set("my-agent", vmrunner.MachineStatus{State: vmrunner.StateAbsent, Reason: vmrunner.ReasonOutOfCapacity, Message: "does not fit"})

	require.NoError(t, r.Reconcile(ctx, agent))

	assert.Equal(t, apiv1.ReasonOverBudget, readyCondition(t, r, "my-agent").Reason, "the start was refused")
	assert.Equal(t, "1536Mi", runnerPodRequest(t, r),
		"the request covers the 856Mi its machines hold and the 512Mi reserve, not the 3Gi start the runner refused")
}

// TEST_SCENARIO: the pass reads the owner's Agents, then reclaims, and the runner can refuse the very start it counts from in between. So the demand it reclaims on leaves a machine the runner refused out, the anchor included, while the demand a start is sized by keeps counting that start: the room a refused start lacks is freed from its own count.
func TestThePassDemandLeavesOutARefusedMachineEvenAsItsAnchor(t *testing.T) {
	ctx := context.Background()
	agent := vmAgentCR()
	r, _, _ := setupVMReconciler(t, agent)
	peerVMAgent(t, r, "peer-up", "2Gi", "20Gi", true)
	r.noteMachineUse("peer-up", measured(600))

	full, err := r.ownerRunnerDemand(ctx, testOwner, agent, true)
	require.NoError(t, err)
	assert.Equal(t, 3072+600+256, full.memoryMiB, "a start the runner has not refused counts itself")

	r.vmAnswers.Store(agent.Name, vmrunner.ReasonOutOfCapacity)
	held, err := r.heldRunnerDemand(ctx, testOwner, agent, true)
	require.NoError(t, err)
	assert.Equal(t, 600+256, held.memoryMiB, "the pass's demand leaves the refused anchor out")

	kept, err := r.ownerRunnerDemand(ctx, testOwner, agent, true)
	require.NoError(t, err)
	assert.Equal(t, 3072+600+256, kept.memoryMiB, "the demand that sizes a start keeps counting it for its retry")
}

// TEST_SCENARIO: a start the runner refused for room frees that room from the owner's idle agents, and the machine a reclaim hibernated takes a moment to stop. Until it has, a retry is still refused and frees nothing more, so a refusal that reads as a refusal would tell the owner their memory is full for the seconds the platform is already making room: the start reads as one waiting for room it has freed, and is asked for again at the machine watch's cadence rather than at the parked tick. The wait is bounded: a retry that nothing has freed room for inside memoryReclaimWait is the pool's refusal again, with the message that says what frees it.
func TestAMemoryWaitHoldsWhileRoomFreesAndEndsAsARefusalAfterItsBound(t *testing.T) {
	ctx := context.Background()
	r, node, requeued := reconcilerWithARefusedStart(t)
	now := time.Now()
	r.clock = func() time.Time { return now }

	require.NoError(t, r.Reconcile(ctx, cachedAgent(t, r, "my-agent")))
	cond := readyCondition(t, r, "my-agent")
	require.NotNil(t, cond)
	assert.Equal(t, apiv1.ReasonAwaitingMemory, cond.Reason, "the start freed the room it lacked instead of asking the owner to")
	assert.Equal(t, vmAwaitingMemoryMessage, cond.Message)
	assert.True(t, reclaimedAgent(t, r, "idle-peer"), "the idlest agent frees the room the start lacks")
	assert.Equal(t, vmReadinessPoll, requeued.last(), "a start waiting for room just freed is asked for at the machine watch's cadence")

	node.set("my-agent", vmrunner.MachineStatus{State: vmrunner.StateAbsent, Reason: vmrunner.ReasonOutOfCapacity})
	require.NoError(t, r.Reconcile(ctx, cachedAgent(t, r, "my-agent")))
	assert.Equal(t, apiv1.ReasonAwaitingMemory, readyCondition(t, r, "my-agent").Reason,
		"the retry read as a refusal while the machine the reclaim hibernated was still stopping")

	now = now.Add(memoryReclaimWait)
	require.NoError(t, r.Reconcile(ctx, cachedAgent(t, r, "my-agent")))
	cond = readyCondition(t, r, "my-agent")
	require.NotNil(t, cond)
	assert.Equal(t, apiv1.ReasonOverBudget, cond.Reason, "nothing freed room for it inside the bound, so it is the pool's refusal again")
	assert.Contains(t, cond.Message, "can't start yet")
}

// TEST_SCENARIO: the room a refused start frees is an agent idle *now*, not one that has reached its own hibernation timeout: a peer idle for a few minutes of an auto-sleep it would take half an hour to reach is the cheapest room there is, and waiting for that timeout would leave the start parked for the half hour. The floor under that is the reclaim's own, which keeps an agent whose turn just ended out of it.
func TestAStartFreesRoomFromAPeerIdleOnlyBriefly(t *testing.T) {
	ctx := context.Background()
	r, _, _ := reconcilerWithARefusedStart(t)
	_, err := r.dynamic.Resource(AgentsGVR).Namespace("test-agents").Patch(ctx, "idle-peer", "application/merge-patch+json",
		[]byte(`{"spec":{"hibernationTimeout":"30m"}}`), metav1.PatchOptions{})
	require.NoError(t, err)
	setIdlePeer(t, r, "idle-peer", 4*time.Minute)
	annotatePeer(t, r, "idle-peer-2", annActiveSession, "true")

	require.NoError(t, r.Reconcile(ctx, cachedAgent(t, r, "my-agent")))

	assert.True(t, reclaimedAgent(t, r, "idle-peer"), "a peer idle four minutes of its thirty was left to its own hibernation timeout")
	assert.Equal(t, apiv1.ReasonAwaitingMemory, readyCondition(t, r, "my-agent").Reason)
}

// TEST_SCENARIO: the peers a memory refusal may hibernate are only the ones that say they are idle when asked. A peer with a session attached, one with invocations in flight, and one the runtime answers as busy are all work in progress, and hibernating any of them loses it for a start that is not yet running: none is chosen, and with no room freed the start reads as the refusal it is.
func TestAMemoryRefusalSparesAPeerWithWorkInFlight(t *testing.T) {
	for _, tc := range []struct {
		name        string
		annotations map[string]string
		busy        bool
	}{
		{name: "attached session", annotations: map[string]string{annActiveSession: "true"}},
		{name: "invocations in flight", annotations: map[string]string{annInvocationsActive: "true"}},
		{name: "busy when asked", busy: true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			ctx := context.Background()
			r, _, _ := reconcilerWithARefusedStart(t)
			if tc.busy {
				r.podStatus = func(context.Context, string) (bool, bool) { return false, true }
			}
			for k, v := range tc.annotations {
				for _, peer := range []string{"idle-peer", "idle-peer-2"} {
					annotatePeer(t, r, peer, k, v)
				}
			}

			spendTheMemoryGrace(t, r, cachedAgent(t, r, "my-agent"))
			require.NoError(t, r.Reconcile(ctx, cachedAgent(t, r, "my-agent")))

			for _, peer := range []string{"idle-peer", "idle-peer-2"} {
				assert.False(t, reclaimedAgent(t, r, peer), "a peer with work in flight was hibernated for a start that is not running")
			}
			assert.Equal(t, apiv1.ReasonOverBudget, readyCondition(t, r, "my-agent").Reason, "no room was freed, so the start reads as the refusal it is")
		})
	}
}

// TEST_SCENARIO: a start that got its room reads ready like any other, and the wait recorded for it goes with the room it waited for. A later refusal of the same agent is a refusal of the pool, not the wait of a start whose room was freed minutes ago.
func TestAMemoryWaitDoesNotOutliveTheStartThatWaited(t *testing.T) {
	ctx := context.Background()
	r, node, _ := reconcilerWithARefusedStart(t)

	require.NoError(t, r.Reconcile(ctx, cachedAgent(t, r, "my-agent")))
	require.Equal(t, apiv1.ReasonAwaitingMemory, readyCondition(t, r, "my-agent").Reason, "precondition: the start waited on the room it freed")

	node.set("my-agent", vmrunner.MachineStatus{State: vmrunner.StateRunning, UsedMiB: 600})
	require.NoError(t, r.Reconcile(ctx, cachedAgent(t, r, "my-agent")))
	require.NotEqual(t, apiv1.ReasonAwaitingMemory, readyCondition(t, r, "my-agent").Reason, "precondition: the start went through")

	node.set("my-agent", vmrunner.MachineStatus{State: vmrunner.StateAbsent, Reason: vmrunner.ReasonOutOfCapacity})
	spendTheMemoryGrace(t, r, cachedAgent(t, r, "my-agent"))
	require.NoError(t, r.Reconcile(ctx, cachedAgent(t, r, "my-agent")))
	assert.Equal(t, apiv1.ReasonOverBudget, readyCondition(t, r, "my-agent").Reason, "a wait outlived the start it was for")
}

// UNIT_BOUNDARY_DESCRIPTION: an owner whose two measured idle peers fill the pool beside a start its runner refuses for room, outside any warm-up window: the room the start lacks is one peer's, so one of them is enough to free it.
func reconcilerWithARefusedStart(t *testing.T) (*AgentReconciler, *fakeNode, *requeueLog) {
	t.Helper()
	r, node, requeued := setupVMReconciler(t, vmAgentCR())
	r.podStatus = func(context.Context, string) (bool, bool) { return true, true }
	r.config.VM.Runner.BootMiB = 1024
	r.config.VM.Runner.Resources = &corev1.ResourceRequirements{Limits: corev1.ResourceList{corev1.ResourceMemory: resource.MustParse("2Gi")}}
	peerVMAgent(t, r, "idle-peer", "4Gi", "20Gi", true)
	labelPeerGateway(t, r, "idle-peer")
	setIdlePeer(t, r, "idle-peer", 12*time.Minute)
	r.vmRunning.Store("idle-peer", true)
	r.noteMachineUse("idle-peer", measured(700))
	peerVMAgent(t, r, "idle-peer-2", "4Gi", "20Gi", true)
	labelPeerGateway(t, r, "idle-peer-2")
	setIdlePeer(t, r, "idle-peer-2", 11*time.Minute)
	r.vmRunning.Store("idle-peer-2", true)
	r.noteMachineUse("idle-peer-2", measured(700))
	node.set("my-agent", vmrunner.MachineStatus{State: vmrunner.StateAbsent, Reason: vmrunner.ReasonOutOfCapacity, Message: "this machine's 768 MiB does not fit"})
	r.vmRunning.Store("my-agent", true)
	return r, node, requeued
}

// UNIT_BOUNDARY_DESCRIPTION: the label a gateway carries in production, which is what the pair's scale-down looks its StatefulSets up by: without it a test's peer machine is never scaled down, and its gateway reads as one that should run however idle its agent is.
func labelPeerGateway(t *testing.T, r *AgentReconciler, name string) {
	t.Helper()
	_, err := r.client.AppsV1().StatefulSets("test-agents").Patch(context.Background(), GatewayName(name), "application/merge-patch+json",
		[]byte(`{"metadata":{"labels":{"`+LabelAgent+`":"`+name+`"}}}`), metav1.PatchOptions{})
	require.NoError(t, err)
}

// UNIT_BOUNDARY_DESCRIPTION: a start refused a moment ago is given a grace before the refusal is read as the pool's, so a test of the refusal itself is one whose grace is behind it.
func spendTheMemoryGrace(t *testing.T, r *AgentReconciler, agent *apiv1.Agent) {
	t.Helper()
	past := time.Now().UTC().Add(-time.Second).Format(time.RFC3339)
	if agent.Annotations == nil {
		agent.Annotations = map[string]string{}
	}
	agent.Annotations[annMemoryWaitUntil] = past
	annotatePeer(t, r, agent.Name, annMemoryWaitUntil, past)
	r.markMemoryGraced(agent.Name, agent.Annotations[annLastActivity])
}

// UNIT_BOUNDARY_DESCRIPTION: a stamp a peer carries, such as the session attached to it or the invocations in flight, which no reclaim may hibernate it under however idle its own clock reads.
func annotatePeer(t *testing.T, r *AgentReconciler, name, key, value string) {
	t.Helper()
	_, err := r.dynamic.Resource(AgentsGVR).Namespace("test-agents").Patch(context.Background(), name, "application/merge-patch+json",
		[]byte(`{"metadata":{"annotations":{"`+key+`":"`+value+`"}}}`), metav1.PatchOptions{})
	require.NoError(t, err)
}

// UNIT_BOUNDARY_DESCRIPTION: an awake peer, ready as a running machine's Agent is, idle for `for` — the stamp a reclaim measures its idleness by, and the readiness that tells the boot guard this is no cold boot still coming up.
func setIdlePeer(t *testing.T, r *AgentReconciler, name string, idleFor time.Duration) {
	t.Helper()
	_, err := r.dynamic.Resource(AgentsGVR).Namespace("test-agents").Patch(context.Background(), name, "application/merge-patch+json",
		[]byte(`{"metadata":{"annotations":{"`+annLastActivity+`":"`+time.Now().UTC().Add(-idleFor).Format(time.RFC3339)+`"}},`+
			`"status":{"conditions":[{"type":"`+apiv1.ConditionReady+`","status":"True","reason":"Ready","lastTransitionTime":"`+time.Now().UTC().Add(-idleFor).Format(time.RFC3339)+`"}]}}`),
		metav1.PatchOptions{})
	require.NoError(t, err)
}

// TEST_SCENARIO: the stamp of a memory wait is on the Agent, so a controller that restarts while the machine its predecessor put to sleep still stops keeps the wait it earned: the agents left to choose are already down, and a reconciler that remembered the reclaim only in its own process would read the same refusal as the pool's and fail a wake on memory already being handed back. The stamp is the deadline, so the restart reads the time left rather than starting the minute again.
func TestAMemoryWaitSurvivesAControllerRestart(t *testing.T) {
	ctx := context.Background()
	r, node, _ := reconcilerWithARefusedStart(t)
	now := time.Now()
	r.clock = func() time.Time { return now }
	node.mu.Lock()
	node.stopsSlowly = true
	node.mu.Unlock()

	require.NoError(t, r.Reconcile(ctx, cachedAgent(t, r, "my-agent")))
	require.Equal(t, apiv1.ReasonAwaitingMemory, readyCondition(t, r, "my-agent").Reason, "precondition: the start waited on the room it freed")

	// UNIT_BOUNDARY_DESCRIPTION: the reconciler before it, gone with everything it held in memory, on the same clients and the same runner.
	stopMachineWatches(r)
	fresh := NewAgentReconciler(r.client, r.dynamic, r.config)
	fresh.runnerEndpoint, fresh.podStatus, fresh.clock = r.runnerEndpoint, r.podStatus, r.clock
	fresh.WithRequeue(t.Context(), func(string, time.Duration) {})
	t.Cleanup(func() { stopMachineWatches(fresh) })

	node.set("my-agent", vmrunner.MachineStatus{State: vmrunner.StateAbsent, Reason: vmrunner.ReasonOutOfCapacity})
	require.NoError(t, fresh.Reconcile(ctx, cachedAgent(t, fresh, "my-agent")))
	assert.Equal(t, apiv1.ReasonAwaitingMemory, readyCondition(t, fresh, "my-agent").Reason,
		"a restart turned room already being freed into an immediate refusal")

	now = now.Add(memoryReclaimWait)
	require.NoError(t, fresh.Reconcile(ctx, cachedAgent(t, fresh, "my-agent")))
	assert.Equal(t, apiv1.ReasonOverBudget, readyCondition(t, fresh, "my-agent").Reason,
		"the deadline the stamp carries was not the one the wait started with")
}

// TEST_SCENARIO: a reclaim that needs two agents can put the first to sleep and fail on the second's stamp. The agent that slept is gone whatever the failure did to the pass, so the start is waiting for room it freed: a wait recorded only after the whole reclaim answered would leave it reading as a refusal, with nothing left to choose on the retry.
func TestAMemoryWaitKeepsTheAgentsASplitReclaimDidSleep(t *testing.T) {
	ctx := context.Background()
	r, _, _ := reconcilerWithARefusedStart(t)
	peerVMAgent(t, r, "idle-peer-3", "4Gi", "20Gi", true)
	labelPeerGateway(t, r, "idle-peer-3")
	setIdlePeer(t, r, "idle-peer-3", 10*time.Minute)
	r.vmRunning.Store("idle-peer-3", true)
	r.noteMachineUse("idle-peer-3", measured(700))
	failing := true
	r.dynamic.(*dynfake.FakeDynamicClient).PrependReactor("patch", "agents", func(a k8stesting.Action) (bool, runtime.Object, error) {
		if failing && a.(k8stesting.PatchAction).GetName() == "idle-peer-2" {
			return true, nil, fmt.Errorf("the second victim's stamp was refused")
		}
		return false, nil, nil
	})

	require.Error(t, r.Reconcile(ctx, cachedAgent(t, r, "my-agent")), "precondition: the second victim's stamp failed")
	failing = false
	require.True(t, reclaimedAgent(t, r, "idle-peer"), "precondition: the first victim was already put to sleep")
	require.NotEmpty(t, cachedAgent(t, r, "my-agent").Annotations[annMemoryWaitUntil], "the room that agent freed was forgotten because a later one failed")

	for _, name := range []string{"idle-peer-2", "idle-peer-3"} {
		annotatePeer(t, r, name, annActiveSession, "true")
	}
	require.NoError(t, r.Reconcile(ctx, cachedAgent(t, r, "my-agent")))
	assert.Equal(t, apiv1.ReasonAwaitingMemory, readyCondition(t, r, "my-agent").Reason,
		"a later reclaim error discarded the room already being freed")
}

// TEST_SCENARIO: the hibernation is what earns the wait, so a write that records it failing once is retried rather than read as a pool with nothing freed: a controller write refused by an apiserver under load is not a start that must be refused, and the deadline it retries is the one earned rather than a fresh minute.
func TestAMemoryWaitSurvivesAFailedDeadlineWrite(t *testing.T) {
	for name, writeErr := range map[string]error{
		"conflict":    k8serrors.NewConflict(AgentsGVR.GroupResource(), "my-agent", assert.AnError),
		"unavailable": k8serrors.NewServiceUnavailable("the apiserver is busy"),
	} {
		t.Run(name, func(t *testing.T) {
			ctx := context.Background()
			r, _, _ := reconcilerWithARefusedStart(t)
			refused := false
			r.dynamic.(*dynfake.FakeDynamicClient).PrependReactor("patch", "agents", func(a k8stesting.Action) (bool, runtime.Object, error) {
				if !refused && a.(k8stesting.PatchAction).GetName() == "my-agent" && bytes.Contains(a.(k8stesting.PatchAction).GetPatch(), []byte(annMemoryWaitUntil)) {
					refused = true
					return true, nil, writeErr
				}
				return false, nil, nil
			})

			r.Reconcile(ctx, cachedAgent(t, r, "my-agent"))
			require.True(t, refused, "precondition: the write that records the wait failed")
			require.True(t, reclaimedAgent(t, r, "idle-peer"), "precondition: the victim was already put to sleep")

			require.NoError(t, r.Reconcile(ctx, cachedAgent(t, r, "my-agent")))
			assert.Equal(t, apiv1.ReasonAwaitingMemory, readyCondition(t, r, "my-agent").Reason,
				"a failed write of the deadline turned the room already freed into a refusal")
			assert.NotEmpty(t, cachedAgent(t, r, "my-agent").Annotations[annMemoryWaitUntil], "the earned deadline was never written")
		})
	}
}

// TEST_SCENARIO: a victim counts as room made once its machine stopped and its gateway went down, which is before its status write: a status refused after that has not brought the machine back, and the start waits for the room rather than reading a refusal of it.
func TestAVictimsFailedStatusWriteCountsTheStopItAlreadyMade(t *testing.T) {
	ctx := context.Background()
	r, node, _ := reconcilerWithARefusedStart(t)
	node.set("idle-peer", measured(700))
	refused := false
	r.dynamic.(*dynfake.FakeDynamicClient).PrependReactor("update", "agents", func(a k8stesting.Action) (bool, runtime.Object, error) {
		if !refused && a.(k8stesting.UpdateAction).GetObject().(metav1.Object).GetName() == "idle-peer" && a.GetSubresource() == "status" {
			refused = true
			return true, nil, k8serrors.NewServiceUnavailable("the apiserver is busy")
		}
		return false, nil, nil
	})

	require.Error(t, r.Reconcile(ctx, cachedAgent(t, r, "my-agent")))
	require.True(t, refused, "precondition: the victim's status write failed")
	assert.False(t, node.spec("idle-peer").Running, "precondition: the machine stopped")
	assert.Equal(t, int32(0), agentSSReplicas(t, r, GatewayName("idle-peer")), "precondition: the gateway was scaled down")

	require.NoError(t, r.Reconcile(ctx, cachedAgent(t, r, "my-agent")))
	assert.Equal(t, apiv1.ReasonAwaitingMemory, readyCondition(t, r, "my-agent").Reason,
		"a refused status write discarded the stop that had already freed the room")
}

// TEST_SCENARIO: a victim the late re-read leaves running holds its room, so it counts for nothing: a start that reads a skip as room made would publish a wait for memory nothing freed, and the owner would wait a minute for a machine still running.
func TestAVictimTheReReadSkipsCountsNoRoom(t *testing.T) {
	for _, tc := range []struct {
		name   string
		breaks func(t *testing.T, r *AgentReconciler, ctx context.Context)
	}{
		{
			name: "it stopped being idle",
			breaks: func(t *testing.T, r *AgentReconciler, ctx context.Context) {
				probe := r.podStatus
				r.podStatus = func(ctx context.Context, name string) (bool, bool) {
					_, err := r.dynamic.Resource(AgentsGVR).Namespace("test-agents").Patch(ctx, name, "application/merge-patch+json",
						[]byte(`{"metadata":{"annotations":{"`+annActiveSession+`":"true"}}}`), metav1.PatchOptions{})
					require.NoError(t, err)
					return probe(ctx, name)
				}
			},
		},
		{
			name: "its stamp conflicts",
			breaks: func(t *testing.T, r *AgentReconciler, ctx context.Context) {
				r.dynamic.(*dynfake.FakeDynamicClient).PrependReactor("patch", "agents", func(a k8stesting.Action) (bool, runtime.Object, error) {
					name := a.(k8stesting.PatchAction).GetName()
					if !strings.HasPrefix(name, "idle-peer") {
						return false, nil, nil
					}
					return true, nil, k8serrors.NewConflict(AgentsGVR.GroupResource(), name, fmt.Errorf("the object has been modified"))
				})
			},
		},
	} {
		t.Run(tc.name, func(t *testing.T) {
			ctx := context.Background()
			r, node, _ := reconcilerWithARefusedStart(t)
			for _, name := range []string{"idle-peer", "idle-peer-2"} {
				node.set(name, measured(700))
			}
			spendTheMemoryGrace(t, r, cachedAgent(t, r, "my-agent"))
			tc.breaks(t, r, ctx)

			require.NoError(t, r.Reconcile(ctx, cachedAgent(t, r, "my-agent")))

			for _, name := range []string{"idle-peer", "idle-peer-2"} {
				assert.Equal(t, int32(1), agentSSReplicas(t, r, GatewayName(name)), "precondition: the skipped victim kept its gateway")
				assert.False(t, reclaimedAgent(t, r, name), "precondition: the skipped victim was not stamped")
			}
			assert.Equal(t, apiv1.ReasonOverBudget, readyCondition(t, r, "my-agent").Reason,
				"a victim left running was counted as room the start could wait for")
		})
	}
}

// UNIT_BOUNDARY_DESCRIPTION: an agent whose machine began holding memory the given time ago, as the controller's own watcher of the machine stamps it, and the readiness that start produced.
func wokeUp(t *testing.T, r *AgentReconciler, name string, ago time.Duration) {
	t.Helper()
	annotatePeer(t, r, name, annMachineUp, time.Now().UTC().Add(-ago).Format(time.RFC3339Nano))
	_, err := r.dynamic.Resource(AgentsGVR).Namespace("test-agents").Patch(context.Background(), name, "application/merge-patch+json",
		[]byte(`{"status":{"conditions":[{"type":"`+apiv1.ConditionAgentPodReady+`","status":"True","reason":"PodReady","lastTransitionTime":"`+
			time.Now().UTC().Add(-ago).Format(time.RFC3339)+`"}]}}`),
		metav1.PatchOptions{})
	require.NoError(t, err)
}

// TEST_SCENARIO: a start the runner refused for room is an owner asking for a machine now, so the peer that has been idle half a minute is the room it frees rather than one the three-minute floor protects; a peer used ten seconds ago is not, unless it woke ten seconds ago and answered idle, which is a machine left holding room by a wake that only listed sessions.
func TestARefusedStartFreesAPeerThatWentIdleHalfAMinuteAgo(t *testing.T) {
	for _, tc := range []struct {
		name      string
		idleFor   time.Duration
		woke      time.Duration
		reclaimed bool
	}{
		{name: "idle half a minute", idleFor: 40 * time.Second, reclaimed: true},
		{name: "idle ten seconds", idleFor: 10 * time.Second},
		{name: "idle ten seconds and just woke", idleFor: 10 * time.Second, woke: 5 * time.Second, reclaimed: true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			ctx := context.Background()
			r, _, _ := reconcilerWithARefusedStart(t)
			for _, peer := range []string{"idle-peer", "idle-peer-2"} {
				setIdlePeer(t, r, peer, tc.idleFor)
				if tc.woke > 0 {
					wokeUp(t, r, peer, tc.woke)
				}
			}

			require.NoError(t, r.Reconcile(ctx, cachedAgent(t, r, "my-agent")))

			assert.Equal(t, tc.reclaimed, reclaimedAgent(t, r, "idle-peer") || reclaimedAgent(t, r, "idle-peer-2"),
				"the room a refused start frees is the peer the floor it holds admits")
			assert.Equal(t, apiv1.ReasonAwaitingMemory, readyCondition(t, r, "my-agent").Reason,
				"a start whose room is being freed, or may be, reads as one in progress rather than as a refusal")
		})
	}
}

// TEST_SCENARIO: the floor a refused start is given does not reach the passes that free room on their own initiative: the runner's pressure signal takes a machine nothing is waiting for, so it keeps the three-minute floor that leaves a peer used a minute ago alone.
func TestThePassesThatFreeRoomOnTheirOwnKeepTheirFloor(t *testing.T) {
	ctx := context.Background()
	r, _, _ := reconcilerWithARefusedStart(t)
	for _, peer := range []string{"idle-peer", "idle-peer-2"} {
		setIdlePeer(t, r, peer, 40*time.Second)
	}
	r.ownerMemoryPass(ctx, testOwner, []*apiv1.Agent{cachedAgent(t, r, "my-agent")}, nil)
	assert.False(t, reclaimedAgent(t, r, "idle-peer") || reclaimedAgent(t, r, "idle-peer-2"),
		"the 90% pass took a peer the refused start would have taken")

	pressure := &vmrunner.RunnerPressure{Version: 2, Pressured: true, LimitMiB: 8192, WorkingSetMiB: 8000}
	require.True(t, r.beginMemoryPass(testOwner))
	r.ownerMemoryPass(ctx, testOwner, []*apiv1.Agent{cachedAgent(t, r, "my-agent")}, pressure)
	r.endMemoryPass(testOwner)
	assert.False(t, reclaimedAgent(t, r, "idle-peer") || reclaimedAgent(t, r, "idle-peer-2"),
		"the runner's pressure signal took a peer the refused start would have taken")
}

// TEST_SCENARIO: two agents that each need the other's room do not trade it in a loop: the peer a start slept wakes to a refusal of its own, and the start that displaced it holds nothing while it waits — its gateway is down and it is not a machine the runner holds — so the peer finds no room to free there and is refused rather than evicting the start that woke it.
func TestAPeerFreedForOneStartDoesNotEvictTheStartThatDisplacedIt(t *testing.T) {
	ctx := context.Background()
	r, node, _ := reconcilerWithARefusedStart(t)
	require.NoError(t, r.Reconcile(ctx, cachedAgent(t, r, "my-agent")))
	require.True(t, reclaimedAgent(t, r, "idle-peer"), "precondition: the first start slept the peer")
	require.Equal(t, apiv1.ReasonAwaitingMemory, readyCondition(t, r, "my-agent").Reason, "precondition: the first start waits for its room")

	leaf := leafSecret()
	leaf.Name = EnvoyLeafSecretName("idle-peer")
	_, err := r.client.CoreV1().Secrets("test-agents").Create(ctx, leaf, metav1.CreateOptions{})
	require.NoError(t, err)
	setIdlePeer(t, r, "idle-peer", 0)
	r.vmRunning.Store("idle-peer", true)
	node.set("idle-peer", vmrunner.MachineStatus{State: vmrunner.StateAbsent, Reason: vmrunner.ReasonOutOfCapacity, Message: "this machine's 768 MiB does not fit"})

	require.NoError(t, r.Reconcile(ctx, cachedAgent(t, r, "idle-peer")))

	assert.False(t, reclaimedAgent(t, r, "my-agent"), "the peer freed itself by evicting the start that displaced it")
	assert.Equal(t, apiv1.ReasonAwaitingMemory, readyCondition(t, r, "my-agent").Reason,
		"the start that displaced it lost the room it was waiting for")
	assert.Equal(t, apiv1.ReasonAwaitingMemory, readyCondition(t, r, "idle-peer").Reason,
		"the peer read as refused rather than waiting for a room that is not there")
}

// TEST_SCENARIO: a start refused for room with nothing yet to reclaim is given a moment's grace, so the page shows the loader before it shows the refusal; the grace is spent once, so a retry of the same refusal reads as the refusal it is rather than restarting the loader forever.
func TestAStartRefusedWithNothingToReclaimWaitsItsGraceThenReadsTheRefusal(t *testing.T) {
	ctx := context.Background()
	r, _, _ := reconcilerWithARefusedStart(t)
	now := time.Now()
	r.clock = func() time.Time { return now }
	for _, peer := range []string{"idle-peer", "idle-peer-2"} {
		setIdlePeer(t, r, peer, 10*time.Second)
		annotatePeer(t, r, peer, annActiveSession, "true")
	}

	require.NoError(t, r.Reconcile(ctx, cachedAgent(t, r, "my-agent")))
	assert.Equal(t, apiv1.ReasonAwaitingMemory, readyCondition(t, r, "my-agent").Reason, "the refusal was published before the loader")
	assert.False(t, reclaimedAgent(t, r, "idle-peer") || reclaimedAgent(t, r, "idle-peer-2"), "nothing was reclaimed")

	now = now.Add(memoryGraceWait + time.Second)
	require.NoError(t, r.Reconcile(ctx, cachedAgent(t, r, "my-agent")))
	assert.Equal(t, apiv1.ReasonOverBudget, readyCondition(t, r, "my-agent").Reason, "the grace outlived the moment it was for")

	now = now.Add(time.Second)
	require.NoError(t, r.Reconcile(ctx, cachedAgent(t, r, "my-agent")))
	assert.Equal(t, apiv1.ReasonOverBudget, readyCondition(t, r, "my-agent").Reason, "the grace restarted itself on the retry of the same refusal")
}

// TEST_SCENARIO: the grace is a wait for a peer, so a peer that goes idle inside it is reclaimed and the start takes the minute a reclaim earns rather than the moment the grace had left.
func TestAReclaimInsideTheGraceTakesOverTheWait(t *testing.T) {
	ctx := context.Background()
	r, _, _ := reconcilerWithARefusedStart(t)
	now := time.Now()
	r.clock = func() time.Time { return now }
	for _, peer := range []string{"idle-peer", "idle-peer-2"} {
		setIdlePeer(t, r, peer, 10*time.Second)
	}
	require.NoError(t, r.Reconcile(ctx, cachedAgent(t, r, "my-agent")))
	require.Equal(t, apiv1.ReasonAwaitingMemory, readyCondition(t, r, "my-agent").Reason, "precondition: the start is inside its grace")

	now = now.Add(10 * time.Second)
	for _, peer := range []string{"idle-peer", "idle-peer-2"} {
		setIdlePeer(t, r, peer, time.Minute)
	}
	require.NoError(t, r.Reconcile(ctx, cachedAgent(t, r, "my-agent")))

	assert.True(t, reclaimedAgent(t, r, "idle-peer") || reclaimedAgent(t, r, "idle-peer-2"),
		"the peer that went idle inside the grace was not reclaimed")
	until, err := time.Parse(time.RFC3339, cachedAgent(t, r, "my-agent").Annotations[annMemoryWaitUntil])
	require.NoError(t, err)
	assert.True(t, until.After(now.Add(30*time.Second)), "the wait was not the minute a reclaim earns")
}

// TEST_SCENARIO: a readiness that went false for one failed request and true again on the next is not a wake: the machine never stopped holding its room, so a peer used ten seconds ago keeps the half minute rather than being read as one that just came up and taken for it.
func TestAReadinessRecoveryIsNoWake(t *testing.T) {
	ctx := context.Background()
	r, _, _ := reconcilerWithARefusedStart(t)
	for _, name := range []string{"idle-peer", "idle-peer-2"} {
		setIdlePeer(t, r, name, 10*time.Second)
		annotatePeer(t, r, name, annMachineUp, time.Now().UTC().Add(-time.Hour).Format(time.RFC3339Nano))
		require.Error(t, r.setMachineError(ctx, cachedAgent(t, r, name), fmt.Errorf("one runner request failed without stopping the guest")))
		require.NoError(t, r.publishVMReadiness(ctx, cachedAgent(t, r, name), vmrunner.MachineStatus{
			State: vmrunner.StateRunning, Ready: true, MemoryMiB: 4096, UsedMiB: 700,
		}, true))
		ready := apimeta.FindStatusCondition(cachedAgent(t, r, name).Status.Conditions, apiv1.ConditionAgentPodReady)
		require.NotNil(t, ready, "precondition: the recovery moved the readiness")
		require.Less(t, time.Since(ready.LastTransitionTime.Time), 5*time.Second, "precondition: the readiness reads as new")
		require.Equal(t, refusedStartFloor, r.reclaimFloor(cachedAgent(t, r, name), time.Now(), true), "the recovery was read as a wake")
	}

	require.NoError(t, r.Reconcile(ctx, cachedAgent(t, r, "my-agent")))
	for _, name := range []string{"idle-peer", "idle-peer-2"} {
		assert.False(t, reclaimedAgent(t, r, name), "a peer used ten seconds ago was taken for a machine that had just come up")
	}
}

// TEST_SCENARIO: activity carries milliseconds, so the stamp a reclaim writes to spend it must carry them too: a reclaim inside the same second as the activity it spends would otherwise write a stamp before that activity and the victim would wake itself again.
func TestAReclaimStampSpendsSubsecondActivity(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		ctx := context.Background()
		time.Sleep(500 * time.Millisecond)
		r, _ := setupReconciler(t, vmAgentCR())
		peerVMAgent(t, r, "peer", "4Gi", "20Gi", true)
		labelPeerGateway(t, r, "peer")
		activity := time.Now().UTC().Format("2006-01-02T15:04:05.000Z")
		annotatePeer(t, r, "peer", annLastActivity, activity)
		wokeUp(t, r, "peer", time.Millisecond)
		peer := cachedAgent(t, r, "peer")
		floor := r.reclaimFloor(peer, time.Now(), true)
		require.Zero(t, floor, "precondition: a machine up inside the half minute is held to no floor")
		_, eligible := reclaimEligible(peer, time.Hour, time.Now(), floor)
		require.True(t, eligible, "precondition: its fresh activity passes the floor")

		time.Sleep(100 * time.Millisecond)
		freed, err := r.hibernateReclaimed(ctx, []reclaimCandidate{{name: "peer", vmMiB: 956, forRefusedStart: true}}, testOwner, "my-agent", "a refused start")
		require.NoError(t, err)
		require.Equal(t, 1, freed)

		peer = cachedAgent(t, r, "peer")
		assert.False(t, shouldRun(peer.Annotations, time.Hour, time.Now()),
			"the reclaim stamp fell before the activity it was meant to spend, so the victim wakes itself again")
	})
}
