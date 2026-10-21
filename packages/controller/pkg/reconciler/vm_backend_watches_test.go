// TEST_OVERVIEW: the controller watches a machine through the runner and requeues its Agent on a change, and the watch ends when the Agent stops, goes, or the reconciler does.
package reconciler

import (
	"context"
	"slices"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	corev1 "k8s.io/api/core/v1"
	"k8s.io/apimachinery/pkg/api/resource"

	"github.com/dam-agents/dam/packages/controller/pkg/vmrunner"
)

// TEST_SCENARIO: a machine on its way up is watched with a long poll on its runner, not by running the whole reconcile twice a second. However often the Agent reconciles, it has one watch; while the status holds still nothing is requeued; and the moment the status changes — the guest answering — the Agent is requeued at once, and the watch ends so the reconcile that follows can publish the change.
func TestAMachineComingUpIsWatchedAndAChangeRequeuesTheAgent(t *testing.T) {
	agent := vmAgentCR()
	r, node, requeued := setupVMReconciler(t, agent)
	ctx := context.Background()

	require.NoError(t, r.Reconcile(ctx, agent))
	require.True(t, r.watchingMachine("my-agent"))
	first := r.machineWatches["my-agent"]
	require.NoError(t, r.Reconcile(ctx, agent))
	assert.Same(t, first, r.machineWatches["my-agent"], "a second reconcile does not start a second watch")

	require.Eventually(t, func() bool { return node.waitingReads() >= 3 }, 5*time.Second, time.Millisecond,
		"the watch asks again each time a read ends with no change")
	assert.NotContains(t, requeued.all(), time.Duration(0), "an unchanged status requeues nothing")

	node.set("my-agent", vmrunner.MachineStatus{State: vmrunner.StateRunning, Port: 31000, Ready: true})
	require.Eventually(t, func() bool { return slices.Contains(requeued.all(), time.Duration(0)) }, 5*time.Second, time.Millisecond,
		"a change requeues the Agent at once")
	assert.Eventually(t, func() bool { return !r.watchingMachine("my-agent") }, 5*time.Second, time.Millisecond)
}

// TEST_SCENARIO: a watch belongs to a machine on its way up and ends with it. Hibernating the Agent once its machine has stopped, or deleting it, ends the watch without a requeue, since whatever did that reconciles the Agent itself; a machine that failed is not watched, and waits for the health poll.
func TestAMachineWatchEndsWhenTheAgentStopsOrGoes(t *testing.T) {
	agent := vmAgentCR()
	r, node, requeued := setupVMReconciler(t, agent)
	ctx := context.Background()

	require.NoError(t, r.Reconcile(ctx, agent))
	require.True(t, r.watchingMachine("my-agent"))
	require.NoError(t, r.HaltMachine(ctx, testOwner, "my-agent"))
	assert.False(t, r.watchingMachine("my-agent"), "hibernating ends the watch")
	node.set("my-agent", vmrunner.MachineStatus{State: vmrunner.StateStopped, Port: 31000})
	time.Sleep(10 * fakeNodeWait)
	assert.NotContains(t, requeued.all(), time.Duration(0), "an ended watch requeues nothing")

	node.set("my-agent", vmrunner.MachineStatus{State: vmrunner.StateStarting, Port: 31000})
	require.NoError(t, r.Reconcile(ctx, agent))
	require.True(t, r.watchingMachine("my-agent"))
	r.deleteMachine(ctx, "my-agent", testOwner)
	assert.False(t, r.watchingMachine("my-agent"), "deleting ends the watch")

	node.set("my-agent", vmrunner.MachineStatus{State: vmrunner.StateStopped, Port: 31000, Reason: vmrunner.ReasonBootFailed, Message: "kernel panic"})
	require.NoError(t, r.Reconcile(ctx, agent))
	assert.False(t, r.watchingMachine("my-agent"), "a failed machine is not on its way up")
	assert.Equal(t, vmHealthPoll, requeued.last())
}

// TEST_SCENARIO: a watch runs outside any reconcile, so it must end with the leadership that owns the queue. When the reconciler's lifetime ends — the controller shutting down, or losing the lease — the long poll is abandoned and nothing is requeued onto a queue that is being shut down.
func TestAMachineWatchEndsWithTheReconcilersLifetime(t *testing.T) {
	agent := vmAgentCR()
	r, node, requeued := setupVMReconciler(t, agent)
	lifetime, end := context.WithCancel(context.Background())
	r.WithRequeue(lifetime, requeued.add)

	require.NoError(t, r.Reconcile(context.Background(), agent))
	require.True(t, r.watchingMachine("my-agent"))
	require.Eventually(t, func() bool { return node.waitingReads() >= 1 }, 5*time.Second, time.Millisecond)
	before := len(requeued.all())

	end()
	require.Eventually(t, func() bool { return !r.watchingMachine("my-agent") }, 5*time.Second, time.Millisecond,
		"the watch ends with the lifetime")
	assert.Len(t, requeued.all(), before, "an ended lifetime requeues nothing")
}

// TEST_SCENARIO: the runner's pressure read is the controller's only view of the kernel's, and a settled agent no longer reconciles every minute to start a watch that ended. A read that fails — the runner restarting, a connection dropped — is asked again by the watch itself, before any reconcile and before the five-minute sweep, and the watch goes on asking once the runner answers.
func TestAPressureWatchAsksAgainAfterAFailedRead(t *testing.T) {
	agent := vmAgentCR()
	r, node, requeued := setupVMReconciler(t, agent)
	r.config.VM.Runner.Resources = &corev1.ResourceRequirements{Limits: corev1.ResourceList{corev1.ResourceMemory: resource.MustParse("8Gi")}}
	node.pressureAfterAFailedRead(vmrunner.RunnerPressure{Version: 1, Pressured: true, LimitMiB: 8192, WorkingSetMiB: 8000})

	require.NoError(t, r.Reconcile(context.Background(), agent))
	require.Eventually(t, func() bool { return node.pressureReadCount() >= 1 }, 5*time.Second, time.Millisecond,
		"the reconcile starts the owner's pressure watch")
	require.Eventually(t, func() bool { return node.pressureReadCount() >= 3 }, 5*time.Second, time.Millisecond,
		"the watch asks again after a failed read, and goes on asking once the runner answered")
	assert.NotContains(t, requeued.all(), time.Duration(0), "the watch reclaims by itself, without a reconcile behind it")
}
