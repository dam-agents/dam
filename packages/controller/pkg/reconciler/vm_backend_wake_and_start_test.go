// TEST_OVERVIEW: a wake brings the gateway up before the machine starts, and a start the runner answered with a wait is parked and retried without losing the restart in flight or the grant already read.
package reconciler

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	appsv1 "k8s.io/api/apps/v1"
	corev1 "k8s.io/api/core/v1"
	"k8s.io/apimachinery/pkg/api/resource"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes/fake"
	k8stesting "k8s.io/client-go/testing"

	apiv1 "github.com/dam-agents/dam/packages/controller/api/v1"
	"github.com/dam-agents/dam/packages/controller/pkg/vmrunner"
)

// TEST_SCENARIO: a waking gateway pod takes longer to start than the machine beside it, so a wake scales the gateway up before the runner is asked to start the machine, not after the runner answers.
func TestAWakeScalesTheGatewayUpBeforeItStartsTheMachine(t *testing.T) {
	agent := vmAgentCR()
	agent.Annotations[annLastActivity] = time.Now().Add(-2 * time.Hour).UTC().Format(time.RFC3339)
	r, node, _ := setupVMReconciler(t, agent)
	ctx := context.Background()
	require.NoError(t, r.Reconcile(ctx, agent))
	require.Equal(t, int32(0), agentSSReplicas(t, r, GatewayName("my-agent")), "the Agent starts out hibernated")

	gatewayAtStart := int32(-1)
	node.onPut = func(spec vmrunner.MachineSpec) {
		if spec.Running && gatewayAtStart < 0 {
			gatewayAtStart = agentSSReplicas(t, r, GatewayName("my-agent"))
		}
	}
	agent.Annotations[annLastActivity] = time.Now().UTC().Format(time.RFC3339)
	agent.Status.Conditions = []metav1.Condition{{Type: apiv1.ConditionReady, Status: metav1.ConditionFalse, Reason: apiv1.ReasonHibernated}}
	require.NoError(t, r.Reconcile(ctx, agent))
	assert.Equal(t, int32(1), gatewayAtStart, "the gateway is already scaled up when the machine is asked to run")
}

// TEST_SCENARIO: the retry of an agent the runner refused must not scale its gateway up ahead of the runner call either, or each 30 s retry would start and stop a gateway pod. The refusal is also the runner's answer rather than a line on the Agent, so it counts before the status carries it, and the answer that admits the machine replaces it: a machine the runner admits counts while it boots, before it is a live machine to count by.
func TestARetryAfterARefusedStartKeepsTheGatewayDown(t *testing.T) {
	ctx := context.Background()
	agent := vmAgentCR()
	r, node, _ := setupVMReconciler(t, agent)
	node.statuses["my-agent"] = vmrunner.MachineStatus{State: vmrunner.StateAbsent, Reason: vmrunner.ReasonOutOfCapacity, Message: "does not fit"}
	spendTheMemoryGrace(t, r, agent)
	require.NoError(t, r.Reconcile(ctx, agent))
	require.Equal(t, apiv1.ReasonOverBudget, readyCondition(t, r, "my-agent").Reason)

	gatewayAtRetry := int32(-1)
	node.onPut = func(vmrunner.MachineSpec) { gatewayAtRetry = agentSSReplicas(t, r, GatewayName("my-agent")) }
	u, err := r.dynamic.Resource(AgentsGVR).Namespace("test-agents").Get(ctx, "my-agent", metav1.GetOptions{})
	require.NoError(t, err)
	cached, err := FromCacheObject[apiv1.Agent](u)
	require.NoError(t, err)
	unparked := *cached
	unparked.Status.Conditions = nil
	require.True(t, r.refusedWithoutMachine(&unparked), "a refusal counts from the runner's answer, with nothing on the status to read it from")

	require.NoError(t, r.Reconcile(ctx, cached))
	assert.Equal(t, int32(0), gatewayAtRetry, "the gateway stays down while the runner is asked again")

	node.set("my-agent", vmrunner.MachineStatus{State: vmrunner.StateCreating, Reason: vmrunner.ReasonOutOfCapacity})
	require.NoError(t, r.Reconcile(ctx, cached))
	assert.False(t, r.refusedWithoutMachine(cached), "a machine the runner admitted counts while it boots, whatever park the status still carries")
	elsewhere := vmAgentCR()
	elsewhere.Name = "elsewhere"
	demand, err := r.heldRunnerDemand(ctx, testOwner, elsewhere, false)
	require.NoError(t, err)
	assert.Equal(t, 3072, demand.memoryMiB, "the admitted machine still holds its boot floor, though its answer repeats the refusal's reason")
}

// TEST_SCENARIO: a restart the runner is running holds its exemption from the ceiling, but a runner built before that still answers the wait when the controller's ensure lands between the stop and the boot. Acting on that answer by parking would stop the machine behind the restart the runner already performs, and the owner's machines would be left down for a ceiling nothing asked for.
func TestAStartWaitingForTheNodeDoesNotStopARestartInFlight(t *testing.T) {
	ctx := context.Background()
	agent := vmAgentCR()
	r, node, _ := setupVMReconciler(t, agent)
	node.statuses["my-agent"] = vmrunner.MachineStatus{State: vmrunner.StateRestarting, Reason: vmrunner.ReasonAwaitingAllocation}

	require.NoError(t, r.Reconcile(ctx, agent))

	assert.True(t, node.spec("my-agent").Running, "the restart was stopped for an answer about an operation already in flight")
	assert.NotEqual(t, apiv1.ReasonAwaitingAllocation, readyCondition(t, r, "my-agent").Reason,
		"an Agent whose machine is restarting reads as starting, not as waiting for the node")
}

// TEST_SCENARIO: the controller's own reading is kept from the last time a machine ran, so a guest that has exited since still reads as running there. Admitting on that reading turns a genuine cold start into one with no ceiling, which is the overcommit the ceiling exists to prevent. What a machine holds is only ever the runner's current answer.
func TestACachedRunningMachineThatStoppedIsHeldLikeAColdStart(t *testing.T) {
	ctx := context.Background()
	agent := vmAgentCR()
	r, node, _ := setupVMReconciler(t, agent)
	r.config.VM.Runner.Resources = &corev1.ResourceRequirements{Limits: corev1.ResourceList{corev1.ResourceMemory: resource.MustParse("16Gi")}}
	clusterResizesPods(r, true)
	runnerPod(t, r, "1Gi", "16Gi")
	runnerPodForgetsItsGrant(t, r)
	r.noteMachineUse("my-agent", vmrunner.MachineStatus{State: vmrunner.StateRunning, Ready: true})
	node.set("my-agent", vmrunner.MachineStatus{State: vmrunner.StateStopped})

	require.NoError(t, r.Reconcile(ctx, agent))

	for _, spec := range node.ensures() {
		assert.False(t, spec.Running && spec.AdmitMiB == 0,
			"a cold start was admitted against the whole pool because the controller still held the machine's last running reading")
	}
	assert.False(t, node.spec("my-agent").Running, "a start with no grant to admit against went ahead")
}

// TEST_SCENARIO: a revision restart is admitted and blocked between stopping the old VMM and booting its replacement, and the state read fails transiently before the runner answers again. Acting on the failed read with no state parks the Agent, and the halt that follows is stored behind the restart: the replacement is stopped once it boots. A failed read is no evidence, so the reconcile is retried and nothing is stopped.
func TestAFailedStateReadKeepsARestartFromBeingStopped(t *testing.T) {
	ctx := context.Background()
	agent := vmAgentCR()
	r, node, _ := setupVMReconciler(t, agent)
	r.config.VM.Runner.Resources = &corev1.ResourceRequirements{Limits: corev1.ResourceList{corev1.ResourceMemory: resource.MustParse("16Gi")}}
	clusterResizesPods(r, true)
	runnerPod(t, r, "1Gi", "16Gi")
	runnerPodForgetsItsGrant(t, r)
	node.set("my-agent", vmrunner.MachineStatus{State: vmrunner.StateRestarting})
	node.failStatusReads(true)

	require.Error(t, r.Reconcile(ctx, agent), "a state the runner could not report was acted on instead of retried")
	assert.NotEqual(t, apiv1.ReasonAwaitingAllocation, readyCondition(t, r, "my-agent").Reason,
		"an Agent whose machine is restarting was parked for an answer nothing gave")

	node.failStatusReads(false)
	require.NoError(t, r.Reconcile(ctx, agent))

	for _, spec := range node.ensures() {
		assert.True(t, spec.Running, "a failed state read stopped a machine whose restart the runner is performing")
	}
}

// TEST_SCENARIO: the runner says it cannot read the machine's own launch record, which is a machine that may still hold the memory of a VMM it cannot account for. Absence of an active spelling is not proof of a stop, so the reconcile is retried rather than held, parked or admitted.
func TestAnUnreadableMachineRecordIsNotTreatedAsStopped(t *testing.T) {
	ctx := context.Background()
	agent := vmAgentCR()
	r, node, _ := setupVMReconciler(t, agent)
	r.config.VM.Runner.Resources = &corev1.ResourceRequirements{Limits: corev1.ResourceList{corev1.ResourceMemory: resource.MustParse("16Gi")}}
	clusterResizesPods(r, true)
	runnerPod(t, r, "1Gi", "16Gi")
	runnerPodForgetsItsGrant(t, r)
	node.set("my-agent", vmrunner.MachineStatus{State: vmrunner.StateUnknown})

	require.Error(t, r.Reconcile(ctx, agent), "an unreadable machine record was decided on instead of retried")

	for _, spec := range node.ensures() {
		assert.True(t, spec.Running, "an unreadable machine record stopped the machine")
	}
}

// TEST_SCENARIO: a node that reports nothing it holds for the owner's runner leaves the grant unreadable, and what that means has to come from the runner: a machine it reports running holds memory, so admitting it against the limit alone asks for no footprint the node has not already granted, and a start held here would stop a healthy machine rather than a boot. The controller's own last reading cannot tell: it is kept only while a machine runs, so a restart in flight reads as a stop there.
func TestAnUnreadableGrantDoesNotStopARunningMachine(t *testing.T) {
	ctx := context.Background()
	agent := vmAgentCR()
	r, node, _ := setupVMReconciler(t, agent)
	r.config.VM.Runner.Resources = &corev1.ResourceRequirements{Limits: corev1.ResourceList{corev1.ResourceMemory: resource.MustParse("16Gi")}}
	clusterResizesPods(r, true)
	runnerPod(t, r, "1Gi", "16Gi")
	runnerPodForgetsItsGrant(t, r)
	node.set("my-agent", vmrunner.MachineStatus{State: vmrunner.StateRunning, Ready: true, MemoryMiB: 3072})

	require.NoError(t, r.Reconcile(ctx, agent))

	assert.True(t, node.spec("my-agent").Running, "an unreadable grant stopped a machine that was running")
	assert.NotEqual(t, apiv1.ReasonAwaitingAllocation, readyCondition(t, r, "my-agent").Reason,
		"a machine that runs was reported as waiting for the node")
}

// TEST_SCENARIO: a machine that holds memory is re-sent while the node reports no grant, and its ceiling authorizes no footprint at all. Zero would be the whole pool: the machine can stop between this read and the ensure, and the runner would then boot a cold start against memory the node never reserved. One MiB is the tightest ceiling the wire carries, and no boot of a machine that holds memory fits under it.
func TestAMachineThatHoldsMemoryIsRessentWithACeilingThatAuthorizesNothing(t *testing.T) {
	ctx := context.Background()
	agent := vmAgentCR()
	r, node, _ := setupVMReconciler(t, agent)
	r.config.VM.Runner.Resources = &corev1.ResourceRequirements{Limits: corev1.ResourceList{corev1.ResourceMemory: resource.MustParse("16Gi")}}
	clusterResizesPods(r, true)
	runnerPod(t, r, "1Gi", "16Gi")
	runnerPodForgetsItsGrant(t, r)
	node.set("my-agent", vmrunner.MachineStatus{State: vmrunner.StateRunning, Ready: true, MemoryMiB: 3072})

	require.NoError(t, r.Reconcile(ctx, agent))

	held := node.spec("my-agent")
	assert.True(t, held.Running, "an unreadable grant stopped a machine that was running")
	assert.Positive(t, held.AdmitMiB, "a zero ceiling is the whole pool: a machine that stopped before this ensure landed would have been booted against memory the node never reserved")
	assert.Less(t, held.AdmitMiB, held.MemoryMiB, "the ceiling covered a boot, so a machine that stopped before this ensure landed would have started anyway")
}

// TEST_SCENARIO: nothing the controller remembers about a grant survives to a later decision. A figure the node reported before can be larger than what the node reserves now — the machines warm up, the request falls, the node enacts a smaller allocation — so a ceiling derived from history admits a cold start against memory the node has since released. Every ensure decides on the node's current answer alone.
func TestAGrantThisControllerReadBeforeIsNeverUsedAgain(t *testing.T) {
	ctx := context.Background()
	agent := vmAgentCR()
	r, node, _ := setupVMReconciler(t, agent)
	r.config.VM.Runner.Resources = &corev1.ResourceRequirements{Limits: corev1.ResourceList{corev1.ResourceMemory: resource.MustParse("16Gi")}}
	clusterResizesPods(r, true)
	runnerPod(t, r, "9Gi", "16Gi")
	node.set("my-agent", vmrunner.MachineStatus{State: vmrunner.StateStopped})

	// TEST_SCENARIO: the node reports a 9 GiB grant, which admits the start.
	require.NoError(t, r.Reconcile(ctx, agent))
	require.Equal(t, 9216, node.spec("my-agent").AdmitMiB)

	// TEST_SCENARIO: the same controller, later, on a node that reports nothing: the 9 GiB it read once is not a ceiling it may use again.
	runnerPodForgetsItsGrant(t, r)
	node.set("my-agent", vmrunner.MachineStatus{State: vmrunner.StateRunning, Ready: true, MemoryMiB: 3072})
	require.NoError(t, r.Reconcile(ctx, agent))

	assert.Positive(t, node.spec("my-agent").AdmitMiB, "a grant the node stopped reporting left the ensure with no ceiling at all")
	assert.Less(t, node.spec("my-agent").AdmitMiB, node.spec("my-agent").MemoryMiB, "a grant the node stopped reporting was reused as the ceiling")
}

// TEST_SCENARIO: the withdrawal of the ceiling must not depend on which runner is serving. A runner from before the operation exemption answers the ensure of a boot already in flight with the allocation wait, and the controller used to answer that by parking the Agent — which stops the machine the runner was bringing up. Nothing is parked for a machine that is still coming up, so such a boot completes and the next reconcile reads it running.
func TestABootInFlightAnsweredWithTheAllocationWaitIsNotParked(t *testing.T) {
	for _, state := range []string{vmrunner.StateCreating, vmrunner.StateStarting, vmrunner.StateRestarting} {
		t.Run(state, func(t *testing.T) {
			ctx := context.Background()
			agent := vmAgentCR()
			r, node, _ := setupVMReconciler(t, agent)
			node.set("my-agent", vmrunner.MachineStatus{State: state, Reason: vmrunner.ReasonAwaitingAllocation})

			require.NoError(t, r.Reconcile(ctx, agent))

			assert.True(t, node.spec("my-agent").Running, "%s: the machine behind the answer was stopped", state)
			cond := readyCondition(t, r, "my-agent")
			require.NotNil(t, cond)
			assert.NotEqual(t, apiv1.ReasonAwaitingAllocation, cond.Reason,
				"%s: a machine still coming up reads as waiting for the node", state)
		})
	}
}

// TEST_SCENARIO: a start that holds nothing is still parked. The exemption is for machines that hold memory, and a stopped one waiting for the node is exactly the start this ceiling exists to hold.
func TestAStoppedStartAnsweredWithTheAllocationWaitIsParked(t *testing.T) {
	ctx := context.Background()
	agent := vmAgentCR()
	r, node, _ := setupVMReconciler(t, agent)
	node.set("my-agent", vmrunner.MachineStatus{State: vmrunner.StateStopped, Reason: vmrunner.ReasonAwaitingAllocation})

	require.NoError(t, r.Reconcile(ctx, agent))

	cond := readyCondition(t, r, "my-agent")
	require.NotNil(t, cond)
	assert.Equal(t, apiv1.ReasonAwaitingAllocation, cond.Reason, "a start holding nothing is not exempt")
}

// TEST_SCENARIO: a restart boots its replacement, so while the node's grant is unreadable the machine reads restarting and holds the memory its boot takes again. Halting it stops the restart the ceiling left exempt.
func TestAnUnreadableGrantDoesNotStopARestartInFlight(t *testing.T) {
	ctx := context.Background()
	agent := vmAgentCR()
	r, node, _ := setupVMReconciler(t, agent)
	r.config.VM.Runner.Resources = &corev1.ResourceRequirements{Limits: corev1.ResourceList{corev1.ResourceMemory: resource.MustParse("16Gi")}}
	clusterResizesPods(r, true)
	runnerPod(t, r, "1Gi", "16Gi")
	runnerPodForgetsItsGrant(t, r)
	node.set("my-agent", vmrunner.MachineStatus{State: vmrunner.StateRestarting})

	require.NoError(t, r.Reconcile(ctx, agent))

	assert.True(t, node.spec("my-agent").Running, "an unreadable grant stopped a machine that was restarting")
}

// TEST_SCENARIO: a start waiting for the node is retried every few seconds, so its gateway must not be scaled up and taken down on that cadence either: the machine is refused again until the node enacts the resize, and the gateway comes up on the retry after it starts.
func TestARetryOfAStartWaitingForTheNodeKeepsTheGatewayDown(t *testing.T) {
	ctx := context.Background()
	agent := vmAgentCR()
	r, node, requeued := setupVMReconciler(t, agent)
	node.statuses["my-agent"] = vmrunner.MachineStatus{State: vmrunner.StateStopped, Reason: vmrunner.ReasonAwaitingAllocation}
	require.NoError(t, r.Reconcile(ctx, agent))
	require.Equal(t, apiv1.ReasonAwaitingAllocation, readyCondition(t, r, "my-agent").Reason)

	gatewayAtRetry := int32(-1)
	node.onPut = func(vmrunner.MachineSpec) {
		gatewayAtRetry = agentSSReplicas(t, r, GatewayName("my-agent"))
	}
	u, err := r.dynamic.Resource(AgentsGVR).Namespace("test-agents").Get(ctx, "my-agent", metav1.GetOptions{})
	require.NoError(t, err)
	cached, err := FromCacheObject[apiv1.Agent](u)
	require.NoError(t, err)
	require.NoError(t, r.Reconcile(ctx, cached))
	assert.Equal(t, int32(0), gatewayAtRetry, "no gateway pod starts for a machine that waits for the node")
	assert.Equal(t, vmReadinessPoll, requeued.last(), "and the retry keeps the machine watch's cadence")
	require.Equal(t, apiv1.ReasonAwaitingAllocation, readyCondition(t, r, "my-agent").Reason)
}

// TEST_SCENARIO: on a wake the machine often answers before its gateway pod is ready, and the gateway pod turning ready starts a reconcile. That reconcile publishes Ready once the gateway is applied, before it calls the runner, because the status already holds the machine ready for this generation.
func TestAGatewayTurningReadyIsPublishedBeforeTheRunnerCall(t *testing.T) {
	agent := vmAgentCR()
	r, node, _ := setupVMReconciler(t, agent)
	ctx := context.Background()
	node.set("my-agent", vmrunner.MachineStatus{State: vmrunner.StateRunning, Port: 31000, Ready: true})
	require.NoError(t, r.Reconcile(ctx, agent))
	agentSide, _ := agentCondition(t, r, "my-agent", apiv1.ConditionAgentPodReady)
	require.Equal(t, "True", agentSide, "the machine is ready")
	require.Equal(t, metav1.ConditionFalse, readyCondition(t, r, "my-agent").Status, "and the gateway pod is not there yet")

	markGatewayReady(t, r)
	readyAtRunnerCall := ""
	node.onPut = func(vmrunner.MachineSpec) {
		readyAtRunnerCall, _ = agentCondition(t, r, "my-agent", apiv1.ConditionReady)
	}
	u, err := r.dynamic.Resource(AgentsGVR).Namespace("test-agents").Get(ctx, "my-agent", metav1.GetOptions{})
	require.NoError(t, err)
	cached, err := FromCacheObject[apiv1.Agent](u)
	require.NoError(t, err)
	require.NoError(t, r.Reconcile(ctx, cached))
	assert.Equal(t, "True", readyAtRunnerCall, "Ready is published before the runner call")
	assert.Equal(t, metav1.ConditionTrue, readyCondition(t, r, "my-agent").Status, "and the full publish keeps it")
}

// TEST_SCENARIO: the early publish trusts the agent side only for the generation it was published for. After a spec change the reconcile must ask the runner first, so Ready waits for the full publish.
func TestAGatewayTurningReadyAfterASpecChangeWaitsForTheRunner(t *testing.T) {
	agent := vmAgentCR()
	r, node, _ := setupVMReconciler(t, agent)
	ctx := context.Background()
	node.set("my-agent", vmrunner.MachineStatus{State: vmrunner.StateRunning, Port: 31000, Ready: true})
	require.NoError(t, r.Reconcile(ctx, agent))
	markGatewayReady(t, r)

	readyAtRunnerCall := ""
	node.onPut = func(vmrunner.MachineSpec) {
		readyAtRunnerCall, _ = agentCondition(t, r, "my-agent", apiv1.ConditionReady)
	}
	u, err := r.dynamic.Resource(AgentsGVR).Namespace("test-agents").Get(ctx, "my-agent", metav1.GetOptions{})
	require.NoError(t, err)
	cached, err := FromCacheObject[apiv1.Agent](u)
	require.NoError(t, err)
	cached.Generation++
	require.NoError(t, r.Reconcile(ctx, cached))
	assert.Equal(t, "False", readyAtRunnerCall, "a status from another generation is not trusted")
}

// TEST_SCENARIO: an agent the runner refused is parked and retried every 30s, so the gateway must not be brought up and taken down on that cadence — a scheduled and killed pod each cycle, for an agent that cannot run.
func TestAParkedAgentDoesNotBringItsGatewayUpFirst(t *testing.T) {
	ctx := context.Background()
	agent := vmAgentCR()
	r, node, _ := setupVMReconciler(t, agent)
	node.statuses["my-agent"] = vmrunner.MachineStatus{
		State:   vmrunner.StateCreating,
		Reason:  vmrunner.ReasonOutOfCapacity,
		Message: "does not fit",
	}

	require.NoError(t, r.Reconcile(ctx, agent))

	for _, action := range r.client.(*fake.Clientset).Actions() {
		written, ok := action.(k8stesting.CreateAction)
		if !ok {
			continue
		}
		ss, _ := written.GetObject().(*appsv1.StatefulSet)
		if ss == nil || ss.Name != GatewayName("my-agent") || ss.Spec.Replicas == nil {
			continue
		}
		assert.Equal(t, int32(0), *ss.Spec.Replicas, "the gateway is never written as running for an agent the runner refused")
	}
	r.budgetMu.Lock()
	_, queued := r.parkedRetry["my-agent"]
	r.budgetMu.Unlock()
	assert.True(t, queued, "and the agent is queued to try again when room frees")
}
