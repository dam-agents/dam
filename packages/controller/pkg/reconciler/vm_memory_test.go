// TEST_OVERVIEW: an owner's runner memory is counted by what the machines measurably use: a measured machine counts at its use plus headroom, never above its size, and room the runner lacks is freed by hibernating the owner's idle vm agents only when they cover all of it.
package reconciler

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"

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
		hibernated bool
	}{
		{need: 2000, hibernated: false},
		{need: 800, hibernated: true},
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

		freed, err := r.reclaimRunnerMemory(ctx, testOwner, agent.Name, tc.need)
		require.NoError(t, err)
		assert.Equal(t, tc.hibernated, freed, "need %d MiB against a peer counted at 956 MiB", tc.need)
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
