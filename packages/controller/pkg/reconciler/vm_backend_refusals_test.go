// TEST_OVERVIEW: a refusal from the runner parks the Agent with the reason the user reads, releases the budget the start held, and never hibernates a machine that is up.
package reconciler

import (
	"context"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	corev1 "k8s.io/api/core/v1"
	apimeta "k8s.io/apimachinery/pkg/api/meta"
	"k8s.io/apimachinery/pkg/api/resource"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"

	apiv1 "github.com/dam-agents/dam/packages/controller/api/v1"
	"github.com/dam-agents/dam/packages/controller/pkg/vmrunner"
)

// TEST_SCENARIO: the runner refuses a machine for want of memory; the agent parks instead of spinning — the gateway scales to zero so the owner stops being charged for an agent that does not exist, and the status says in the owner's terms that their VM agents' memory is full and what frees it, not the runner's own accounting.
func TestARefusedMachineParksAndReleasesTheOwnersBudget(t *testing.T) {
	ctx := context.Background()
	agent := vmAgentCR()
	r, node, _ := setupVMReconciler(t, agent)
	r.config.VM.Runner.Resources = &corev1.ResourceRequirements{
		Limits: corev1.ResourceList{corev1.ResourceMemory: resource.MustParse("8Gi")},
	}
	node.statuses["my-agent"] = vmrunner.MachineStatus{
		State:   vmrunner.StateCreating,
		Reason:  vmrunner.ReasonOutOfCapacity,
		Message: "this machine's 1024 MiB does not fit",
	}

	require.NoError(t, r.Reconcile(ctx, agent))

	assert.Equal(t, int32(0), agentSSReplicas(t, r, GatewayName("my-agent")),
		"the gateway is scaled down, so the owner is not charged for a machine that was refused")
	cond := readyCondition(t, r, "my-agent")
	require.NotNil(t, cond)
	assert.Equal(t, metav1.ConditionFalse, cond.Status)
	assert.Regexp(t, `^Your VM agents are using [0-9.]+ of 8\.0 GiB of memory, and starting this agent needs about [1-9][0-9.]* GiB more`, cond.Message, "the user reads the pool out of the total Home shows, and the room the start itself needs")
	assert.Contains(t, cond.Message, "disable an agent you aren't using", "the user reads what frees it")
	assert.NotContains(t, cond.Message, "MiB", "the runner's accounting stays out of the user's copy")
}

// TEST_SCENARIO: a start the node has not yet granted the memory for is refused under MachineAwaitingAllocation, which is not the owner's memory being full: the controller asks the node for that memory with an in-place resize in the same reconcile, so the Agent is retried at the machine watch's 3 s cadence rather than at the parked tick, no idle agent is hibernated for room the node is already being asked for, and the person reads that their agent is waiting for the node rather than that their memory is gone.
func TestAStartWaitingForTheNodesMemoryIsRetriedAtOnceAndHibernatesNothing(t *testing.T) {
	ctx := context.Background()
	for _, tc := range []struct {
		reason    string
		published string
		reclaimed bool
		message   string
	}{
		{reason: vmrunner.ReasonAwaitingAllocation, published: apiv1.ReasonAwaitingAllocation, message: "waiting for the node"},
		{reason: vmrunner.ReasonOutOfCapacity, published: apiv1.ReasonOverBudget, reclaimed: true, message: "can't start yet"},
	} {
		agent := vmAgentCR()
		r, node, requeued := setupVMReconciler(t, agent)
		r.config.VM.Runner.Resources = &corev1.ResourceRequirements{
			Limits: corev1.ResourceList{corev1.ResourceMemory: resource.MustParse("2Gi")},
		}
		r.podStatus = func(context.Context, string) (bool, bool) { return true, true }
		for _, peer := range []string{"idle-peer", "other-peer"} {
			peerVMAgent(t, r, peer, "4Gi", "20Gi", true)
			_, err := r.dynamic.Resource(AgentsGVR).Namespace("test-agents").Patch(ctx, peer, "application/merge-patch+json",
				[]byte(`{"metadata":{"annotations":{"`+annLastActivity+`":"`+time.Now().UTC().Add(-10*time.Minute).Format(time.RFC3339)+`"}}}`),
				metav1.PatchOptions{})
			require.NoError(t, err)
			r.noteMachineUse(peer, measured(700))
		}
		// TEST_SCENARIO: a refused start holds nothing, which is what the runner reports for the machine it did not start.
		node.statuses["my-agent"] = vmrunner.MachineStatus{State: vmrunner.StateStopped, Reason: tc.reason}

		require.NoError(t, r.Reconcile(ctx, agent))

		assert.Equal(t, int32(0), agentSSReplicas(t, r, GatewayName("my-agent")),
			"the gateway is scaled down while the machine waits")
		cond := readyCondition(t, r, "my-agent")
		require.NotNil(t, cond)
		assert.Contains(t, cond.Message, tc.message)
		assert.Equal(t, tc.published, cond.Reason,
			"%s: a start waiting for the node is not the owner's budget being spent", tc.reason)
		published, err := r.dynamic.Resource(AgentsGVR).Namespace("test-agents").Get(ctx, "my-agent", metav1.GetOptions{})
		require.NoError(t, err)
		live, err := FromCacheObject[apiv1.Agent](published)
		require.NoError(t, err)
		agentPod := apimeta.FindStatusCondition(live.Status.Conditions, apiv1.ConditionAgentPodReady)
		require.NotNil(t, agentPod)
		assert.Equal(t, tc.published, agentPod.Reason)
		hibernated := 0
		for _, peer := range []string{"idle-peer", "other-peer"} {
			u, err := r.dynamic.Resource(AgentsGVR).Namespace("test-agents").Get(ctx, peer, metav1.GetOptions{})
			require.NoError(t, err)
			if u.GetAnnotations()[annReclaimedAt] != "" {
				hibernated++
			}
		}
		assert.Equal(t, tc.reclaimed, hibernated > 0,
			"%s: an idle agent is hibernated only when the owner's own memory is what the start lacks", tc.reason)
		if !tc.reclaimed {
			assert.Equal(t, vmReadinessPoll, requeued.last(), "retried at the machine watch's cadence, not at the parked tick")
			assert.NotContains(t, cond.Message, "disable an agent", "nothing the owner disables frees memory the node has not granted")
		}
	}
}

// TEST_SCENARIO: the node that keeps a runner at its old size is one no wait ends on: it has deferred the resize, so the room the pod was given is all the owner will get until their machines stop. The start frees that room from the owner's own idle agents, as a start the pool refused does, and the parked retry is the backstop under the machine watch's cadence. The room to free is what the node holds for the runner, not the pool: the pool has room, or the runner would have refused the start for it instead.
func TestAStartWaitingOnADeferredResizeFreesWhatTheNodeDidGrant(t *testing.T) {
	ctx := context.Background()
	agent := vmAgentCR()
	r, node, requeued := setupVMReconciler(t, agent)
	r.config.VM.Runner.Resources = &corev1.ResourceRequirements{
		Limits: corev1.ResourceList{corev1.ResourceMemory: resource.MustParse("16Gi")},
	}
	clusterResizesPods(r, true)
	r.podStatus = func(context.Context, string) (bool, bool) { return true, true }
	for _, peer := range []string{"idle-peer", "other-peer"} {
		peerVMAgent(t, r, peer, "4Gi", "20Gi", true)
		_, err := r.dynamic.Resource(AgentsGVR).Namespace("test-agents").Patch(ctx, peer, "application/merge-patch+json",
			[]byte(`{"metadata":{"annotations":{"`+annLastActivity+`":"`+time.Now().UTC().Add(-10*time.Minute).Format(time.RFC3339)+`"}}}`),
			metav1.PatchOptions{})
		require.NoError(t, err)
		r.noteMachineUse(peer, measured(700))
	}
	runnerPod(t, r, "9Gi", "16Gi")
	pod, err := r.client.CoreV1().Pods("test-agents").Get(ctx, r.runnerName(testOwner)+"-abc", metav1.GetOptions{})
	require.NoError(t, err)
	pod.Status.ContainerStatuses = []corev1.ContainerStatus{{
		Name: vmRunnerComponent,
		Resources: &corev1.ResourceRequirements{
			Requests: corev1.ResourceList{corev1.ResourceMemory: resource.MustParse("9Gi")},
		},
	}}
	pod.Status.Conditions = []corev1.PodCondition{{
		Type: corev1.PodResizePending, Status: corev1.ConditionTrue, Reason: corev1.PodReasonDeferred, Message: "node(s) didn't have free memory",
	}}
	_, err = r.client.CoreV1().Pods("test-agents").UpdateStatus(ctx, pod, metav1.UpdateOptions{})
	require.NoError(t, err)
	node.statuses["my-agent"] = vmrunner.MachineStatus{State: vmrunner.StateStopped, Reason: vmrunner.ReasonAwaitingAllocation}

	require.NoError(t, r.Reconcile(ctx, agent))

	hibernated := 0
	for _, peer := range []string{"idle-peer", "other-peer"} {
		reclaimed, err := r.dynamic.Resource(AgentsGVR).Namespace("test-agents").Get(ctx, peer, metav1.GetOptions{})
		require.NoError(t, err)
		if reclaimed.GetAnnotations()[annReclaimedAt] != "" {
			hibernated++
		}
	}
	assert.Positive(t, hibernated,
		"a resize the node will not enact leaves the room it did grant, and an idle agent's machine frees it")
	cond := readyCondition(t, r, "my-agent")
	require.NotNil(t, cond)
	assert.Equal(t, apiv1.ReasonAwaitingAllocation, cond.Reason)
	assert.Equal(t, vmReadinessPoll, requeued.last(), "still retried at the machine watch's cadence, with the parked tick under it")
}

// TEST_SCENARIO: two wakes that become AwaitingAllocation together are both counted by the resize request, and neither holds a byte: counting the other waiter as a holder asks the reclaim for room no idle agent can give, so neither start is ever admitted even though one machine's worth of room would admit it.
func TestReclaimForAWaitingStartDoesNotCountTheOtherWaiter(t *testing.T) {
	ctx := context.Background()
	agent := vmAgentCR()
	r, node, _ := setupVMReconciler(t, agent)
	r.config.VM.Runner.Resources = &corev1.ResourceRequirements{
		Limits: corev1.ResourceList{corev1.ResourceMemory: resource.MustParse("16Gi")},
	}
	clusterResizesPods(r, true)
	r.podStatus = func(context.Context, string) (bool, bool) { return true, true }
	for _, peer := range []string{"idle-peer", "other-peer"} {
		peerVMAgent(t, r, peer, "4Gi", "20Gi", true)
		_, err := r.dynamic.Resource(AgentsGVR).Namespace("test-agents").Patch(ctx, peer, "application/merge-patch+json",
			[]byte(`{"metadata":{"annotations":{"`+annLastActivity+`":"`+time.Now().UTC().Add(-10*time.Minute).Format(time.RFC3339)+`"}}}`),
			metav1.PatchOptions{})
		require.NoError(t, err)
	}
	// TEST_SCENARIO: one idle machine is up and holding memory; the second waiter reached this same wait first and its machine is stopped, holding nothing while it waits.
	r.noteMachineUse("idle-peer", measured(700))
	r.vmAnswers.Store("other-peer", vmrunner.ReasonAwaitingAllocation)
	runnerPod(t, r, "9Gi", "16Gi")
	pod, err := r.client.CoreV1().Pods("test-agents").Get(ctx, r.runnerName(testOwner)+"-abc", metav1.GetOptions{})
	require.NoError(t, err)
	pod.Status.ContainerStatuses = []corev1.ContainerStatus{{
		Name: vmRunnerComponent,
		Resources: &corev1.ResourceRequirements{
			Requests: corev1.ResourceList{corev1.ResourceMemory: resource.MustParse("9Gi")},
		},
	}}
	pod.Status.Conditions = []corev1.PodCondition{{
		Type: corev1.PodResizePending, Status: corev1.ConditionTrue, Reason: corev1.PodReasonDeferred, Message: "node(s) didn't have free memory",
	}}
	_, err = r.client.CoreV1().Pods("test-agents").UpdateStatus(ctx, pod, metav1.UpdateOptions{})
	require.NoError(t, err)
	node.statuses["my-agent"] = vmrunner.MachineStatus{State: vmrunner.StateStopped, Reason: vmrunner.ReasonAwaitingAllocation}

	// TEST_SCENARIO: the step-down has been with the node for longer than a grace, so this pass is about what the reclaim counts rather than about when it runs.
	r.steppedSince.Store(testOwner, time.Now().Add(-2*steppedGrantGrace))
	require.NoError(t, r.Reconcile(ctx, agent))

	hibernated := map[string]bool{}
	for _, peer := range []string{"idle-peer", "other-peer"} {
		reclaimed, err := r.dynamic.Resource(AgentsGVR).Namespace("test-agents").Get(ctx, peer, metav1.GetOptions{})
		require.NoError(t, err)
		hibernated[peer] = reclaimed.GetAnnotations()[annReclaimedAt] != ""
	}
	assert.True(t, hibernated["idle-peer"], "one idle machine frees what this start lacks")
	assert.False(t, hibernated["other-peer"], "the other waiter holds nothing, so it is not a machine this reclaim can free room with")
}

// TEST_SCENARIO: a runner outside the cluster refuses a machine for memory; its limit is a share of its host's memory the controller never learns, so the refusal names no figures rather than quote the chart's limit.
func TestAHostRunnerMemoryRefusalNamesNoFigures(t *testing.T) {
	ctx := context.Background()
	agent := vmAgentCR()
	r, node, _ := setupVMReconciler(t, agent)
	r.config.VM.Runner.HostAddress = "192.168.5.2"
	for _, sec := range []*corev1.Secret{runnerSecret(), runnerTLSSecret()} {
		sec.Name = strings.Replace(sec.Name, runnerSuffix(testOwner), "host", 1)
		_, err := r.client.CoreV1().Secrets("test-agents").Create(ctx, sec, metav1.CreateOptions{})
		require.NoError(t, err)
	}
	node.statuses["my-agent"] = vmrunner.MachineStatus{
		State:   vmrunner.StateCreating,
		Reason:  vmrunner.ReasonOutOfCapacity,
		Message: "this machine's 1024 MiB does not fit",
	}

	require.NoError(t, r.Reconcile(ctx, agent))

	cond := readyCondition(t, r, "my-agent")
	require.NotNil(t, cond)
	assert.Contains(t, cond.Message, "Your VM agents' memory is full, so this agent can't start yet.")
	assert.NotContains(t, cond.Message, "GiB", "the host runner's share is unknown here")
}

// TEST_SCENARIO: a runner whose claim is full refuses a machine under MachineStorageFull, which is not the memory refusal. The Agent is not parked, since parking halts a machine, and the runner's explanation reaches the AgentPodReady condition the api-server classifies a wake by.
func TestAStorageRefusalIsPublishedWithoutParking(t *testing.T) {
	ctx := context.Background()
	agent := vmAgentCR()
	r, node, _ := setupVMReconciler(t, agent)
	node.statuses["my-agent"] = vmrunner.MachineStatus{
		State:   vmrunner.StateAbsent,
		Reason:  vmrunner.ReasonStorageFull,
		Message: "your agents' shared storage is 93% full",
	}

	require.NoError(t, r.Reconcile(ctx, agent))

	assert.Equal(t, int32(1), agentSSReplicas(t, r, GatewayName("my-agent")), "a storage refusal does not park the agent")
	obj, err := r.dynamic.Resource(AgentsGVR).Namespace("test-agents").Get(ctx, "my-agent", metav1.GetOptions{})
	require.NoError(t, err)
	got, err := FromCacheObject[apiv1.Agent](obj)
	require.NoError(t, err)
	cond := apimeta.FindStatusCondition(got.Status.Conditions, apiv1.ConditionAgentPodReady)
	require.NotNil(t, cond)
	assert.Equal(t, metav1.ConditionFalse, cond.Status)
	assert.Equal(t, vmrunner.ReasonStorageFull, cond.Reason)
	assert.Contains(t, cond.Message, "93% full")
}

// TEST_SCENARIO: a runner that cannot reach the node's image cache refuses every image its machines do not already hold, and the runner sees only its own mount of the cache directory — two runners on one node directory and on a stale copy of it name the same socket. So the Agent's own failure names the node directory this runner mounts, which is the fact an operator compares with the one the cache service writes: a start that fails with no pending runner change writes no roll Event to carry it.
func TestACacheRefusalNamesTheNodeDirectoryTheRunnerMounts(t *testing.T) {
	ctx := context.Background()
	agent := vmAgentCR()
	r, node, _ := setupVMReconciler(t, agent)
	createRolloutRunner(t, r, testOwner)
	node.statuses["my-agent"] = vmrunner.MachineStatus{
		State:   vmrunner.StateAbsent,
		Reason:  vmrunner.ReasonImageCacheUnreachable,
		Message: "the node's image cache service at /var/lib/platform/images/.cache.sock cannot be reached: Connection refused (os error 111)",
	}

	require.NoError(t, r.Reconcile(ctx, agent))

	obj, err := r.dynamic.Resource(AgentsGVR).Namespace("test-agents").Get(ctx, "my-agent", metav1.GetOptions{})
	require.NoError(t, err)
	got, err := FromCacheObject[apiv1.Agent](obj)
	require.NoError(t, err)
	cond := apimeta.FindStatusCondition(got.Status.Conditions, apiv1.ConditionAgentPodReady)
	require.NotNil(t, cond)
	assert.Equal(t, vmrunner.ReasonImageCacheUnreachable, cond.Reason)
	assert.Contains(t, cond.Message, "cannot be reached", "the runner's own refusal is published")
	assert.Contains(t, cond.Message, r.config.VM.Runner.ImageCacheHostPath, "the failure does not name the node directory the runner mounts")
}

// TEST_SCENARIO: a full home inside a guest is the same failure a container agent reports from its termination message, so the runner's reason for it is published as HomeVolumeFull, and the api-server's and UI's existing copy for a full home applies to a vm agent too.
func TestAFullHomeInsideAGuestIsPublishedAsAFullHomeVolume(t *testing.T) {
	ctx := context.Background()
	agent := vmAgentCR()
	r, node, _ := setupVMReconciler(t, agent)
	node.statuses["my-agent"] = vmrunner.MachineStatus{
		State:   vmrunner.StateRunning,
		Reason:  vmrunner.ReasonHomeFull,
		Message: "the agent's disk is full",
	}

	require.NoError(t, r.Reconcile(ctx, agent))

	obj, err := r.dynamic.Resource(AgentsGVR).Namespace("test-agents").Get(ctx, "my-agent", metav1.GetOptions{})
	require.NoError(t, err)
	got, err := FromCacheObject[apiv1.Agent](obj)
	require.NoError(t, err)
	cond := apimeta.FindStatusCondition(got.Status.Conditions, apiv1.ConditionAgentPodReady)
	require.NotNil(t, cond)
	assert.Equal(t, apiv1.ReasonHomeVolumeFull, cond.Reason)
	assert.Contains(t, cond.Message, "disk is full")
}

// TEST_SCENARIO: an agent that was down before the runner's kill carried a condition flip from long before it, and a publish that changes only the reason moves no transition time — so a kill timed from that flip would be outside its episode on the first read, and the agent would name the kill on one reconcile and its own reason on the next, all the way through the episode. The reason carries the time it was first published instead, so the reconcile after it still reads the kill.
func TestTheKillTheRunnerReportsIsNotOvertakenByTheAgentsOwnReason(t *testing.T) {
	agent := vmAgentCR()
	r, _, _ := setupVMReconciler(t, agent)
	ctx := context.Background()
	r.vmRunning.Store(agent.Name, true)
	r.vmRunningSince.Store(agent.Name, time.Now().Add(-time.Hour))
	stored, err := r.dynamic.Resource(AgentsGVR).Namespace("test-agents").Get(ctx, agent.Name, metav1.GetOptions{})
	require.NoError(t, err)
	require.NoError(t, unstructured.SetNestedSlice(stored.Object, []any{map[string]any{
		"type":               apiv1.ConditionAgentPodReady,
		"status":             string(metav1.ConditionFalse),
		"reason":             vmrunner.ReasonNotReady,
		"message":            "machine is stopped",
		"lastTransitionTime": metav1.NewTime(time.Now().Add(-20 * time.Minute)).Format(time.RFC3339),
	}}, "status", "conditions"))
	seeded, err := r.dynamic.Resource(AgentsGVR).Namespace("test-agents").Update(ctx, stored, metav1.UpdateOptions{})
	require.NoError(t, err)
	agent, err = FromCacheObject[apiv1.Agent](seeded)
	require.NoError(t, err)
	runner, err := r.client.CoreV1().Pods("test-agents").Get(ctx, readyRunnerPod().Name, metav1.GetOptions{})
	require.NoError(t, err)
	runner.Status.ContainerStatuses = []corev1.ContainerStatus{{
		Name: vmRunnerComponent,
		LastTerminationState: corev1.ContainerState{Terminated: &corev1.ContainerStateTerminated{
			Reason: "OOMKilled", FinishedAt: metav1.NewTime(time.Now().Add(-time.Minute)),
		}},
	}}
	_, err = r.client.CoreV1().Pods("test-agents").UpdateStatus(ctx, runner, metav1.UpdateOptions{})
	require.NoError(t, err)

	read := func() *metav1.Condition {
		obj, err := r.dynamic.Resource(AgentsGVR).Namespace("test-agents").Get(ctx, agent.Name, metav1.GetOptions{})
		require.NoError(t, err)
		got, err := FromCacheObject[apiv1.Agent](obj)
		require.NoError(t, err)
		return apimeta.FindStatusCondition(got.Status.Conditions, apiv1.ConditionAgentPodReady)
	}

	require.NoError(t, r.publishVMReadiness(ctx, agent,
		vmrunner.MachineStatus{State: vmrunner.StateStopped, Reason: vmrunner.ReasonNotReady, Message: "machine is stopped"}, true))
	first := read()
	require.NotNil(t, first)
	require.Equal(t, apiv1.ReasonRunnerOutOfMemory, first.Reason)
	assert.WithinDuration(t, time.Now(), first.LastTransitionTime.Time, time.Minute,
		"the episode is timed from this publish, not from a flip twenty minutes old")

	// TEST_SCENARIO: the next reconcile reads the condition this one wrote, exactly as a reconciler working from the API would.
	agent.Status.Conditions = []metav1.Condition{*first}
	require.NoError(t, r.publishVMReadiness(ctx, agent,
		vmrunner.MachineStatus{State: vmrunner.StateStopped, Reason: vmrunner.ReasonNotReady, Message: "machine is stopped"}, true))
	assert.Equal(t, apiv1.ReasonRunnerOutOfMemory, read().Reason, "the reconcile after the kill's publish names the kill again")
}

// TEST_SCENARIO: a runner roll, a controller restart or a schedule retry brings an owner's agents back with no fresh activity bump, and the runner refuses the ones that do not fit while the others warm up. Nobody presses Start again for those, so the refusal is not remembered against the wake: the retry tick reconciles the agent under the same activity, and it starts once room has freed.
func TestASweepWakeRefusedForMemoryStartsOnTheRetryTick(t *testing.T) {
	ctx := context.Background()
	agent := vmAgentCR()
	r, node, _ := setupVMReconciler(t, agent)
	node.statuses["my-agent"] = vmrunner.MachineStatus{State: vmrunner.StateCreating, Reason: vmrunner.ReasonOutOfCapacity, Message: "does not fit"}

	require.NoError(t, r.Reconcile(ctx, agent))
	require.Contains(t, r.ParkedForRetry(), "my-agent", "the refused wake is queued for the retry tick")

	node.mu.Lock()
	node.statuses["my-agent"] = vmrunner.MachineStatus{State: vmrunner.StateStopped}
	node.puts = nil
	node.mu.Unlock()
	require.NoError(t, r.Reconcile(ctx, agent))

	assert.True(t, node.spec("my-agent").Running, "the retry under the same activity asked the runner to start the machine")
	assert.NotContains(t, r.ParkedForRetry(), "my-agent", "and the agent left the retry queue")
}

// TEST_SCENARIO: a runner with no ready replica reports nothing about its machines, so the reconcile gets an empty machine status. The runner keeps its restart counter in memory and reports it again once it is back. Publishing the empty status as zero restarts would make that return read as a rise, and the UI would announce a restart that never happened.
func TestAnUnreachableRunnerKeepsThePublishedRestarts(t *testing.T) {
	agent := vmAgentCR()
	r, _, _ := setupVMReconciler(t, agent)
	ctx := context.Background()

	require.NoError(t, r.publishVMReadiness(ctx, agent,
		vmrunner.MachineStatus{State: vmrunner.StateRunning, Ready: true, Restarts: 2}, true))
	restarts, _ := agentRestartStatus(t, r, agent.Name)
	require.Equal(t, int64(2), restarts, "precondition: the count was published")

	require.NoError(t, r.publishVMReadiness(ctx, agent,
		vmrunner.MachineStatus{Message: "vm runner is not ready"}, false))

	restarts, reason := agentRestartStatus(t, r, agent.Name)
	assert.Equal(t, int64(2), restarts)
	assert.Equal(t, "GuestStoppedAnswering", reason)
}

// TEST_SCENARIO: a grant too small for one more machine is answered by asking the node for less, not by freeing anything. While that smaller ask is still on its way — the pod still carries the larger ask the whole demand called for — an idle agent must not be hibernated: the node may grant the smaller ask, and the machine the owner already had would have fitted beside the new one. The reclaim waits for the pod to carry the reduced ask, which is how the two cases are told apart without a timer.
func TestAWaitingStartDoesNotFreeRoomWhileTheReducedAskIsInFlight(t *testing.T) {
	ctx, r, agent := deferredResizeWithWaits(t, false)

	require.NoError(t, r.Reconcile(ctx, agent))

	for _, peer := range []string{"idle-peer", "peer-b"} {
		untouched, err := r.dynamic.Resource(AgentsGVR).Namespace("test-agents").Get(ctx, peer, metav1.GetOptions{})
		require.NoError(t, err)
		assert.Empty(t, untouched.GetAnnotations()[annReclaimedAt],
			"%s was hibernated for room the node is being asked for with the smaller request", peer)
	}
	assert.WithinDuration(t, time.Now(), mustLoad(t, &r.steppedSince, testOwner), time.Minute,
		"the step-down is recorded from the pass that made it, so the grace runs from there")
	cond := readyCondition(t, r, "my-agent")
	require.NotNil(t, cond)
	assert.Equal(t, apiv1.ReasonAwaitingAllocation, cond.Reason)
}

// TEST_SCENARIO: once the pod carries the reduced ask and the node has still not granted it, the grant is exhausted and the owner's own idle agents are the only room left: the reclaim runs again, as it does for a start the pool refused. Without that, a grant that can never hold one more machine would leave every start of that owner waiting for ever.
func TestTheReclaimRunsOnceTheReducedAskIsExhausted(t *testing.T) {
	ctx, r, agent := deferredResizeWithWaits(t, true)
	// TEST_SCENARIO: the step-down began more than a grace ago, and the node has still not granted it.
	r.steppedSince.Store(testOwner, time.Now().Add(-2*steppedGrantGrace))

	require.NoError(t, r.Reconcile(ctx, agent))

	reclaimed, err := r.dynamic.Resource(AgentsGVR).Namespace("test-agents").Get(ctx, "idle-peer", metav1.GetOptions{})
	require.NoError(t, err)
	assert.NotEmpty(t, reclaimed.GetAnnotations()[annReclaimedAt],
		"the reduced ask is exhausted and an idle machine is the only room left")
}

func mustLoad(t *testing.T, m *sync.Map, key string) time.Time {
	t.Helper()
	v, ok := m.Load(key)
	require.True(t, ok, "the step-down was never recorded")
	return v.(time.Time)
}

// UNIT_BOUNDARY_DESCRIPTION: one idle machine up and holding memory, two starts waiting for the node, and a runner pod the node has granted 2560 MiB of, which holds the two machines that wait but not the one more a start needs. `stepped` puts the reduced ask in the pod, as a step-down the node has already been given and refused; without it the pod carries the whole demand, as a step-down the node has not been given yet. Both figures come from the production sizing, so the fixture cannot drift from it.
func deferredResizeWithWaits(t *testing.T, stepped bool) (context.Context, *AgentReconciler, *apiv1.Agent) {
	t.Helper()
	ctx := context.Background()
	agent := vmAgentCR()
	r, node, _ := setupVMReconciler(t, agent)
	r.config.VM.Runner.BootMiB = 1024
	r.config.VM.Runner.Resources = &corev1.ResourceRequirements{
		Requests: corev1.ResourceList{corev1.ResourceMemory: resource.MustParse("1Gi")},
		Limits:   corev1.ResourceList{corev1.ResourceMemory: resource.MustParse("16Gi")},
	}
	clusterResizesPods(r, true)
	r.podStatus = func(context.Context, string) (bool, bool) { return true, true }
	for _, peer := range []string{"idle-peer", "peer-b"} {
		peerVMAgent(t, r, peer, "4Gi", "20Gi", true)
		_, err := r.dynamic.Resource(AgentsGVR).Namespace("test-agents").Patch(ctx, peer, "application/merge-patch+json",
			[]byte(`{"metadata":{"annotations":{"`+annLastActivity+`":"`+time.Now().UTC().Add(-10*time.Minute).Format(time.RFC3339)+`"}}}`),
			metav1.PatchOptions{})
		require.NoError(t, err)
	}
	r.noteMachineUse("idle-peer", measured(2304))
	r.vmAnswers.Store("peer-b", vmrunner.ReasonAwaitingAllocation)
	node.set("my-agent", vmrunner.MachineStatus{State: vmrunner.StateStopped, Reason: vmrunner.ReasonAwaitingAllocation})

	runnerPod(t, r, "1Gi", "16Gi")
	pod, err := r.client.CoreV1().Pods("test-agents").Get(ctx, r.runnerName(testOwner)+"-abc", metav1.GetOptions{})
	require.NoError(t, err)
	demand, err := r.ownerRunnerDemand(ctx, testOwner, agent, false)
	require.NoError(t, err)
	wants, ok := r.runnerPodWants(ctx, testOwner, pod, demand)
	require.True(t, ok)
	carried := wants.memoryRequest
	if !stepped {
		carried = runnerMemoryRequest(demand.memoryMiB, r.config.VM.Runner.ReserveMiB, carried, resource.MustParse("1Gi"), resource.MustParse("16Gi"))
	}
	pod.Spec.Containers[0].Resources.Requests[corev1.ResourceMemory] = carried
	pod.Status.ContainerStatuses = []corev1.ContainerStatus{{
		Name:               vmRunnerComponent,
		AllocatedResources: corev1.ResourceList{corev1.ResourceMemory: resource.MustParse("2560Mi")},
	}}
	pod.Status.Conditions = []corev1.PodCondition{{
		Type: corev1.PodResizePending, Status: corev1.ConditionTrue, Reason: corev1.PodReasonDeferred, Message: "node(s) didn't have free memory",
	}}
	pod, err = r.client.CoreV1().Pods("test-agents").Update(ctx, pod, metav1.UpdateOptions{})
	require.NoError(t, err)
	_, err = r.client.CoreV1().Pods("test-agents").UpdateStatus(ctx, pod, metav1.UpdateOptions{})
	require.NoError(t, err)
	return ctx, r, agent
}
