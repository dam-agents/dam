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

func TestARetryAfterARefusedStartKeepsTheGatewayDown(t *testing.T) {
	ctx := context.Background()
	agent := vmAgentCR()
	r, node, _ := setupVMReconciler(t, agent)
	node.statuses["my-agent"] = vmrunner.MachineStatus{State: vmrunner.StateAbsent, Reason: vmrunner.ReasonOutOfCapacity, Message: "does not fit"}
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

func TestResizeGateAllowsWhenTheRunnerCannotBeReached(t *testing.T) {
	agent := vmAgentCR()
	r, _, _ := setupVMReconciler(t, agent)
	r.runnerEndpoint = func(string) string { return "https://127.0.0.1:1" }

	refusal, err := r.resizeAllows(context.Background(), agent, testOwner)
	require.NoError(t, err, "an unreachable runner must not fail the reconcile")
	assert.Empty(t, refusal)
}
