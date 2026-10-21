// TEST_OVERVIEW: the OOM kill of a runner pod, attributed through the real reconcile path: once per kill, only to the agents whose machine was running when it landed, and never over a reason the runner gives for one machine alone.
package reconciler

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	apimeta "k8s.io/apimachinery/pkg/api/meta"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"

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
	u.SetAnnotations(map[string]string{annLastActivity: time.Now().Add(-2 * time.Hour).UTC().Format(time.RFC3339)})
	_, err = r.dynamic.Resource(AgentsGVR).Namespace("test-agents").Update(ctx, u, metav1.UpdateOptions{})
	require.NoError(t, err)
	require.NoError(t, hibernateAgentPair(ctx, r.client, r.dynamic, r.HaltMachine, testOwner, "test-agents", name))
}

func agentPodReady(t *testing.T, r *AgentReconciler, name string) *metav1.Condition {
	t.Helper()
	cond := apimeta.FindStatusCondition(reReadAgent(t, r, name).Status.Conditions, apiv1.ConditionAgentPodReady)
	require.NotNil(t, cond)
	return cond
}

// TEST_SCENARIO: an agent that was up before the kill and is refused room by the restarted runner names the kill, and a reconcile a second later writes the same episode, so the notice is published once per kill: the kill's own finished time dates the condition, and the identical value is dropped as unchanged.
func TestAParkedVictimNamesTheKillOnceAndKeepsItsEpisode(t *testing.T) {
	ctx := context.Background()
	agent := vmAgentCR()
	r, node, _ := setupVMReconciler(t, agent)
	node.statuses[agent.Name] = vmrunner.MachineStatus{State: vmrunner.StateRunning, Ready: true, Port: 31000}
	require.NoError(t, r.Reconcile(ctx, agent))
	require.Equal(t, "PodReady", agentPodReady(t, r, agent.Name).Reason)

	killed := time.Now()
	killTheRunnerForMemory(t, r, killed)
	node.statuses[agent.Name] = vmrunner.MachineStatus{State: vmrunner.StateStopped, Reason: vmrunner.ReasonOutOfCapacity, Message: "room for one of two machines"}
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

// TEST_SCENARIO: a parked victim keeps the kill across a controller restart: a restarted controller knows no desired-running state, so the persisted condition is the only membership evidence there is, and a kill whose episode is over releases the agent to its own reason.
func TestAParkedVictimKeepsTheKillAcrossAControllerRestart(t *testing.T) {
	ctx := context.Background()
	agent := vmAgentCR()
	r, node, _ := setupVMReconciler(t, agent)
	node.statuses[agent.Name] = vmrunner.MachineStatus{State: vmrunner.StateRunning, Ready: true, Port: 31000}
	require.NoError(t, r.Reconcile(ctx, agent))

	killed := time.Now()
	killTheRunnerForMemory(t, r, killed)
	node.statuses[agent.Name] = vmrunner.MachineStatus{State: vmrunner.StateStopped, Reason: vmrunner.ReasonOutOfCapacity, Message: "room for one of two machines"}
	require.NoError(t, r.Reconcile(ctx, reReadAgent(t, r, agent.Name)))
	require.Equal(t, apiv1.ReasonRunnerOutOfMemory, agentPodReady(t, r, agent.Name).Reason)

	r.vmRunning.Delete(agent.Name)
	require.NoError(t, r.Reconcile(ctx, reReadAgent(t, r, agent.Name)))
	assert.Equal(t, apiv1.ReasonRunnerOutOfMemory, agentPodReady(t, r, agent.Name).Reason, "a restarted controller loses no attribution")

	// TEST_SCENARIO: the same parked agent, still refused room, ten minutes after the kill: the episode is over and the refusal is what it reads.
	killTheRunnerForMemory(t, r, time.Now().Add(-runnerOOMEpisode-time.Minute))
	require.NoError(t, updateAgentStatus(ctx, r.dynamic, "test-agents", agent.Name, func(s *apiv1.AgentStatus) {
		setConditionTime(s, apiv1.ConditionAgentPodReady, time.Now().Add(-runnerOOMEpisode-time.Minute))
	}))
	require.NoError(t, r.Reconcile(ctx, reReadAgent(t, r, agent.Name)))
	assert.Equal(t, apiv1.ReasonOverBudget, agentPodReady(t, r, agent.Name).Reason, "a kill past its episode explains nothing")
}

// TEST_SCENARIO: an agent the idle checker put to sleep before the kill was not running when it landed, so the kill took nothing from it and the agent stays hibernated.
func TestAnAgentAlreadyAsleepIsNotAttributedTheKill(t *testing.T) {
	ctx := context.Background()
	agent := vmAgentCR()
	r, node, _ := setupVMReconciler(t, agent)
	node.statuses[agent.Name] = vmrunner.MachineStatus{State: vmrunner.StateRunning, Ready: true, Port: 31000}
	require.NoError(t, r.Reconcile(ctx, agent))

	hibernate(t, r, agent.Name)
	node.statuses[agent.Name] = vmrunner.MachineStatus{State: vmrunner.StateStopped}
	require.NoError(t, r.Reconcile(ctx, reReadAgent(t, r, agent.Name)))
	require.Equal(t, apiv1.ReasonHibernated, agentPodReady(t, r, agent.Name).Reason)

	killTheRunnerForMemory(t, r, time.Now())
	require.NoError(t, r.Reconcile(ctx, reReadAgent(t, r, agent.Name)))
	assert.Equal(t, apiv1.ReasonHibernated, agentPodReady(t, r, agent.Name).Reason, "asleep before the kill")
}

// TEST_SCENARIO: an agent whose start the runner refused before the kill held no memory when the kill landed, so its refusal is its own.
func TestAnAgentRefusedBeforeTheKillKeepsItsRefusal(t *testing.T) {
	ctx := context.Background()
	agent := vmAgentCR()
	r, node, _ := setupVMReconciler(t, agent)
	node.statuses[agent.Name] = vmrunner.MachineStatus{State: vmrunner.StateStopped, Reason: vmrunner.ReasonOutOfCapacity, Message: "room for one of two machines"}
	require.NoError(t, r.Reconcile(ctx, agent))
	require.Equal(t, apiv1.ReasonOverBudget, agentPodReady(t, r, agent.Name).Reason)

	killTheRunnerForMemory(t, r, time.Now())
	require.NoError(t, r.Reconcile(ctx, reReadAgent(t, r, agent.Name)))
	assert.Equal(t, apiv1.ReasonOverBudget, agentPodReady(t, r, agent.Name).Reason, "refused before the kill, which took nothing from it")
}

// TEST_SCENARIO: a machine the kernel killed on its own, or whose VMM made a forbidden call, is a finer answer than the pod-wide kill, so a kill of the runner pod does not replace it.
func TestAMachinesOwnDeathOutranksTheRunnersKill(t *testing.T) {
	for _, reason := range []string{vmrunner.ReasonSeccompKilled, vmrunner.ReasonOOMKilled} {
		ctx := context.Background()
		agent := vmAgentCR()
		r, node, _ := setupVMReconciler(t, agent)
		node.statuses[agent.Name] = vmrunner.MachineStatus{State: vmrunner.StateRunning, Ready: true, Port: 31000}
		require.NoError(t, r.Reconcile(ctx, agent))

		killTheRunnerForMemory(t, r, time.Now())
		node.statuses[agent.Name] = vmrunner.MachineStatus{State: vmrunner.StateStarting, Reason: reason, Message: "the machine died on its own"}
		require.NoError(t, r.Reconcile(ctx, reReadAgent(t, r, agent.Name)))
		assert.Equal(t, reason, agentPodReady(t, r, agent.Name).Reason, "the machine's own death")
	}
}

// TEST_SCENARIO: a second kill of the runner, after the first episode has run out, opens its own episode on an agent the first had released, so the reason comes back for the newer kill.
func TestASecondKillOpensItsOwnEpisode(t *testing.T) {
	ctx := context.Background()
	agent := vmAgentCR()
	r, node, _ := setupVMReconciler(t, agent)
	node.statuses[agent.Name] = vmrunner.MachineStatus{State: vmrunner.StateRunning, Ready: true, Port: 31000}
	require.NoError(t, r.Reconcile(ctx, agent))

	killTheRunnerForMemory(t, r, time.Now().Add(-runnerOOMEpisode-time.Minute))
	node.statuses[agent.Name] = vmrunner.MachineStatus{State: vmrunner.StateStopped, Reason: vmrunner.ReasonNotReady}
	require.NoError(t, r.Reconcile(ctx, reReadAgent(t, r, agent.Name)))
	require.Equal(t, vmrunner.ReasonNotReady, agentPodReady(t, r, agent.Name).Reason, "a kill past its episode explains nothing")

	// TEST_SCENARIO: the machine never came back, and a second kill lands while the agent still names nothing: the agent is not up at that kill, so a kill it cannot be shown to have been running at explains nothing.
	killTheRunnerForMemory(t, r, time.Now())
	require.NoError(t, r.Reconcile(ctx, reReadAgent(t, r, agent.Name)))
	assert.Equal(t, vmrunner.ReasonNotReady, agentPodReady(t, r, agent.Name).Reason, "a machine already down at the newer kill")
}

// TEST_SCENARIO: the reason a kill published comes off the agent once the kill is past its episode, including for an agent a reclaim put to sleep after the kill, which nothing else reconciles.
func TestAHibernatedVictimReleasesTheKillWhenTheEpisodeEnds(t *testing.T) {
	ctx := context.Background()
	agent := vmAgentCR()
	r, node, _ := setupVMReconciler(t, agent)
	node.statuses[agent.Name] = vmrunner.MachineStatus{State: vmrunner.StateRunning, Ready: true, Port: 31000}
	require.NoError(t, r.Reconcile(ctx, agent))

	// TEST_SCENARIO: the kill lands first, and the machine is reclaimed after it, so the hibernation is published after the kill and is a consequence of it.
	killTheRunnerForMemory(t, r, time.Now().Add(-time.Minute))
	hibernate(t, r, agent.Name)
	node.statuses[agent.Name] = vmrunner.MachineStatus{State: vmrunner.StateStopped}
	require.NoError(t, r.Reconcile(ctx, reReadAgent(t, r, agent.Name)))
	require.Equal(t, apiv1.ReasonRunnerOutOfMemory, agentPodReady(t, r, agent.Name).Reason, "put to sleep after the kill, which is what took its machine down")

	// TEST_SCENARIO: ten minutes on, the kill is past its episode and the agent is asleep: the hibernation comes back on its own, which is the only reason left.
	killTheRunnerForMemory(t, r, time.Now().Add(-runnerOOMEpisode-time.Minute))
	require.NoError(t, updateAgentStatus(ctx, r.dynamic, "test-agents", agent.Name, func(s *apiv1.AgentStatus) {
		setConditionTime(s, apiv1.ConditionAgentPodReady, time.Now().Add(-runnerOOMEpisode-time.Minute))
	}))
	require.NoError(t, r.Reconcile(ctx, reReadAgent(t, r, agent.Name)))
	assert.Equal(t, apiv1.ReasonHibernated, agentPodReady(t, r, agent.Name).Reason)
}
