// TEST_OVERVIEW: a refusal from the runner parks the Agent with the reason the user reads, releases the budget the start held, and never hibernates a machine that is up.
package reconciler

import (
	"context"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	appsv1 "k8s.io/api/apps/v1"
	corev1 "k8s.io/api/core/v1"
	k8serrors "k8s.io/apimachinery/pkg/api/errors"
	apimeta "k8s.io/apimachinery/pkg/api/meta"
	"k8s.io/apimachinery/pkg/api/resource"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/client-go/kubernetes/fake"
	k8stesting "k8s.io/client-go/testing"

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
	spendTheMemoryGrace(t, r, agent)

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

// TEST_SCENARIO: a start the node has not yet granted the memory for is refused under MachineAwaitingAllocation, which is not the owner's memory being full: the controller asks the node for that memory with an in-place resize in the same reconcile, so the Agent is retried at the machine watch's 3 s cadence rather than at the parked tick, no idle agent is hibernated for room the node is already being asked for, and the person reads that their agent is waiting for the node rather than that their memory is gone. A start the pool itself refused frees that room from the owner's idle agents and reads as one waiting for room it has already freed, retried at the same cadence, since the machine a reclaim hibernated stops within seconds.
func TestAStartWaitingForTheNodesMemoryIsRetriedAtOnceAndHibernatesNothing(t *testing.T) {
	ctx := context.Background()
	for _, tc := range []struct {
		reason    string
		published string
		reclaimed bool
		retried   bool
		message   string
	}{
		{reason: vmrunner.ReasonAwaitingAllocation, published: apiv1.ReasonAwaitingAllocation, retried: true, message: "waiting for the node"},
		{reason: vmrunner.ReasonOutOfCapacity, published: apiv1.ReasonAwaitingMemory, reclaimed: true, retried: true, message: "put to sleep to make room"},
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
			assert.NotContains(t, cond.Message, "disable an agent", "nothing the owner disables frees memory the node has not granted")
		}
		if tc.retried {
			assert.Equal(t, vmReadinessPoll, requeued.last(), "retried at the machine watch's cadence, not at the parked tick")
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
	// TEST_SCENARIO: the runner already answered this start as one waiting for the node, as the pass before this one recorded.
	r.vmAnswers.Store("my-agent", vmrunner.ReasonAwaitingAllocation)
	// TEST_SCENARIO: this same ask has been with the node for longer than a grace and the node has still not granted it, so this pass is about what the reclaim counts rather than about when it runs.
	expireTheStepDownGrace(t, r, agent)

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
	expireTheStepDownGrace(t, r, agent)
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
	spendTheMemoryGrace(t, r, agent)
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
	spendTheMemoryGrace(t, r, agent)

	require.NoError(t, r.Reconcile(ctx, agent))

	cond := readyCondition(t, r, "my-agent")
	require.NotNil(t, cond)
	assert.Contains(t, cond.Message, "Your VM agents' memory is full, so this agent can't start yet.")
	assert.NotContains(t, cond.Message, "GiB", "the host runner's share is unknown here")
}

// TEST_SCENARIO: a runner whose claim is full refuses a start, and the refused Agent holds no running parts: the gateway comes down with the machine it would proxy, the Agent is retried at the parked tick, and the runner's explanation reaches the AgentPodReady condition the api-server classifies a wake by. Only a start is parked: a machine that may still hold memory is left alone and only the reason is published, and an Agent that should be asleep keeps the hibernation it already reads, since a runner that refuses the machine it was asked to keep down on a critical claim must not flip the status the pass just wrote.
func TestAStorageRefusalParksOnlyAStartThatHoldsNothing(t *testing.T) {
	ctx := context.Background()
	for _, tc := range []struct {
		name     string
		state    string
		asleep   bool
		parked   bool
		gateways int32
		reason   string
	}{
		{name: "a stopped machine", state: vmrunner.StateStopped, parked: true, gateways: 0, reason: vmrunner.ReasonStorageFull},
		{name: "an absent machine", state: vmrunner.StateAbsent, parked: true, gateways: 0, reason: vmrunner.ReasonStorageFull},
		{name: "a machine that is up", state: vmrunner.StateRunning, gateways: 1, reason: vmrunner.ReasonStorageFull},
		{name: "a machine of unknown state", state: vmrunner.StateUnknown, gateways: 1, reason: vmrunner.ReasonStorageFull},
		{name: "an agent that should be asleep", state: vmrunner.StateAbsent, asleep: true, gateways: 0, reason: apiv1.ReasonHibernated},
	} {
		t.Run(tc.name, func(t *testing.T) {
			agent := vmAgentCR()
			if tc.asleep {
				hibernateTheAgent(t, agent)
			}
			r, node, _ := setupVMReconciler(t, agent)
			if tc.asleep {
				scaleGateway(t, r, 0)
			}
			node.statuses["my-agent"] = vmrunner.MachineStatus{
				State:   tc.state,
				Reason:  vmrunner.ReasonStorageFull,
				Message: "your agents' shared storage is 93% full",
			}

			require.NoError(t, r.Reconcile(ctx, agent))

			assert.Equal(t, tc.gateways, agentSSReplicas(t, r, GatewayName("my-agent")),
				"a refused start holds no gateway, and a machine that is up keeps the one it proxies")
			assert.Equal(t, tc.parked, slices.Contains(r.ParkedForRetry(), "my-agent"),
				"only a start is retried at the parked tick")
			live, err := loadAgent(t, r, "my-agent")
			require.NoError(t, err)
			cond := apimeta.FindStatusCondition(live.Status.Conditions, apiv1.ConditionAgentPodReady)
			require.NotNil(t, cond)
			assert.Equal(t, metav1.ConditionFalse, cond.Status)
			assert.Equal(t, tc.reason, cond.Reason)
			if tc.state == vmrunner.StateUnknown {
				assert.Empty(t, stoppedMachines(node), "a machine that may still be up is never sent a stop")
			}
		})
	}
}

// TEST_SCENARIO: the pass after a parked storage refusal asks the runner again, so the gateway must not come up before the runner's answer: a gateway scaled up and straight back down on every pass would start and stop a pod each time. A machine that is up keeps the old order, since the answer about it is published rather than parked.
func TestAParkedStorageRefusalNeverStartsTheGateway(t *testing.T) {
	ctx := context.Background()
	agent := vmAgentCR()
	r, node, _ := setupVMReconciler(t, agent)
	node.statuses["my-agent"] = vmrunner.MachineStatus{State: vmrunner.StateAbsent, Reason: vmrunner.ReasonStorageFull, Message: "your agents' shared storage is 95% full"}
	require.NoError(t, r.Reconcile(ctx, agent))
	require.Contains(t, r.ParkedForRetry(), "my-agent", "precondition: the refused start is parked")

	scaled := []int32{}
	r.client.(*fake.Clientset).PrependReactor("update", "statefulsets", func(action k8stesting.Action) (bool, runtime.Object, error) {
		if ss, ok := action.(k8stesting.UpdateAction).GetObject().(*appsv1.StatefulSet); ok && ss.Name == GatewayName("my-agent") && ss.Spec.Replicas != nil {
			scaled = append(scaled, *ss.Spec.Replicas)
		}
		return false, nil, nil
	})
	parked, err := loadAgent(t, r, "my-agent")
	require.NoError(t, err)
	require.NoError(t, r.Reconcile(ctx, parked))

	assert.NotContains(t, scaled, int32(1), "the gateway is never scaled up between two passes of a parked refusal")
	assert.Equal(t, int32(0), agentSSReplicas(t, r, GatewayName("my-agent")))
}

// UNIT_BOUNDARY_DESCRIPTION: marks the Agent as one the idle checker slept, so the reconcile that reads it wants its machine stopped.
func hibernateTheAgent(t *testing.T, agent *apiv1.Agent) {
	t.Helper()
	if agent.Annotations == nil {
		agent.Annotations = map[string]string{}
	}
	agent.Annotations[annLastActivity] = time.Now().UTC().Add(-90 * time.Minute).Format(time.RFC3339)
}

// UNIT_BOUNDARY_DESCRIPTION: the gateway StatefulSet at the given replica count, as the idle checker leaves it when it sleeps the pair.
func scaleGateway(t *testing.T, r *AgentReconciler, replicas int32) {
	t.Helper()
	ss, err := r.client.AppsV1().StatefulSets("test-agents").Get(context.Background(), GatewayName("my-agent"), metav1.GetOptions{})
	if k8serrors.IsNotFound(err) {
		_, err = r.client.AppsV1().StatefulSets("test-agents").Create(context.Background(), &appsv1.StatefulSet{
			ObjectMeta: metav1.ObjectMeta{Name: GatewayName("my-agent"), Namespace: "test-agents"},
			Spec:       appsv1.StatefulSetSpec{Replicas: &replicas},
		}, metav1.CreateOptions{})
		require.NoError(t, err)
		return
	}
	require.NoError(t, err)
	ss.Spec.Replicas = &replicas
	_, err = r.client.AppsV1().StatefulSets("test-agents").Update(context.Background(), ss, metav1.UpdateOptions{})
	require.NoError(t, err)
}

// UNIT_BOUNDARY_DESCRIPTION: every spec the runner was sent that asks for its machine to stop.
func stoppedMachines(node *fakeNode) []vmrunner.MachineSpec {
	stopped := []vmrunner.MachineSpec{}
	for _, spec := range node.ensures() {
		if !spec.Running {
			stopped = append(stopped, spec)
		}
	}
	return stopped
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

// TEST_SCENARIO: a publish that only changes a condition's reason moves no transition time, so a kill dated by the condition it writes would slide with every reconcile and the reconcile after it would read a kill outside its own episode. The kill's own finished time dates the condition instead, so the same value is written twice, the second write is dropped as unchanged, and the episode is read from the kill.
func TestTheKillIsDatedByTheKillAndNotByTheReconcile(t *testing.T) {
	agent := vmAgentCR()
	r, _, _ := setupVMReconciler(t, agent)
	ctx := context.Background()
	killed := time.Now().Add(-time.Minute).Truncate(time.Second)
	stored, err := r.dynamic.Resource(AgentsGVR).Namespace("test-agents").Get(ctx, agent.Name, metav1.GetOptions{})
	require.NoError(t, err)
	// TEST_SCENARIO: the agent was up before the kill, so its condition predates it.
	require.NoError(t, unstructured.SetNestedMap(stored.Object, map[string]any{
		annMachineUp: killed.Add(-time.Hour).UTC().Format(time.RFC3339Nano),
	}, "metadata", "annotations"))
	require.NoError(t, unstructured.SetNestedSlice(stored.Object, []any{map[string]any{
		"type":               apiv1.ConditionAgentPodReady,
		"status":             string(metav1.ConditionTrue),
		"reason":             "PodReady",
		"lastTransitionTime": metav1.NewTime(killed.Add(-time.Hour)).Format(time.RFC3339),
	}}, "status", "conditions"))
	seeded, err := r.dynamic.Resource(AgentsGVR).Namespace("test-agents").Update(ctx, stored, metav1.UpdateOptions{})
	require.NoError(t, err)
	agent, err = FromCacheObject[apiv1.Agent](seeded)
	require.NoError(t, err)
	killTheRunnerForMemory(t, r, killed)

	read := func() *metav1.Condition {
		obj, err := r.dynamic.Resource(AgentsGVR).Namespace("test-agents").Get(ctx, agent.Name, metav1.GetOptions{})
		require.NoError(t, err)
		got, err := FromCacheObject[apiv1.Agent](obj)
		require.NoError(t, err)
		return apimeta.FindStatusCondition(got.Status.Conditions, apiv1.ConditionAgentPodReady)
	}
	publish := func() {
		obj, err := r.dynamic.Resource(AgentsGVR).Namespace("test-agents").Get(ctx, agent.Name, metav1.GetOptions{})
		require.NoError(t, err)
		read, err := FromCacheObject[apiv1.Agent](obj)
		require.NoError(t, err)
		require.NoError(t, r.publishVMReadiness(ctx, read,
			vmrunner.MachineStatus{State: vmrunner.StateStopped, Reason: vmrunner.ReasonOutOfCapacity, Message: "room for one of two machines"}, true))
	}

	publish()
	first := read()
	require.NotNil(t, first)
	require.Equal(t, apiv1.ReasonRunnerOutOfMemory, first.Reason)
	assert.Equal(t, killed.UTC().Format(time.RFC3339), first.LastTransitionTime.UTC().Format(time.RFC3339),
		"the episode is dated by the kill, not by this publish")

	// TEST_SCENARIO: the next reconcile reads the condition this one wrote, exactly as a reconciler working from the API would, a second later.
	publish()
	assert.Equal(t, first.LastTransitionTime, read().LastTransitionTime, "a repeat reconcile cannot move the episode")
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

// TEST_SCENARIO: a grant too small for one more machine is answered by asking the node for less, not by freeing anything. While that smaller ask is still on its way an idle agent must not be hibernated: the node may grant the smaller ask, and the machine the owner already had would have fitted beside the new one. The reclaim waits out a grace on that very ask first; once the grace is spent the ask is treated as exhausted and the reclaim runs.
func TestAWaitingStartDoesNotFreeRoomWhileTheReducedAskIsInFlight(t *testing.T) {
	ctx, r, agent := deferredResizeWithWaits(t, false)

	require.NoError(t, r.Reconcile(ctx, agent))

	for _, peer := range []string{"idle-peer", "peer-b"} {
		untouched, err := r.dynamic.Resource(AgentsGVR).Namespace("test-agents").Get(ctx, peer, metav1.GetOptions{})
		require.NoError(t, err)
		assert.Empty(t, untouched.GetAnnotations()[annReclaimedAt],
			"%s was hibernated for room the node is being asked for with the smaller request", peer)
	}
	assert.WithinDuration(t, time.Now(), steppedGraceStartedAt(t, r), time.Minute,
		"the step-down is recorded from the pass that made it, so the grace runs from there")
	cond := readyCondition(t, r, "my-agent")
	require.NotNil(t, cond)
	assert.Equal(t, apiv1.ReasonAwaitingAllocation, cond.Reason)
}

// TEST_SCENARIO: the owner's only waiter is the very agent being reconciled. It is still a start waiting for the node, so the grace applies to it as it does to any other: an idle machine hibernated now is taken away while the smaller ask is still on its way, and the two would have fitted. A demand read that counts only the *other* waiters finds none here and lets the reclaim through at once.
func TestASoleWaiterWaitsOutTheGraceLikeAnyOther(t *testing.T) {
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
	peerVMAgent(t, r, "idle-peer", "4Gi", "20Gi", true)
	_, err := r.dynamic.Resource(AgentsGVR).Namespace("test-agents").Patch(ctx, "idle-peer", "application/merge-patch+json",
		[]byte(`{"metadata":{"annotations":{"`+annLastActivity+`":"`+time.Now().UTC().Add(-10*time.Minute).Format(time.RFC3339)+`"}}}`),
		metav1.PatchOptions{})
	require.NoError(t, err)
	r.noteMachineUse("idle-peer", measured(2304))
	// TEST_SCENARIO: the agent being reconciled is the owner's only start waiting for the node, and the pod carries the whole demand the node has deferred at a grant of 2560 MiB.
	runnerPod(t, r, "1Gi", "16Gi")
	pod, err := r.client.CoreV1().Pods("test-agents").Get(ctx, r.runnerName(testOwner)+"-abc", metav1.GetOptions{})
	require.NoError(t, err)
	pod.Status.ContainerStatuses = []corev1.ContainerStatus{{
		Name:               vmRunnerComponent,
		AllocatedResources: corev1.ResourceList{corev1.ResourceMemory: resource.MustParse("2560Mi")},
	}}
	pod.Status.Conditions = []corev1.PodCondition{{
		Type: corev1.PodResizePending, Status: corev1.ConditionTrue, Reason: corev1.PodReasonDeferred, Message: "node(s) didn't have free memory",
	}}
	_, err = r.client.CoreV1().Pods("test-agents").UpdateStatus(ctx, pod, metav1.UpdateOptions{})
	require.NoError(t, err)
	node.set("my-agent", vmrunner.MachineStatus{State: vmrunner.StateStopped, Reason: vmrunner.ReasonAwaitingAllocation})

	require.NoError(t, r.Reconcile(ctx, agent))

	untouched, err := r.dynamic.Resource(AgentsGVR).Namespace("test-agents").Get(ctx, "idle-peer", metav1.GetOptions{})
	require.NoError(t, err)
	assert.Empty(t, untouched.GetAnnotations()[annReclaimedAt],
		"the owner's only waiter is still a waiter, so the idle machine is not hibernated while the smaller ask is on its way")

	// TEST_SCENARIO: the same ask has now been with the node for longer than a grace and it has still not granted it, so the idle machine is the only room left.
	expireTheStepDownGrace(t, r, agent)
	require.NoError(t, r.Reconcile(ctx, agent))
	reclaimed, err := r.dynamic.Resource(AgentsGVR).Namespace("test-agents").Get(ctx, "idle-peer", metav1.GetOptions{})
	require.NoError(t, err)
	assert.NotEmpty(t, reclaimed.GetAnnotations()[annReclaimedAt],
		"once this ask has had its grace, the grant is exhausted and the idle machine frees it")
}

// TEST_SCENARIO: a grace belongs to one ask, not to the owner for ever. A wave the node granted, a further step down, or a pod replaced by a roll is a new question to the node, and none of them may inherit a grace an earlier ask has already spent: the reclaim would run before the node had ever seen the new ask, which is exactly what the grace exists to prevent.
func TestTheGraceBelongsToTheAskItWasMadeFor(t *testing.T) {
	ctx, r, agent := theGraceFixture(t, "1536Mi")

	// TEST_SCENARIO: the first ask records its grace, and that grace runs out without the node granting it.
	r.noteSteppedAsk(ctx, testOwner, theSizingDemand(t, r, agent))
	firstAsk := theRecordedAsk(t, r)
	assert.True(t, r.reclaimWaitsForTheReducedAsk(testOwner), "the grace is fresh, so the reclaim waits")
	r.steppedSince.Store(testOwner, steppedAskTimestamp{ask: firstAsk, at: time.Now().Add(-2 * steppedGrantGrace)})
	require.False(t, r.reclaimWaitsForTheReducedAsk(testOwner), "precondition: that same ask's grace has run out")

	// TEST_SCENARIO: the wave the node granted takes the start up beside the machine already held, so the owner holds more and the next ask is a different figure.
	peerVMAgent(t, r, "holder-b", "4Gi", "20Gi", true)
	r.noteMachineUse("holder-b", vmrunner.MachineStatus{State: vmrunner.StateRunning, CPUs: 1, MemoryMiB: 1024})
	r.noteMachineUse("waiter-b", vmrunner.MachineStatus{State: vmrunner.StateRunning, CPUs: 1, MemoryMiB: 1024})
	r.vmAnswers.Delete("waiter-b")
	peerVMAgent(t, r, "waiter-c", "4Gi", "20Gi", true)
	r.vmAnswers.Store("waiter-c", vmrunner.ReasonAwaitingAllocation)
	runnerPodReportsItsGrant(t, r, "3072Mi")
	r.noteSteppedAsk(ctx, testOwner, theSizingDemand(t, r, agent))
	nextAsk := theRecordedAsk(t, r)
	require.NotEqual(t, firstAsk, nextAsk, "progress the node made is a new question, not the one the spent grace belongs to")
	assert.True(t, r.reclaimWaitsForTheReducedAsk(testOwner),
		"the new ask gets its own grace rather than inheriting the spent one")

	// TEST_SCENARIO: a pod replaced by a roll carries an ask on a new identity, which is also a new question.
	replacedRunnerPod(t, r, "4Gi", "16Gi")
	deferredPodCondition(t, r, "2560Mi")
	r.noteSteppedAsk(ctx, testOwner, theSizingDemand(t, r, agent))
	replacement := theRecordedAsk(t, r)
	assert.NotEqual(t, nextAsk.uid, replacement.uid, "the replacement pod is a new identity")
	assert.True(t, r.reclaimWaitsForTheReducedAsk(testOwner),
		"the replacement pod's ask gets its own grace rather than the one the pod before it left")
	// TEST_SCENARIO: and once that grace runs out in its turn, the reclaim runs, so a persistent deferral still has its way out.
	r.steppedSince.Store(testOwner, steppedAskTimestamp{ask: replacement, at: time.Now().Add(-2 * steppedGrantGrace)})
	assert.False(t, r.reclaimWaitsForTheReducedAsk(testOwner),
		"the grace is bounded: a step down the node never grants does not hold the reclaim off for ever")
}

// TEST_SCENARIO: a grace the node's grant ended is over, and a later start that needs the very same request of the very same pod begins its own. The key names a request on a pod, which is not a lifetime: without clearing the record where every reconcile can see it, the spent grace stands and the next same-sized start frees an idle machine the moment its ask goes out. The sequence: one machine held, a start waiting, the ask stepped and its grace spent; the node grants it and that start goes; that machine later sleeps, the request and the grant fall, and a same-sized start wakes and is stepped to the same figure again.
func TestASpentGraceIsNotInheritedByALaterAskOfTheSameSize(t *testing.T) {
	ctx, r, agent := theGraceFixture(t, "1536Mi")

	// TEST_SCENARIO: the first episode: the ask is stepped, its grace is recorded, and it runs out with the node never answering it.
	r.noteSteppedAsk(ctx, testOwner, theSizingDemand(t, r, agent))
	firstAsk := theRecordedAsk(t, r)
	r.steppedSince.Store(testOwner, steppedAskTimestamp{ask: firstAsk, at: time.Now().Add(-2 * steppedGrantGrace)})
	require.False(t, r.reclaimWaitsForTheReducedAsk(testOwner), "precondition: that ask's grace is spent")

	// TEST_SCENARIO: the node grants the ask and its start goes, so nothing is stepped any more and the reconcile that reaches no wait records that.
	runnerPodReportsItsGrant(t, r, "2560Mi")
	r.noteMachineUse("waiter-b", vmrunner.MachineStatus{State: vmrunner.StateRunning, CPUs: 1, MemoryMiB: 1024})
	r.vmAnswers.Delete("waiter-b")
	_, stepped := r.runnerAskIsStepped(ctx, testOwner, theSizingDemand(t, r, agent))
	require.False(t, stepped, "precondition: no start is waiting, so nothing is stepped")
	r.noteSteppedAsk(ctx, testOwner, theSizingDemand(t, r, agent))
	_, recorded := r.steppedSince.Load(testOwner)
	assert.False(t, recorded, "the completed grace is cleared, so no later ask inherits it")

	// TEST_SCENARIO: the admitted machine sleeps, the request and the grant fall back, and a same-sized start wakes later and is stepped to the very same figure on the very same pod.
	runnerPodReportsItsGrant(t, r, "1536Mi")
	r.noteMachineUse("waiter-b", vmrunner.MachineStatus{State: vmrunner.StateStopped})
	r.vmAnswers.Store("waiter-b", vmrunner.ReasonAwaitingAllocation)
	r.noteSteppedAsk(ctx, testOwner, theSizingDemand(t, r, agent))
	laterAsk := theRecordedAsk(t, r)
	require.Equal(t, firstAsk, laterAsk, "the same request on the same pod, which the key alone cannot tell from the spent episode")
	assert.True(t, r.reclaimWaitsForTheReducedAsk(testOwner),
		"this ask is fresh, so the idle machine is left alone while the node evaluates it")
}

// TEST_SCENARIO: the same episode through the real reconcile path, so the clear is proved where a production pass makes it rather than by calling the recorder: a step whose grace the node never answered, then a pass in which the grant covers every waiting start, then the very same step again on the same pod. The completed episode is cleared by the pass that found nothing stepped, so the later ask gets its own grace instead of inheriting the spent one and hibernating an idle machine at once.
func TestACompletedStepDownClearsItsGraceThroughTheReconcile(t *testing.T) {
	ctx, r, agent := deferredResizeWithWaits(t, true)

	// TEST_SCENARIO: the first episode: the reconcile finds the ask stepped and records its grace, and that grace then runs out.
	require.NoError(t, r.Reconcile(ctx, agent))
	firstAsk := theRecordedAsk(t, r)
	r.steppedSince.Store(testOwner, steppedAskTimestamp{ask: firstAsk, at: time.Now().Add(-2 * steppedGrantGrace)})
	require.False(t, r.reclaimWaitsForTheReducedAsk(testOwner), "precondition: that ask's grace is spent")

	// TEST_SCENARIO: the node grants enough for every waiting start, so this pass finds nothing stepped and clears the record.
	runnerPodReportsItsGrant(t, r, "8Gi")
	clearDeferredCondition(t, r)
	require.NoError(t, r.Reconcile(ctx, agent))
	_, recorded := r.steppedSince.Load(testOwner)
	assert.False(t, recorded, "the pass that found nothing stepped cleared the completed grace")

	// TEST_SCENARIO: the grant falls back and the very same step is needed again, of the very same pod.
	runnerPodReportsItsGrant(t, r, "2560Mi")
	deferredPodCondition(t, r, "2560Mi")
	require.NoError(t, r.Reconcile(ctx, agent))
	laterAsk := theRecordedAsk(t, r)
	require.Equal(t, firstAsk, laterAsk, "the same request on the same pod, which the key alone cannot tell from the spent episode")
	assert.True(t, r.reclaimWaitsForTheReducedAsk(testOwner),
		"this ask is fresh, so the idle machine is left alone while the node evaluates it")
	untouched, err := r.dynamic.Resource(AgentsGVR).Namespace("test-agents").Get(ctx, "idle-peer", metav1.GetOptions{})
	require.NoError(t, err)
	assert.Empty(t, untouched.GetAnnotations()[annReclaimedAt],
		"the idle machine survives the first pass of the new ask")
}

// TEST_SCENARIO: the pod as a node that has granted the resize leaves it: the condition gone.
func clearDeferredCondition(t *testing.T, r *AgentReconciler) {
	t.Helper()
	ctx := context.Background()
	pods, err := r.client.CoreV1().Pods("test-agents").List(ctx, metav1.ListOptions{})
	require.NoError(t, err)
	for i := range pods.Items {
		pod := &pods.Items[i]
		pod.Status.Conditions = nil
		_, err = r.client.CoreV1().Pods("test-agents").UpdateStatus(ctx, pod, metav1.UpdateOptions{})
		require.NoError(t, err)
	}
}

// TEST_SCENARIO: a stopped agent reconciles too, and its reconcile must not move the grace another start is waiting under. The grace is recorded from the very demand the pod is sized from, so a stopped agent that holds nothing of its own is left out of that demand exactly as it is left out of the resize: a demand read with that agent counted as running would key the grace to a request the node was never sent, and the next waiter's retry would put the real request back and restart its minute. Nothing has progressed, yet the reclaim is postponed twice.
func TestAStoppedAgentsReconcileDoesNotRestartAnotherStartsGrace(t *testing.T) {
	ctx, r, agent := theGraceFixture(t, "1536Mi")

	// TEST_SCENARIO: a third agent of the owner was admitted before and has been idle past its hibernation timeout, so it is stopped and holds nothing.
	peerVMAgent(t, r, "sleeping", "4Gi", "20Gi", false)
	r.vmAnswers.Store("sleeping", "")
	_, err := r.dynamic.Resource(AgentsGVR).Namespace("test-agents").Patch(ctx, "sleeping", "application/merge-patch+json",
		[]byte(`{"metadata":{"annotations":{"`+annLastActivity+`":"`+time.Now().UTC().Add(-10*time.Hour).Format(time.RFC3339)+`"}}}`),
		metav1.PatchOptions{})
	require.NoError(t, err)

	// TEST_SCENARIO: the waiting start's own reconcile records the real minimal ask.
	require.NoError(t, r.Reconcile(ctx, agent))
	waitingAsk := theRecordedAsk(t, r)
	assert.Equal(t, "2560Mi", waitingAsk.request, "one machine held plus the start waiting for it, plus the reserve")
	startedAt := steppedGraceStartedAt(t, r)

	// TEST_SCENARIO: the stopped agent reconciles, and the request the node is sent does not change.
	sleeping, err := loadAgent(t, r, "sleeping")
	require.NoError(t, err)
	leaf := leafSecret()
	leaf.Name = EnvoyLeafSecretName("sleeping")
	_, err = r.client.CoreV1().Secrets("test-agents").Create(ctx, leaf, metav1.CreateOptions{})
	require.NoError(t, err)
	before := runnerPodRequest(t, r)
	require.NoError(t, r.Reconcile(ctx, sleeping))
	assert.Equal(t, before, runnerPodRequest(t, r), "a stopped agent asks the node for nothing new")
	assert.Equal(t, waitingAsk, theRecordedAsk(t, r),
		"a stopped agent holds nothing, so its reconcile keys the grace to the same request the node was sent")
	assert.Equal(t, startedAt, steppedGraceStartedAt(t, r),
		"and it does not restart that request's grace")

	// TEST_SCENARIO: once that request's grace runs out, the reclaim is eligible, so the stopped agent's pass postponed nothing.
	r.steppedSince.Store(testOwner, steppedAskTimestamp{ask: waitingAsk, at: time.Now().Add(-2 * steppedGrantGrace)})
	assert.False(t, r.reclaimWaitsForTheReducedAsk(testOwner),
		"the real ask's grace is spent, so the reclaim is no longer held off")
}

// TEST_SCENARIO: one of the owner's agents as it is stored, which is what a reconcile is handed.
func loadAgent(t *testing.T, r *AgentReconciler, name string) (*apiv1.Agent, error) {
	t.Helper()
	u, err := r.dynamic.Resource(AgentsGVR).Namespace("test-agents").Get(context.Background(), name, metav1.GetOptions{})
	if err != nil {
		return nil, err
	}
	return FromCacheObject[apiv1.Agent](u)
}

// TEST_SCENARIO: the ask the owner's grace is recorded against.
func theRecordedAsk(t *testing.T, r *AgentReconciler) steppedAsk {
	t.Helper()
	v, ok := r.steppedSince.Load(testOwner)
	require.True(t, ok, "no ask is recorded, so there is no grace")
	return v.(steppedAskTimestamp).ask
}

// UNIT_BOUNDARY_DESCRIPTION: one start waiting for the node, a pod holding `grant`, and a node that has deferred the resize — the state every pass below begins from.
func theGraceFixture(t *testing.T, grant string) (context.Context, *AgentReconciler, *apiv1.Agent) {
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
	peerVMAgent(t, r, "waiter-b", "4Gi", "20Gi", true)
	r.vmAnswers.Store("waiter-b", vmrunner.ReasonAwaitingAllocation)
	// TEST_SCENARIO: the fixture's own agent is one of the owner's running machines, with its gateway up as a running agent's is.
	up := int32(1)
	_, err := r.client.AppsV1().StatefulSets("test-agents").Create(context.Background(), &appsv1.StatefulSet{
		ObjectMeta: metav1.ObjectMeta{Name: GatewayName("my-agent"), Namespace: "test-agents"},
		Spec:       appsv1.StatefulSetSpec{Replicas: &up},
	}, metav1.CreateOptions{})
	require.NoError(t, err)
	r.noteMachineUse("my-agent", vmrunner.MachineStatus{State: vmrunner.StateRunning, CPUs: 1, MemoryMiB: 1024})
	runnerPod(t, r, "1Gi", "16Gi")
	deferredPodCondition(t, r, grant)
	node.set("my-agent", vmrunner.MachineStatus{State: vmrunner.StateRunning})
	return ctx, r, agent
}

// TEST_SCENARIO: the pod's status as a node that has deferred the resize leaves it: what it holds, and the condition that says the resize is pending.
func deferredPodCondition(t *testing.T, r *AgentReconciler, allocated string) {
	t.Helper()
	ctx := context.Background()
	pods, err := r.client.CoreV1().Pods("test-agents").List(ctx, metav1.ListOptions{})
	require.NoError(t, err)
	for i := range pods.Items {
		pod := &pods.Items[i]
		pod.Status.ContainerStatuses = []corev1.ContainerStatus{{
			Name:               vmRunnerComponent,
			AllocatedResources: corev1.ResourceList{corev1.ResourceMemory: resource.MustParse(allocated)},
		}}
		pod.Status.Conditions = []corev1.PodCondition{{
			Type: corev1.PodResizePending, Status: corev1.ConditionTrue, Reason: corev1.PodReasonDeferred, Message: "node(s) didn't have free memory",
		}}
		_, err = r.client.CoreV1().Pods("test-agents").UpdateStatus(ctx, pod, metav1.UpdateOptions{})
		require.NoError(t, err)
	}
}

// TEST_SCENARIO: once the pod carries the reduced ask and the node has still not granted it, the grant is exhausted and the owner's own idle agents are the only room left: the reclaim runs again, as it does for a start the pool refused. Without that, a grant that can never hold one more machine would leave every start of that owner waiting for ever.
func TestTheReclaimRunsOnceTheReducedAskIsExhausted(t *testing.T) {
	ctx, r, agent := deferredResizeWithWaits(t, true)
	// TEST_SCENARIO: the step-down began more than a grace ago, and the node has still not granted it.
	expireTheStepDownGrace(t, r, agent)

	require.NoError(t, r.Reconcile(ctx, agent))

	reclaimed, err := r.dynamic.Resource(AgentsGVR).Namespace("test-agents").Get(ctx, "idle-peer", metav1.GetOptions{})
	require.NoError(t, err)
	assert.NotEmpty(t, reclaimed.GetAnnotations()[annReclaimedAt],
		"the reduced ask is exhausted and an idle machine is the only room left")
}

// TEST_SCENARIO: the demand a reconcile of this agent sizes the pod from: the agent counts as running, since a fixture's agent is one that should be up.
func theSizingDemand(t *testing.T, r *AgentReconciler, agent *apiv1.Agent) runnerDemand {
	t.Helper()
	demand, err := r.ownerRunnerDemand(context.Background(), testOwner, agent, true)
	require.NoError(t, err)
	return demand
}

// TEST_SCENARIO: when the grace on the owner's current step down began.
func steppedGraceStartedAt(t *testing.T, r *AgentReconciler) time.Time {
	t.Helper()
	v, ok := r.steppedSince.Load(testOwner)
	require.True(t, ok, "the step-down was never recorded")
	return v.(steppedAskTimestamp).at
}

// TEST_SCENARIO: the owner's current step down has been with the node for longer than a grace, as a kubelet that will not grant it leaves it: the grace is recorded against the very ask this pass finds, so it is the ask the reclaim is told to stop waiting for.
func expireTheStepDownGrace(t *testing.T, r *AgentReconciler, agent *apiv1.Agent) {
	t.Helper()
	ask, stepped := r.runnerAskIsStepped(context.Background(), testOwner, theSizingDemand(t, r, agent))
	require.True(t, stepped, "the fixture's pod is not a stepped ask, so there is no grace to expire")
	r.steppedSince.Store(testOwner, steppedAskTimestamp{ask: ask, at: time.Now().Add(-2 * steppedGrantGrace)})
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
