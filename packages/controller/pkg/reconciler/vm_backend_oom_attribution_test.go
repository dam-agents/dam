// TEST_OVERVIEW: the OOM kill of a runner pod, attributed through the real reconcile path: once per kill, only to the machines that were holding memory on the killed runner, and never over a reason the runner gives for one machine alone.
package reconciler

import (
	"context"
	stderrors "errors"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	apimeta "k8s.io/apimachinery/pkg/api/meta"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime"
	dynfake "k8s.io/client-go/dynamic/fake"
	k8stesting "k8s.io/client-go/testing"

	apiv1 "github.com/dam-agents/dam/packages/controller/api/v1"
	"github.com/dam-agents/dam/packages/controller/pkg/vmrunner"
)

func reReadAgent(t *testing.T, r *AgentReconciler, name string) *apiv1.Agent {
	t.Helper()
	u, err := r.dynamic.Resource(AgentsGVR).Namespace("test-agents").Get(context.Background(), name, metav1.GetOptions{})
	require.NoError(t, err)
	agent, err := FromCacheObject[apiv1.Agent](u)
	require.NoError(t, err)
	return agent
}

// TEST_SCENARIO: the idle checker stops the agent's machine and marks it idle, which is the state a sleeping agent is found in afterwards.
func hibernate(t *testing.T, r *AgentReconciler, name string) {
	t.Helper()
	ctx := context.Background()
	u, err := r.dynamic.Resource(AgentsGVR).Namespace("test-agents").Get(ctx, name, metav1.GetOptions{})
	require.NoError(t, err)
	ann := u.GetAnnotations()
	if ann == nil {
		ann = map[string]string{}
	}
	ann[annLastActivity] = time.Now().Add(-2 * time.Hour).UTC().Format(time.RFC3339)
	u.SetAnnotations(ann)
	_, err = r.dynamic.Resource(AgentsGVR).Namespace("test-agents").Update(ctx, u, metav1.UpdateOptions{})
	require.NoError(t, err)
	down, err := hibernateAgentPair(ctx, r.client, r.dynamic, r.HaltMachine, testOwner, "test-agents", name)
	require.NoError(t, err)
	require.True(t, down)
}

// TEST_SCENARIO: the platform records activity on the agent, which is what a wake is read off, and leaves the reconcile to the caller.
func wake(t *testing.T, r *AgentReconciler, name string) {
	t.Helper()
	ctx := context.Background()
	u, err := r.dynamic.Resource(AgentsGVR).Namespace("test-agents").Get(ctx, name, metav1.GetOptions{})
	require.NoError(t, err)
	ann := u.GetAnnotations()
	if ann == nil {
		ann = map[string]string{}
	}
	ann[annLastActivity] = time.Now().UTC().Format(time.RFC3339)
	u.SetAnnotations(ann)
	_, err = r.dynamic.Resource(AgentsGVR).Namespace("test-agents").Update(ctx, u, metav1.UpdateOptions{})
	require.NoError(t, err)
}

// TEST_SCENARIO: the two stamps the controller writes as it watches a machine, for a test that needs the machine to have begun holding memory before, or to have stopped before, the clock it names. A zero time leaves that mark absent.
func machineEpisode(t *testing.T, r *AgentReconciler, name string, up, down time.Time) {
	t.Helper()
	mark := func(at time.Time) *string {
		if at.IsZero() {
			return nil
		}
		return new(at.UTC().Format(time.RFC3339Nano))
	}
	require.NoError(t, patchAgentAnnotations(context.Background(), r.dynamic, "test-agents", name, map[string]*string{
		annMachineUp:   mark(up),
		annMachineDown: mark(down),
	}))
}

func agentPodReady(t *testing.T, r *AgentReconciler, name string) *metav1.Condition {
	t.Helper()
	cond := apimeta.FindStatusCondition(reReadAgent(t, r, name).Status.Conditions, apiv1.ConditionAgentPodReady)
	require.NotNil(t, cond)
	return cond
}

// TEST_SCENARIO: an agent that was up before the kill and is refused room by the restarted runner names the kill, and a reconcile a second later writes the same episode, so the notice is published once per kill. The record of the attribution is what holds it: a kill the agent already carries is never decided again.
func TestAParkedVictimNamesTheKillOnceAndKeepsItsEpisode(t *testing.T) {
	ctx := context.Background()
	agent := vmAgentCR()
	r, node, _ := setupVMReconciler(t, agent)
	node.set(agent.Name, vmrunner.MachineStatus{State: vmrunner.StateRunning, Ready: true, Port: 31000})
	require.NoError(t, r.Reconcile(ctx, agent))
	require.Equal(t, "PodReady", agentPodReady(t, r, agent.Name).Reason)
	machineEpisode(t, r, agent.Name, time.Now().Add(-time.Hour), time.Time{})

	killed := time.Now().Add(-time.Minute).Truncate(time.Second)
	killTheRunnerForMemory(t, r, killed)
	node.set(agent.Name, vmrunner.MachineStatus{State: vmrunner.StateStopped, Reason: vmrunner.ReasonOutOfCapacity, Message: "room for one of two machines"})
	require.NoError(t, r.Reconcile(ctx, reReadAgent(t, r, agent.Name)))

	first := agentPodReady(t, r, agent.Name)
	assert.Equal(t, apiv1.ReasonRunnerOutOfMemory, first.Reason)
	assert.Equal(t, killed.UTC().Truncate(time.Second), first.LastTransitionTime.UTC(), "the episode is dated by the kill, at the second the cluster stores")

	time.Sleep(1100 * time.Millisecond)
	require.NoError(t, r.Reconcile(ctx, reReadAgent(t, r, agent.Name)))
	second := agentPodReady(t, r, agent.Name)
	assert.Equal(t, apiv1.ReasonRunnerOutOfMemory, second.Reason, "the refusal is still a consequence of the kill")
	assert.Equal(t, first.LastTransitionTime, second.LastTransitionTime, "a later reconcile cannot move the episode forward")
}

// TEST_SCENARIO: a parked victim keeps the kill across a controller restart, since both the record and the episode are persisted, and a kill whose episode is over releases the agent to its own reason.
func TestAParkedVictimKeepsTheKillAcrossAControllerRestart(t *testing.T) {
	ctx := context.Background()
	agent := vmAgentCR()
	r, node, _ := setupVMReconciler(t, agent)
	node.set(agent.Name, vmrunner.MachineStatus{State: vmrunner.StateRunning, Ready: true, Port: 31000})
	require.NoError(t, r.Reconcile(ctx, agent))
	machineEpisode(t, r, agent.Name, time.Now().Add(-time.Hour), time.Time{})

	killTheRunnerForMemory(t, r, time.Now().Add(-time.Minute).Truncate(time.Second))
	node.set(agent.Name, vmrunner.MachineStatus{State: vmrunner.StateStopped, Reason: vmrunner.ReasonOutOfCapacity, Message: "room for one of two machines"})
	require.NoError(t, r.Reconcile(ctx, reReadAgent(t, r, agent.Name)))
	require.Equal(t, apiv1.ReasonRunnerOutOfMemory, agentPodReady(t, r, agent.Name).Reason)

	r.vmRunning.Delete(agent.Name)
	require.NoError(t, r.Reconcile(ctx, reReadAgent(t, r, agent.Name)))
	assert.Equal(t, apiv1.ReasonRunnerOutOfMemory, agentPodReady(t, r, agent.Name).Reason, "a restarted controller loses no attribution")

	// TEST_SCENARIO: ten minutes after the kill the episode is over, and the refusal is what the agent reads.
	expired := time.Now().Add(-runnerOOMEpisode - time.Minute).Truncate(time.Second)
	killTheRunnerForMemory(t, r, expired)
	require.NoError(t, patchAgentAnnotations(ctx, r.dynamic, "test-agents", agent.Name, map[string]*string{
		annRunnerOOMKill: new("containerd://dead@" + expired.UTC().Format(time.RFC3339Nano)),
	}))
	spendTheMemoryGrace(t, r, reReadAgent(t, r, agent.Name))
	require.NoError(t, r.Reconcile(ctx, reReadAgent(t, r, agent.Name)))
	assert.Equal(t, apiv1.ReasonOverBudget, agentPodReady(t, r, agent.Name).Reason, "a kill past its episode explains nothing")

	// TEST_SCENARIO: the record holds, so the expired kill does not come back on the reconcile after it.
	require.NoError(t, r.Reconcile(ctx, reReadAgent(t, r, agent.Name)))
	assert.Equal(t, apiv1.ReasonOverBudget, agentPodReady(t, r, agent.Name).Reason, "an ended episode does not come back")
}

// TEST_SCENARIO: an agent the idle checker put to sleep before the kill was not on the killed runner, so the kill took nothing from it and the agent stays hibernated.
func TestAnAgentAlreadyAsleepIsNotAttributedTheKill(t *testing.T) {
	ctx := context.Background()
	agent := vmAgentCR()
	r, node, _ := setupVMReconciler(t, agent)
	node.set(agent.Name, vmrunner.MachineStatus{State: vmrunner.StateRunning, Ready: true, Port: 31000})
	require.NoError(t, r.Reconcile(ctx, agent))

	hibernate(t, r, agent.Name)
	node.set(agent.Name, vmrunner.MachineStatus{State: vmrunner.StateStopped})
	require.NoError(t, r.Reconcile(ctx, reReadAgent(t, r, agent.Name)))
	require.Equal(t, apiv1.ReasonHibernated, agentPodReady(t, r, agent.Name).Reason)

	killTheRunnerForMemory(t, r, time.Now().Add(time.Second))
	require.NoError(t, r.Reconcile(ctx, reReadAgent(t, r, agent.Name)))
	assert.Equal(t, apiv1.ReasonHibernated, agentPodReady(t, r, agent.Name).Reason, "asleep before the kill")
}

// TEST_SCENARIO: an agent whose start the runner refused before the kill held no memory when the kill landed, so its refusal is its own.
func TestAnAgentNeverOnTheRunnerKeepsItsOwnReason(t *testing.T) {
	ctx := context.Background()
	agent := vmAgentCR()
	r, node, _ := setupVMReconciler(t, agent)
	node.set(agent.Name, vmrunner.MachineStatus{State: vmrunner.StateStopped, Reason: vmrunner.ReasonOutOfCapacity, Message: "room for one of two machines"})
	spendTheMemoryGrace(t, r, agent)
	require.NoError(t, r.Reconcile(ctx, agent))
	require.Equal(t, apiv1.ReasonOverBudget, agentPodReady(t, r, agent.Name).Reason)
	machineEpisode(t, r, agent.Name, time.Time{}, time.Now().Add(-time.Hour))

	killTheRunnerForMemory(t, r, time.Now())
	require.NoError(t, r.Reconcile(ctx, reReadAgent(t, r, agent.Name)))
	assert.Equal(t, apiv1.ReasonOverBudget, agentPodReady(t, r, agent.Name).Reason, "a machine the kill never held")
}

// TEST_SCENARIO: a machine started after the kill was not on the killed runner, so a kill that landed before its first start does not explain it.
func TestAMachineStartedAfterTheKillIsNotAVictim(t *testing.T) {
	ctx := context.Background()
	agent := vmAgentCR()
	r, node, _ := setupVMReconciler(t, agent)
	killTheRunnerForMemory(t, r, time.Now().Add(-time.Minute).Truncate(time.Second))
	node.set(agent.Name, vmrunner.MachineStatus{State: vmrunner.StateStarting, Reason: vmrunner.ReasonNotReady})
	require.NoError(t, r.Reconcile(ctx, agent))
	require.NoError(t, r.Reconcile(ctx, reReadAgent(t, r, agent.Name)))
	assert.Equal(t, vmrunner.ReasonNotReady, agentPodReady(t, r, agent.Name).Reason, "the start came after the kill")
}

// TEST_SCENARIO: a machine still booting when the kill landed was holding memory on that runner, so it names the kill even though its guest never answered.
func TestAMachineBootingAtTheKillIsAVictim(t *testing.T) {
	ctx := context.Background()
	agent := vmAgentCR()
	r, node, _ := setupVMReconciler(t, agent)
	node.set(agent.Name, vmrunner.MachineStatus{State: vmrunner.StateStarting, Reason: vmrunner.ReasonNotReady})
	require.NoError(t, r.Reconcile(ctx, agent))
	require.True(t, holdsMemory(vmrunner.StateStarting))
	machineEpisode(t, r, agent.Name, time.Now().Add(-time.Hour), time.Time{})

	killTheRunnerForMemory(t, r, time.Now().Add(-2*time.Second))
	node.set(agent.Name, vmrunner.MachineStatus{State: vmrunner.StateStopped, Reason: vmrunner.ReasonOutOfCapacity})
	require.NoError(t, r.Reconcile(ctx, reReadAgent(t, r, agent.Name)))
	assert.Equal(t, apiv1.ReasonRunnerOutOfMemory, agentPodReady(t, r, agent.Name).Reason)
}

// TEST_SCENARIO: a machine that came back after the kill does not name that kill again when it loses readiness later: the kill ended for it when it answered, and the record keeps it ended.
func TestARecoveredMachineDoesNotNameTheOldKillAgain(t *testing.T) {
	ctx := context.Background()
	agent := vmAgentCR()
	r, node, _ := setupVMReconciler(t, agent)
	node.set(agent.Name, vmrunner.MachineStatus{State: vmrunner.StateRunning, Ready: true, Port: 31000})
	require.NoError(t, r.Reconcile(ctx, agent))
	machineEpisode(t, r, agent.Name, time.Now().Add(-time.Hour), time.Time{})

	killTheRunnerForMemory(t, r, time.Now().Add(-2*time.Second).Truncate(time.Second))
	node.set(agent.Name, vmrunner.MachineStatus{State: vmrunner.StateStarting, Reason: vmrunner.ReasonNotReady})
	require.NoError(t, r.Reconcile(ctx, reReadAgent(t, r, agent.Name)))
	require.Equal(t, apiv1.ReasonRunnerOutOfMemory, agentPodReady(t, r, agent.Name).Reason)

	time.Sleep(1100 * time.Millisecond)
	node.set(agent.Name, vmrunner.MachineStatus{State: vmrunner.StateRunning, Ready: true, Port: 31000})
	require.NoError(t, r.Reconcile(ctx, reReadAgent(t, r, agent.Name)))
	require.Equal(t, "PodReady", agentPodReady(t, r, agent.Name).Reason, "up again")

	time.Sleep(1100 * time.Millisecond)
	node.set(agent.Name, vmrunner.MachineStatus{State: vmrunner.StateStarting, Reason: vmrunner.ReasonNotReady})
	require.NoError(t, r.Reconcile(ctx, reReadAgent(t, r, agent.Name)))
	assert.Equal(t, vmrunner.ReasonNotReady, agentPodReady(t, r, agent.Name).Reason, "the old kill does not come back")
}

// TEST_SCENARIO: a machine the kernel killed on its own, or whose VMM made a forbidden call, is a finer answer than the pod-wide kill, so a kill of the runner pod does not replace it.
func TestAMachinesOwnDeathOutranksTheRunnersKill(t *testing.T) {
	for _, reason := range []string{vmrunner.ReasonSeccompKilled, vmrunner.ReasonOOMKilled} {
		ctx := context.Background()
		agent := vmAgentCR()
		r, node, _ := setupVMReconciler(t, agent)
		node.set(agent.Name, vmrunner.MachineStatus{State: vmrunner.StateRunning, Ready: true, Port: 31000})
		require.NoError(t, r.Reconcile(ctx, agent))

		killTheRunnerForMemory(t, r, time.Now().Truncate(time.Second))
		node.set(agent.Name, vmrunner.MachineStatus{State: vmrunner.StateStarting, Reason: reason, Message: "the machine died on its own"})
		require.NoError(t, r.Reconcile(ctx, reReadAgent(t, r, agent.Name)))
		assert.Equal(t, reason, agentPodReady(t, r, agent.Name).Reason, "the machine's own death")
	}
}

// TEST_SCENARIO: a second kill of the runner goes to the machines that were on it then, so a first victim that is asleep at the second kill keeps the first kill's episode rather than having it extended.
func TestASecondKillIsNotBlamedOnASleepingFirstVictim(t *testing.T) {
	ctx := context.Background()
	agent := vmAgentCR()
	r, node, _ := setupVMReconciler(t, agent)
	node.set(agent.Name, vmrunner.MachineStatus{State: vmrunner.StateRunning, Ready: true, Port: 31000})
	require.NoError(t, r.Reconcile(ctx, agent))
	machineEpisode(t, r, agent.Name, time.Now().Add(-time.Hour), time.Time{})

	first := time.Now().Add(-2 * time.Second).Truncate(time.Second)
	killTheRunnerForMemory(t, r, first)
	hibernate(t, r, agent.Name)
	node.set(agent.Name, vmrunner.MachineStatus{State: vmrunner.StateStopped})
	require.NoError(t, r.Reconcile(ctx, reReadAgent(t, r, agent.Name)))
	require.Equal(t, apiv1.ReasonRunnerOutOfMemory, agentPodReady(t, r, agent.Name).Reason)

	time.Sleep(1100 * time.Millisecond)
	killTheRunnerForMemory(t, r, time.Now())
	require.NoError(t, r.Reconcile(ctx, reReadAgent(t, r, agent.Name)))
	got := agentPodReady(t, r, agent.Name)
	assert.Equal(t, apiv1.ReasonRunnerOutOfMemory, got.Reason, "the first kill is still the one this agent wears")
	assert.Equal(t, first.UTC().Truncate(time.Second), got.LastTransitionTime.UTC(),
		"the asleep machine was not on the runner at the second kill")
}

// TEST_SCENARIO: a second kill of the runner opens its own episode on an agent that was running when it landed, even though the first kill's episode is over.
func TestASecondKillOpensItsOwnEpisode(t *testing.T) {
	ctx := context.Background()
	agent := vmAgentCR()
	r, node, _ := setupVMReconciler(t, agent)
	node.set(agent.Name, vmrunner.MachineStatus{State: vmrunner.StateRunning, Ready: true, Port: 31000})
	require.NoError(t, r.Reconcile(ctx, agent))

	killTheRunnerForMemory(t, r, time.Now().Add(-runnerOOMEpisode-time.Minute))
	node.set(agent.Name, vmrunner.MachineStatus{State: vmrunner.StateStopped, Reason: vmrunner.ReasonNotReady})
	require.NoError(t, r.Reconcile(ctx, reReadAgent(t, r, agent.Name)))
	require.Equal(t, vmrunner.ReasonNotReady, agentPodReady(t, r, agent.Name).Reason, "a kill past its episode explains nothing")

	// TEST_SCENARIO: the machine is up again when the second kill lands, so it is a victim of it.
	node.set(agent.Name, vmrunner.MachineStatus{State: vmrunner.StateRunning, Ready: true, Port: 31000})
	require.NoError(t, r.Reconcile(ctx, reReadAgent(t, r, agent.Name)))
	machineEpisode(t, r, agent.Name, time.Now().Add(-time.Hour), time.Time{})
	second := time.Now().Add(-2 * time.Second).Truncate(time.Second)
	killTheRunnerForMemory(t, r, second)
	node.set(agent.Name, vmrunner.MachineStatus{State: vmrunner.StateStopped, Reason: vmrunner.ReasonNotReady})
	require.NoError(t, r.Reconcile(ctx, reReadAgent(t, r, agent.Name)))
	got := agentPodReady(t, r, agent.Name)
	assert.Equal(t, apiv1.ReasonRunnerOutOfMemory, got.Reason, "the newer kill")
	assert.Equal(t, second.UTC().Truncate(time.Second), got.LastTransitionTime.UTC(), "dated by the newer kill")
}

// TEST_SCENARIO: the reason a kill published comes off the agent once the kill is past its episode, including for an agent a reclaim put to sleep after the kill, which nothing else reconciles: the attribute asks to be looked at when the episode ends.
func TestASleepingVictimIsAskedForAtTheEndOfTheEpisode(t *testing.T) {
	ctx := context.Background()
	agent := vmAgentCR()
	r, node, requeued := setupVMReconciler(t, agent)
	node.set(agent.Name, vmrunner.MachineStatus{State: vmrunner.StateRunning, Ready: true, Port: 31000})
	require.NoError(t, r.Reconcile(ctx, agent))
	machineEpisode(t, r, agent.Name, time.Now().Add(-time.Hour), time.Time{})

	killTheRunnerForMemory(t, r, time.Now().Add(-2*time.Second))
	hibernate(t, r, agent.Name)
	node.set(agent.Name, vmrunner.MachineStatus{State: vmrunner.StateStopped})
	before := len(requeued.all())
	require.NoError(t, r.Reconcile(ctx, reReadAgent(t, r, agent.Name)))
	require.Equal(t, apiv1.ReasonRunnerOutOfMemory, agentPodReady(t, r, agent.Name).Reason, "put to sleep after the kill")

	var wait time.Duration
	for _, d := range requeued.all()[before:] {
		if d <= runnerOOMEpisode && d > runnerOOMEpisode/2 {
			wait = d
		}
	}
	assert.NotZero(t, wait, "the sleeping victim is asked for as its episode ends: %v", requeued.all()[before:])
}

// TEST_SCENARIO: the machine an agent boots after a wake is a new episode, so a kill it slept through is not named on it: only a start after the kill counts.
func TestAWokenMachineIsNotBlamedForTheKillItSleptThrough(t *testing.T) {
	ctx := context.Background()
	agent := vmAgentCR()
	r, node, _ := setupVMReconciler(t, agent)
	node.set(agent.Name, vmrunner.MachineStatus{State: vmrunner.StateRunning, Ready: true, Port: 31000})
	require.NoError(t, r.Reconcile(ctx, agent))

	hibernate(t, r, agent.Name)
	node.set(agent.Name, vmrunner.MachineStatus{State: vmrunner.StateStopped})
	require.NoError(t, r.Reconcile(ctx, reReadAgent(t, r, agent.Name)))
	require.Equal(t, apiv1.ReasonHibernated, agentPodReady(t, r, agent.Name).Reason)
	// TEST_SCENARIO: the machine's first start was an hour ago and it has been asleep for ten seconds, which is what the marks say of a machine that slept and whose first start is its only one.
	machineEpisode(t, r, agent.Name, time.Now().Add(-time.Hour), time.Now().Add(-10*time.Second))

	// TEST_SCENARIO: the runner is killed while the machine is asleep, and the wake boots a machine on the restarted runner.
	killTheRunnerForMemory(t, r, time.Now().Add(-2*time.Second).Truncate(time.Second))
	wake(t, r, agent.Name)
	node.set(agent.Name, vmrunner.MachineStatus{State: vmrunner.StateStarting, Reason: vmrunner.ReasonNotReady})
	require.NoError(t, r.Reconcile(ctx, reReadAgent(t, r, agent.Name)))
	assert.Equal(t, vmrunner.ReasonNotReady, agentPodReady(t, r, agent.Name).Reason, "the machine was asleep at the kill")
}

// TEST_SCENARIO: the stop a hibernation asks for is stamped where the runner answers it stopped, so a kill that lands before the agent's next check does not name an agent that was already asleep.
func TestAMachinePutToSleepIsStampedWhereItStopped(t *testing.T) {
	ctx := context.Background()
	agent := vmAgentCR()
	r, node, _ := setupVMReconciler(t, agent)
	node.set(agent.Name, vmrunner.MachineStatus{State: vmrunner.StateRunning, Ready: true, Port: 31000})
	require.NoError(t, r.Reconcile(ctx, agent))
	machineEpisode(t, r, agent.Name, time.Now().Add(-time.Hour), time.Time{})

	hibernate(t, r, agent.Name)
	killTheRunnerForMemory(t, r, time.Now().Truncate(time.Second))
	// TEST_SCENARIO: the agent's next check comes a second later, and it is the check that would write the stop if the halt had not.
	time.Sleep(1100 * time.Millisecond)
	node.set(agent.Name, vmrunner.MachineStatus{State: vmrunner.StateStopped})
	require.NoError(t, r.Reconcile(ctx, reReadAgent(t, r, agent.Name)))
	assert.Equal(t, apiv1.ReasonHibernated, agentPodReady(t, r, agent.Name).Reason, "asleep at the kill")
}

// TEST_SCENARIO: an agent that carries no start stamp and is older than the kill counts as one that was there, since the marks say nothing because the record is incomplete rather than the machine absent.
func TestAnAgentWithNoStampsIsAVictimOfTheKill(t *testing.T) {
	ctx := context.Background()
	agent := vmAgentCR()
	agent.CreationTimestamp = metav1.NewTime(time.Now().Add(-time.Hour))
	r, node, _ := setupVMReconciler(t, agent)
	killTheRunnerForMemory(t, r, time.Now().Add(-2*time.Second).Truncate(time.Second))
	node.set(agent.Name, vmrunner.MachineStatus{State: vmrunner.StateStopped, Reason: vmrunner.ReasonOutOfCapacity, Message: "room for one of two machines"})
	require.NoError(t, r.Reconcile(ctx, reReadAgent(t, r, agent.Name)))
	assert.Equal(t, apiv1.ReasonRunnerOutOfMemory, agentPodReady(t, r, agent.Name).Reason)
}

// TEST_SCENARIO: a kill that is past its ten minutes when the platform first reads it explains nothing, so the agent keeps its own reason and the kill is not named on it.
func TestAKillPastItsEpisodeWhenFirstReadIsNotNamed(t *testing.T) {
	ctx := context.Background()
	agent := vmAgentCR()
	r, node, _ := setupVMReconciler(t, agent)
	machineEpisode(t, r, agent.Name, time.Now().Add(-2*time.Hour), time.Time{})
	killTheRunnerForMemory(t, r, time.Now().Add(-runnerOOMEpisode-time.Minute).Truncate(time.Second))
	node.set(agent.Name, vmrunner.MachineStatus{State: vmrunner.StateStopped, Reason: vmrunner.ReasonNotReady})
	require.NoError(t, r.Reconcile(ctx, reReadAgent(t, r, agent.Name)))
	assert.Equal(t, vmrunner.ReasonNotReady, agentPodReady(t, r, agent.Name).Reason)
}

// TEST_SCENARIO: the runner's record of its kills only moves forward, so an older kill reaching an agent that shows a newer one does not take its place: the episode stays the newer kill's.
func TestAnOlderKillDoesNotReplaceANewerOne(t *testing.T) {
	ctx := context.Background()
	agent := vmAgentCR()
	r, node, _ := setupVMReconciler(t, agent)
	machineEpisode(t, r, agent.Name, time.Now().Add(-2*time.Hour), time.Time{})
	node.set(agent.Name, vmrunner.MachineStatus{State: vmrunner.StateStarting, Reason: vmrunner.ReasonNotReady})
	newer := time.Now().Add(-time.Minute).Truncate(time.Second)
	killTheRunnerForMemory(t, r, newer)
	require.NoError(t, r.Reconcile(ctx, reReadAgent(t, r, agent.Name)))
	require.Equal(t, newer.UTC(), agentPodReady(t, r, agent.Name).LastTransitionTime.UTC())

	killTheRunnerForMemory(t, r, newer.Add(-time.Minute))
	require.NoError(t, r.Reconcile(ctx, reReadAgent(t, r, agent.Name)))
	assert.Equal(t, newer.UTC(), agentPodReady(t, r, agent.Name).LastTransitionTime.UTC(), "an older kill does not take a newer one's place")
}

// TEST_SCENARIO: the platform first reads a kill when the machine has already answered ready again, and that answer is what ends the kill for the agent: the kill it recovered from does not come back on the next ordinary failure.
func TestAKillTheAgentRecoveredFromBeforeItWasReadDoesNotComeBack(t *testing.T) {
	ctx := context.Background()
	agent := vmAgentCR()
	r, node, _ := setupVMReconciler(t, agent)
	machineEpisode(t, r, agent.Name, time.Now().Add(-2*time.Hour), time.Time{})
	node.set(agent.Name, vmrunner.MachineStatus{State: vmrunner.StateRunning, Ready: true, Port: 31000})
	killTheRunnerForMemory(t, r, time.Now().Add(-2*time.Minute).Truncate(time.Second))
	require.NoError(t, r.Reconcile(ctx, reReadAgent(t, r, agent.Name)))
	require.Equal(t, "PodReady", agentPodReady(t, r, agent.Name).Reason)

	node.set(agent.Name, vmrunner.MachineStatus{State: vmrunner.StateStarting, Reason: vmrunner.ReasonNotReady})
	require.NoError(t, r.Reconcile(ctx, reReadAgent(t, r, agent.Name)))
	assert.Equal(t, vmrunner.ReasonNotReady, agentPodReady(t, r, agent.Name).Reason, "the kill it recovered from")
}

// TEST_SCENARIO: the end of a kill is the kill its own machine answered ready after, not a time the controller wrote, so a controller clock a few seconds behind the node's cannot read a recovered kill as one still running.
func TestARecoveredKillIsNotRevivedByAClockBehindTheNodes(t *testing.T) {
	ctx := context.Background()
	agent := vmAgentCR()
	r, node, _ := setupVMReconciler(t, agent)
	machineEpisode(t, r, agent.Name, time.Now().Add(-2*time.Hour), time.Time{})
	node.set(agent.Name, vmrunner.MachineStatus{State: vmrunner.StateStarting, Reason: vmrunner.ReasonNotReady})
	killTheRunnerForMemory(t, r, time.Now().Add(5*time.Second).Truncate(time.Second))
	require.NoError(t, r.Reconcile(ctx, reReadAgent(t, r, agent.Name)))
	require.Equal(t, apiv1.ReasonRunnerOutOfMemory, agentPodReady(t, r, agent.Name).Reason)

	node.set(agent.Name, vmrunner.MachineStatus{State: vmrunner.StateRunning, Ready: true, Port: 31000})
	require.NoError(t, r.Reconcile(ctx, reReadAgent(t, r, agent.Name)))
	require.Equal(t, "PodReady", agentPodReady(t, r, agent.Name).Reason, "up again")

	node.set(agent.Name, vmrunner.MachineStatus{State: vmrunner.StateStarting, Reason: vmrunner.ReasonNotReady})
	require.NoError(t, r.Reconcile(ctx, reReadAgent(t, r, agent.Name)))
	assert.Equal(t, vmrunner.ReasonNotReady, agentPodReady(t, r, agent.Name).Reason, "the kill ended when the machine answered")
}

// TEST_SCENARIO: a status write that fails decides nothing, so the kill is not recorded as handled and the retry named it: an agent whose status cannot be written keeps the notice instead of losing it.
func TestAFailedStatusWriteLeavesTheKillUndecided(t *testing.T) {
	ctx := context.Background()
	agent := vmAgentCR()
	r, node, _ := setupVMReconciler(t, agent)
	node.set(agent.Name, vmrunner.MachineStatus{State: vmrunner.StateRunning, Ready: true, Port: 31000})
	require.NoError(t, r.Reconcile(ctx, agent))
	machineEpisode(t, r, agent.Name, time.Now().Add(-2*time.Hour), time.Time{})

	failing := true
	r.dynamic.(*dynfake.FakeDynamicClient).PrependReactor("update", "agents", func(a k8stesting.Action) (bool, runtime.Object, error) {
		if failing && a.GetSubresource() == "status" {
			return true, nil, stderrors.New("the status write failed")
		}
		return false, nil, nil
	})
	killTheRunnerForMemory(t, r, time.Now().Truncate(time.Second))
	node.set(agent.Name, vmrunner.MachineStatus{State: vmrunner.StateStarting, Reason: vmrunner.ReasonNotReady})
	err := r.Reconcile(ctx, reReadAgent(t, r, agent.Name))
	require.ErrorContains(t, err, "the status write failed")
	assert.Empty(t, reReadAgent(t, r, agent.Name).Annotations[annRunnerOOMKill], "a status write that failed records nothing")

	failing = false
	require.NoError(t, r.Reconcile(ctx, reReadAgent(t, r, agent.Name)))
	assert.Equal(t, apiv1.ReasonRunnerOutOfMemory, agentPodReady(t, r, agent.Name).Reason, "the retry names the kill")
}

// TEST_SCENARIO: a machine that dies of its own reason after a kill has said what became of it, so the kill does not come back over that machine's next ordinary failure.
func TestAMachinesOwnDeathEndsTheKill(t *testing.T) {
	ctx := context.Background()
	agent := vmAgentCR()
	r, node, _ := setupVMReconciler(t, agent)
	machineEpisode(t, r, agent.Name, time.Now().Add(-2*time.Hour), time.Time{})
	node.set(agent.Name, vmrunner.MachineStatus{State: vmrunner.StateStarting, Reason: vmrunner.ReasonNotReady})
	killTheRunnerForMemory(t, r, time.Now().Add(-time.Minute).Truncate(time.Second))
	require.NoError(t, r.Reconcile(ctx, reReadAgent(t, r, agent.Name)))
	require.Equal(t, apiv1.ReasonRunnerOutOfMemory, agentPodReady(t, r, agent.Name).Reason)

	node.set(agent.Name, vmrunner.MachineStatus{State: vmrunner.StateStarting, Reason: vmrunner.ReasonSeccompKilled, Message: "the machine died on its own"})
	require.NoError(t, r.Reconcile(ctx, reReadAgent(t, r, agent.Name)))
	require.Equal(t, vmrunner.ReasonSeccompKilled, agentPodReady(t, r, agent.Name).Reason)

	node.set(agent.Name, vmrunner.MachineStatus{State: vmrunner.StateStarting, Reason: vmrunner.ReasonNotReady})
	require.NoError(t, r.Reconcile(ctx, reReadAgent(t, r, agent.Name)))
	assert.Equal(t, vmrunner.ReasonNotReady, agentPodReady(t, r, agent.Name).Reason, "the kill ended where the machine's own death took its place")
}

// TEST_SCENARIO: an agent created after the kill had no machine on that runner when it landed, and it carries no stamps yet, so it is no victim: the stamps say nothing because the agent did not exist, not because the record is missing.
func TestAnAgentCreatedAfterTheKillIsNotAVictim(t *testing.T) {
	ctx := context.Background()
	agent := vmAgentCR()
	agent.CreationTimestamp = metav1.NewTime(time.Now())
	r, node, _ := setupVMReconciler(t, agent)
	killTheRunnerForMemory(t, r, time.Now().Add(-time.Minute).Truncate(time.Second))
	node.set(agent.Name, vmrunner.MachineStatus{State: vmrunner.StateStopped, Reason: vmrunner.ReasonOutOfCapacity, Message: "room for one of two machines"})
	spendTheMemoryGrace(t, r, agent)
	require.NoError(t, r.Reconcile(ctx, reReadAgent(t, r, agent.Name)))
	assert.Equal(t, apiv1.ReasonOverBudget, agentPodReady(t, r, agent.Name).Reason, "an agent created after the kill")
}

// TEST_SCENARIO: a reason the controller gives about the runner — its node lost, its pod unschedulable — is no account of this machine, so it does not end the kill for it: the machine's next ordinary failure still names the kill.
func TestAReasonAboutTheRunnerDoesNotEndTheKill(t *testing.T) {
	ctx := context.Background()
	agent := vmAgentCR()
	r, node, _ := setupVMReconciler(t, agent)
	machineEpisode(t, r, agent.Name, time.Now().Add(-2*time.Hour), time.Time{})
	node.set(agent.Name, vmrunner.MachineStatus{State: vmrunner.StateStarting, Reason: vmrunner.ReasonNotReady})
	killTheRunnerForMemory(t, r, time.Now().Add(-time.Minute).Truncate(time.Second))
	require.NoError(t, r.Reconcile(ctx, reReadAgent(t, r, agent.Name)))
	require.Equal(t, apiv1.ReasonRunnerOutOfMemory, agentPodReady(t, r, agent.Name).Reason)

	// TEST_SCENARIO: the runner drops out of reach and its reason lands on the agent, without the machine being asked anything.
	require.NoError(t, r.publishVMReadiness(ctx, reReadAgent(t, r, agent.Name), vmrunner.MachineStatus{
		Reason: apiv1.ReasonMachineRunnerUnschedulable, Message: "the owner's VM runner cannot be scheduled",
	}, false))

	node.set(agent.Name, vmrunner.MachineStatus{State: vmrunner.StateStarting, Reason: vmrunner.ReasonNotReady})
	require.NoError(t, r.Reconcile(ctx, reReadAgent(t, r, agent.Name)))
	assert.Equal(t, apiv1.ReasonRunnerOutOfMemory, agentPodReady(t, r, agent.Name).Reason, "the kill is still this agent's")
}
