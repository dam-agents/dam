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
		r.busyProbe = func(context.Context, string) bool { return false }
		peerVMAgent(t, r, "idle-peer", "4Gi", "20Gi", true)
		_, err := r.dynamic.Resource(AgentsGVR).Namespace("test-agents").Patch(ctx, "idle-peer", "application/merge-patch+json",
			[]byte(`{"metadata":{"annotations":{"`+annLastActivity+`":"`+time.Now().UTC().Add(-10*time.Minute).Format(time.RFC3339)+`"}}}`),
			metav1.PatchOptions{})
		require.NoError(t, err)
		r.noteMachineUse("idle-peer", measured(700))

		freed, err := r.reclaimRunnerMemory(ctx, testOwner, agent.Name, tc.need, tc.partial)
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

// TEST_SCENARIO: the host runner admits against a share of the Mac's memory, not the chart's pod limit the install still has to set, so half of that limit would be a machine it refuses. There the agent's spec still sets the machine's memory.
func TestAHostRunnerMachineTakesItsMemoryFromTheSpec(t *testing.T) {
	agent := vmAgentCR()
	r, _, _ := setupVMReconciler(t, agent)
	r.config.VM.Runner.Resources = &corev1.ResourceRequirements{Limits: corev1.ResourceList{corev1.ResourceMemory: resource.MustParse("12Gi")}}
	r.config.VM.Runner.HostAddress = "192.168.5.2"

	assert.Equal(t, 3072, r.machineMemoryMiB(context.Background(), testOwner, &agent.Spec), "the host runner's machine was sized from the chart's pod limit")
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

// TEST_SCENARIO: the runner's pressure signal is the kernel's view, which is what kills the runner, so a pass on it hibernates an idle peer even while the counted demand is well under the threshold, and even when that peer alone does not cover the measured overshoot. The signal repeats while pressure lasts, so for a while after it freed room it hibernates nothing more, and it never runs beside the owner's other pass.
func TestAPressureSignalReclaimsBelowTheCountedThresholdOnceAWhile(t *testing.T) {
	agent := vmAgentCR()
	r, node, _ := setupVMReconciler(t, agent)
	r.busyProbe = func(context.Context, string) bool { return false }
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

// TEST_SCENARIO: the machines a reclaim hibernated take seconds to stop, and the runner's working set counts them until they have, so the signal that repeats meanwhile must not hibernate more agents for room already freed.
func TestAPressureSignalRightAfterAReclaimHibernatesNothingMore(t *testing.T) {
	agent := vmAgentCR()
	r, node, _ := setupVMReconciler(t, agent)
	r.busyProbe = func(context.Context, string) bool { return false }
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
